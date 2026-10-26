// Prioritised, cancellable page rendering with an LRU canvas cache.
// Requests for the same page+resolution share one pdf.js render.

import type { RenderTask } from 'pdfjs-dist';
import type { PdfBook } from './book';

export const Priority = {
  Visible: 0,
  VisibleOtherPane: 1,
  Nearby: 2,
  Thumbnail: 5,
} as const;

/** Keeps very high zoom from allocating giant canvases. */
const MAX_CANVAS_PIXELS = 24_000_000;
/** Cache budget in pixels (×4 bytes): ~320 MB. */
const CACHE_PIXELS = 80_000_000;
const CONCURRENCY = 2;

interface Waiter {
  resolve(c: HTMLCanvasElement): void;
  reject(e: unknown): void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

interface Job {
  key: string;
  pageNo: number;
  scale: number;
  priority: number;
  waiters: Set<Waiter>;
  task?: RenderTask;
  running: boolean;
}

export class CancelledError extends Error {
  constructor() {
    super('Render cancelled');
  }
}

export class Renderer {
  private cache = new Map<string, HTMLCanvasElement>();
  private cachePixels = 0;
  private queue: Job[] = [];
  private jobs = new Map<string, Job>();
  private active = 0;

  constructor(private book: PdfBook) {}

  /** Device-pixel scale for a CSS scale, clamped so the canvas stays bounded. */
  pixelScale(pageNo: number, cssScale: number, dpr = window.devicePixelRatio || 1): number {
    const g = this.book.geoms[pageNo - 1];
    const area = (g.view[2] - g.view[0]) * (g.view[3] - g.view[1]);
    let s = cssScale * dpr;
    if (area * s * s > MAX_CANVAS_PIXELS) s = Math.sqrt(MAX_CANVAS_PIXELS / area);
    return Math.round(s * 1000) / 1000;
  }

  /** Returns a cached canvas synchronously, if one exists. */
  peek(pageNo: number, scale: number): HTMLCanvasElement | undefined {
    const key = keyOf(pageNo, scale);
    const c = this.cache.get(key);
    if (c) {
      this.cache.delete(key);
      this.cache.set(key, c);
    }
    return c;
  }

  /**
   * Renders `pageNo` at `scale` device pixels per PDF unit. The returned canvas
   * is owned by the cache: callers must copy it (drawImage), not insert it.
   */
  render(pageNo: number, scale: number, priority: number, signal?: AbortSignal): Promise<HTMLCanvasElement> {
    const hit = this.peek(pageNo, scale);
    if (hit) return Promise.resolve(hit);
    if (signal?.aborted) return Promise.reject(new CancelledError());

    const key = keyOf(pageNo, scale);
    let job = this.jobs.get(key);
    if (!job) {
      job = { key, pageNo, scale, priority, waiters: new Set(), running: false };
      this.jobs.set(key, job);
      this.queue.push(job);
    } else {
      job.priority = Math.min(job.priority, priority);
    }
    const j = job;
    return new Promise((resolve, reject) => {
      const w: Waiter = { resolve, reject, signal };
      if (signal) {
        w.onAbort = () => {
          j.waiters.delete(w);
          reject(new CancelledError());
          if (!j.waiters.size) this.cancelJob(j);
        };
        signal.addEventListener('abort', w.onAbort, { once: true });
      }
      j.waiters.add(w);
      this.pump();
    });
  }

  private cancelJob(job: Job): void {
    // Detach first so a new request for the same key starts a fresh job
    // instead of joining one that is about to reject as cancelled.
    if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
    if (job.running) job.task?.cancel();
    else this.queue = this.queue.filter((j) => j !== job);
  }

  private pump(): void {
    while (this.active < CONCURRENCY && this.queue.length) {
      let best = 0;
      for (let i = 1; i < this.queue.length; i++) {
        if (this.queue[i].priority < this.queue[best].priority) best = i;
      }
      const job = this.queue.splice(best, 1)[0];
      this.active++;
      void this.run(job).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }

  private async run(job: Job): Promise<void> {
    job.running = true;
    const settle = (fn: (w: Waiter) => void) => {
      if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
      for (const w of job.waiters) {
        if (w.signal && w.onAbort) w.signal.removeEventListener('abort', w.onAbort);
        fn(w);
      }
      job.waiters.clear();
    };
    try {
      const page = await this.book.getPage(job.pageNo);
      if (!job.waiters.size) throw new CancelledError();
      const viewport = page.getViewport({ scale: job.scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext('2d', { alpha: false })!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      job.task = page.render({ canvasContext: ctx, viewport });
      await job.task.promise;
      this.store(job.key, canvas);
      settle((w) => w.resolve(canvas));
    } catch (e) {
      const cancelled = e instanceof CancelledError || (e as { name?: string })?.name === 'RenderingCancelledException';
      settle((w) => w.reject(cancelled ? new CancelledError() : e));
    }
  }

  private store(key: string, canvas: HTMLCanvasElement): void {
    this.cache.set(key, canvas);
    this.cachePixels += canvas.width * canvas.height;
    for (const [k, c] of this.cache) {
      if (this.cachePixels <= CACHE_PIXELS || k === key) break;
      this.cache.delete(k);
      this.cachePixels -= c.width * c.height;
      c.width = c.height = 0; // Release the backing store promptly.
    }
  }

  clear(): void {
    for (const job of [...this.jobs.values()]) this.cancelJob(job);
    for (const c of this.cache.values()) c.width = c.height = 0;
    this.cache.clear();
    this.cachePixels = 0;
  }
}

function keyOf(pageNo: number, scale: number): string {
  return `${pageNo}@${scale}`;
}
