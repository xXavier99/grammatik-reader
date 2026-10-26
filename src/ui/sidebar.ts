// Collapsible left sidebar with virtualized page thumbnails.

import { displaySize } from '../model/coords';
import type { PdfBook } from '../pdf/book';
import { computeLayout, median, visibleRange, type Layout } from '../pdf/layout';
import { CancelledError, Priority, type Renderer } from '../pdf/renderer';
import { el } from './dom';

const THUMB_WIDTH = 120;

interface Thumb {
  el: HTMLDivElement;
  canvas: HTMLCanvasElement;
  abort: AbortController;
}

export class Sidebar {
  readonly el: HTMLElement;
  private scroller: HTMLDivElement;
  private content: HTMLDivElement;
  private layout: Layout = { boxes: [], totalWidth: 0, totalHeight: 0 };
  private thumbs = new Map<number, Thumb>();
  private current = 1;
  private timer: number | undefined;
  private disposeGeoms: () => void;

  constructor(
    private book: PdfBook,
    private renderer: Renderer,
    private onSelect: (page: number) => void,
  ) {
    this.content = el('div', { class: 'thumbs-content' });
    this.scroller = el('div', { class: 'thumbs-scroll' }, this.content);
    this.el = el('aside', { class: 'sidebar', 'aria-label': 'Page thumbnails' }, this.scroller);
    this.scroller.addEventListener('scroll', () => this.schedule(), { passive: true });
    this.content.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('.thumb');
      if (t) this.onSelect(Number(t.dataset.page));
    });
    this.disposeGeoms = book.onGeomsChanged(() => this.relayout());
  }

  start(): void {
    this.relayout();
  }

  private relayout(): void {
    const sizes = this.book.displaySizes();
    const scale = THUMB_WIDTH / median(sizes.map((s) => s.width));
    // Wider pages (landscape) are shrunk to the thumbnail width so they fit the sidebar.
    const fitted = sizes.map((s) => {
      const f = Math.min(scale, THUMB_WIDTH / s.width);
      return { width: s.width * f, height: s.height * f };
    });
    this.layout = computeLayout(fitted, 1, 0, 22, 8);
    this.content.style.height = `${this.layout.totalHeight}px`;
    for (const t of this.thumbs.values()) this.removeThumb(t);
    this.thumbs.clear();
    this.update();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.update(), 60);
  }

  private update(): void {
    const h = this.scroller.clientHeight;
    const range = visibleRange(this.layout.boxes, this.scroller.scrollTop, h, h);
    for (const [n, t] of this.thumbs) {
      if (!range || n - 1 < range[0] || n - 1 > range[1]) {
        this.removeThumb(t);
        this.thumbs.delete(n);
      }
    }
    if (!range) return;
    for (let i = range[0]; i <= range[1]; i++) {
      if (!this.thumbs.has(i + 1)) this.thumbs.set(i + 1, this.makeThumb(i + 1));
    }
  }

  private makeThumb(pageNo: number): Thumb {
    const b = this.layout.boxes[pageNo - 1];
    const canvas = el('canvas');
    const thumb = el(
      'div',
      { class: 'thumb', 'data-page': String(pageNo), title: `Page ${pageNo}` },
      el('div', { class: 'thumb-img' }, canvas),
      el('div', { class: 'thumb-num' }, String(pageNo)),
    );
    // Horizontal centring is done in CSS; the layout only supplies top and size.
    thumb.style.top = `${b.top}px`;
    thumb.style.setProperty('--w', `${b.width}px`);
    thumb.style.setProperty('--h', `${b.height}px`);
    thumb.classList.toggle('current', pageNo === this.current);
    this.content.appendChild(thumb);

    const ac = new AbortController();
    const shown = displaySize(this.book.geoms[pageNo - 1]);
    const scale = Math.round(((b.width * (window.devicePixelRatio || 1)) / shown.width) * 1000) / 1000;
    this.renderer.render(pageNo, scale, Priority.Thumbnail, ac.signal).then(
      (src) => {
        canvas.width = src.width;
        canvas.height = src.height;
        canvas.getContext('2d')!.drawImage(src, 0, 0);
      },
      (e) => {
        if (!(e instanceof CancelledError)) console.warn(`Thumbnail ${pageNo} failed`, e);
      },
    );
    return { el: thumb, canvas, abort: ac };
  }

  private removeThumb(t: Thumb): void {
    t.abort.abort();
    t.canvas.width = t.canvas.height = 0;
    t.el.remove();
  }

  setCurrent(pageNo: number): void {
    if (pageNo === this.current) return;
    this.thumbs.get(this.current)?.el.classList.remove('current');
    this.current = pageNo;
    this.thumbs.get(pageNo)?.el.classList.add('current');
    const b = this.layout.boxes[pageNo - 1];
    if (!b) return;
    const top = this.scroller.scrollTop;
    const h = this.scroller.clientHeight;
    if (b.top < top || b.top + b.height > top + h) {
      this.scroller.scrollTop = b.top - h / 2 + b.height / 2;
    }
  }

  destroy(): void {
    clearTimeout(this.timer);
    this.disposeGeoms();
    for (const t of this.thumbs.values()) this.removeThumb(t);
    this.el.remove();
  }
}
