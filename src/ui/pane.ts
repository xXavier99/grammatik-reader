// A scrollable, zoomable, virtualized view of the PDF. Only pages near the
// viewport are in the DOM; renders are cancelled when pages scroll away.

import { CSS_PER_PDF_UNIT, makeViewport, type Viewport } from '../model/coords';
import type { PdfBook } from '../pdf/book';
import {
  clampZoom, computeLayout, dominantPage, fitWidthZoom, median, PAGE_GAP, visibleRange, type Layout,
} from '../pdf/layout';
import { CancelledError, Priority, type Renderer } from '../pdf/renderer';
import { el } from './dom';

export interface PageView {
  pageNo: number;
  el: HTMLDivElement;
  canvas: HTMLCanvasElement;
  /** Annotation layer, same size as the page. */
  overlay: HTMLDivElement;
  /** Device-pixel scale of the bitmap currently in `canvas` (0 = none). */
  renderedScale: number;
  pendingScale: number;
  abort?: AbortController;
}

/** Hooks for layers drawn on top of pages (annotations, tools). */
export interface PageDecorator {
  mount(view: PageView, pane: PdfPane): void;
  /** Page size/zoom changed. */
  layout(view: PageView, pane: PdfPane): void;
  unmount(view: PageView, pane: PdfPane): void;
}

export interface PaneCallbacks {
  onFocus(pane: PdfPane): void;
  onPageChange(pane: PdfPane, page: number): void;
  onZoomChange(pane: PdfPane): void;
}

export interface PaneState {
  page: number;
  zoom: number;
  fitWidth: boolean;
}

const SETTLE_MS = 160;

export class PdfPane {
  readonly el: HTMLDivElement;
  private scroller: HTMLDivElement;
  private content: HTMLDivElement;
  /** "p. 12" label, shown in split view so each pane's page is visible. */
  private badge: HTMLDivElement;
  private layout: Layout = { boxes: [], totalWidth: 0, totalHeight: 0 };
  private views = new Map<number, PageView>();
  private decorators: PageDecorator[] = [];
  private _zoom: number;
  private _fitWidth: boolean;
  private _page: number;
  private focused = false;
  private settling = false;
  private settleTimer: number | undefined;
  private rafPending = false;
  private resizeObs: ResizeObserver;
  private disposers: (() => void)[] = [];
  /** Suppresses page-change events while we programmatically scroll. */
  private started = false;

  constructor(
    private book: PdfBook,
    private renderer: Renderer,
    private cb: PaneCallbacks,
    initial: PaneState,
    readonly name: string,
  ) {
    this._zoom = clampZoom(initial.zoom);
    this._fitWidth = initial.fitWidth;
    this._page = initial.page;
    this.content = el('div', { class: 'pane-content' });
    this.scroller = el('div', { class: 'pane-scroll' }, this.content);
    this.badge = el('div', { class: 'pane-badge' }, `p. ${initial.page}`);
    this.el = el('div', { class: 'pane', tabindex: '0', 'data-pane': name }, this.scroller, this.badge);

    this.scroller.addEventListener('scroll', () => this.scheduleUpdate(), { passive: true });
    this.scroller.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.el.addEventListener('pointerdown', () => this.cb.onFocus(this), { capture: true });
    this.el.addEventListener('focusin', () => this.cb.onFocus(this));
    this.resizeObs = new ResizeObserver(() => this.onResize());
    this.disposers.push(this.book.onGeomsChanged(() => this.relayout()));
  }

  /** Call once the element is in the DOM (needs its size). */
  start(): void {
    this.resizeObs.observe(this.scroller);
    if (this._fitWidth) this._zoom = this.computeFitZoom();
    this.relayout(null);
    this.goToPage(this._page);
    this.started = true;
  }

  addDecorator(d: PageDecorator): void {
    this.decorators.push(d);
    for (const v of this.views.values()) d.mount(v, this);
  }

  // ---- public state ------------------------------------------------------

  get page(): number {
    return this._page;
  }
  get pageCount(): number {
    return this.book.pageCount;
  }
  get zoom(): number {
    return this._zoom;
  }
  get fitWidth(): boolean {
    return this._fitWidth;
  }
  /** CSS pixels per PDF unit. */
  get cssScale(): number {
    return this._zoom * CSS_PER_PDF_UNIT;
  }
  get state(): PaneState {
    return { page: this._page, zoom: this._zoom, fitWidth: this._fitWidth };
  }
  get pageViews(): Iterable<PageView> {
    return this.views.values();
  }

  viewportFor(pageNo: number): Viewport {
    return makeViewport(this.book.geoms[pageNo - 1], this.cssScale);
  }

  setFocused(f: boolean): void {
    this.focused = f;
    this.el.classList.toggle('focused', f);
  }

  // ---- navigation --------------------------------------------------------

  goToPage(pageNo: number): void {
    const n = Math.min(this.book.pageCount, Math.max(1, Math.round(pageNo)));
    const box = this.layout.boxes[n - 1];
    if (!box) return;
    this.scroller.scrollTop = Math.max(0, box.top - PAGE_GAP / 2);
    this.setPage(n);
    this.update();
  }

  /** True if any part of the page is inside the viewport. */
  isPageVisible(pageNo: number): boolean {
    const r = visibleRange(this.layout.boxes, this.scroller.scrollTop, this.scroller.clientHeight);
    return !!r && pageNo - 1 >= r[0] && pageNo - 1 <= r[1];
  }

  next(): void {
    this.goToPage(this._page + 1);
  }
  prev(): void {
    this.goToPage(this._page - 1);
  }

  // ---- zoom --------------------------------------------------------------

  setZoom(z: number, anchor?: { clientX: number; clientY: number }): void {
    const nz = clampZoom(z);
    this._fitWidth = false;
    if (Math.abs(nz - this._zoom) < 1e-4) {
      this.cb.onZoomChange(this);
      return;
    }
    this._zoom = nz;
    this.startSettle();
    this.relayout(anchor ?? null);
    this.cb.onZoomChange(this);
  }

  setFitWidth(): void {
    this._fitWidth = true;
    this._zoom = this.computeFitZoom();
    this.startSettle();
    this.relayout(null);
    this.cb.onZoomChange(this);
  }

  private computeFitZoom(): number {
    const widths = this.book.displaySizes().map((s) => s.width);
    // Scrollbar width is excluded via clientWidth.
    return clampZoom(fitWidthZoom(median(widths), this.scroller.clientWidth, CSS_PER_PDF_UNIT));
  }

  private onWheel(e: WheelEvent): void {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    const factor = Math.exp(-Math.max(-100, Math.min(100, dy)) * 0.0025);
    this.setZoom(this._zoom * factor, { clientX: e.clientX, clientY: e.clientY });
  }

  private onResize(): void {
    if (!this.started) return;
    if (this._fitWidth) {
      const z = this.computeFitZoom();
      if (Math.abs(z - this._zoom) > 1e-3) {
        this._zoom = z;
        this.startSettle();
        this.relayout(null);
        this.cb.onZoomChange(this);
        return;
      }
    }
    this.relayout(null);
  }

  private startSettle(): void {
    this.settling = true;
    clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => {
      this.settling = false;
      this.update();
    }, SETTLE_MS);
  }

  // ---- layout & virtualization ------------------------------------------

  /**
   * Recomputes page boxes, keeping the point under `anchor` (or the top of
   * the viewport) fixed on screen.
   */
  relayout(anchor: { clientX: number; clientY: number } | null = null): void {
    const sr = this.scroller.getBoundingClientRect();
    const ax = anchor ? anchor.clientX - sr.left : this.scroller.clientWidth / 2;
    const ay = anchor ? anchor.clientY - sr.top : 0;
    const keep = this.layout.boxes.length ? this.anchorAt(ax, ay) : null;

    this.layout = computeLayout(this.book.displaySizes(), this.cssScale, this.scroller.clientWidth);
    this.content.style.width = `${this.layout.totalWidth}px`;
    this.content.style.height = `${this.layout.totalHeight}px`;
    for (const v of this.views.values()) this.positionView(v);

    if (keep) {
      const b = this.layout.boxes[keep.index];
      this.scroller.scrollLeft = b.left + keep.fx * b.width - ax;
      this.scroller.scrollTop = b.top + keep.fy * b.height - ay;
    }
    this.update();
  }

  /** Page index and fractional position under a viewport-relative point. */
  private anchorAt(ax: number, ay: number): { index: number; fx: number; fy: number } {
    const x = this.scroller.scrollLeft + ax;
    const y = this.scroller.scrollTop + ay;
    const boxes = this.layout.boxes;
    let index = boxes.findIndex((b) => y < b.top + b.height + PAGE_GAP / 2);
    if (index < 0) index = boxes.length - 1;
    const b = boxes[index];
    return { index, fx: (x - b.left) / b.width, fy: (y - b.top) / b.height };
  }

  private scheduleUpdate(): void {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.update();
    });
  }

  private update(): void {
    const top = this.scroller.scrollTop;
    const h = this.scroller.clientHeight;
    const boxes = this.layout.boxes;
    const near = visibleRange(boxes, top, h, h * 0.75);
    const strict = visibleRange(boxes, top, h);

    for (const [pageNo, v] of this.views) {
      if (!near || pageNo - 1 < near[0] || pageNo - 1 > near[1]) this.unmount(v);
    }
    if (near) {
      for (let i = near[0]; i <= near[1]; i++) {
        const pageNo = i + 1;
        const v = this.views.get(pageNo) ?? this.mount(pageNo);
        const visible = !!strict && i >= strict[0] && i <= strict[1];
        this.ensureRendered(v, visible);
      }
    }
    if (this.started && boxes.length) this.setPage(dominantPage(boxes, top, h) + 1);
  }

  private setPage(n: number): void {
    if (n === this._page) return;
    this._page = n;
    this.badge.textContent = `p. ${n}`;
    this.cb.onPageChange(this, n);
  }

  private mount(pageNo: number): PageView {
    const canvas = el('canvas', { class: 'page-canvas' });
    const overlay = el('div', { class: 'page-overlay' });
    const label = el('div', { class: 'page-label' }, String(pageNo));
    const pageEl = el('div', { class: 'page loading', 'data-page': String(pageNo) }, label, canvas, overlay);
    const v: PageView = { pageNo, el: pageEl, canvas, overlay, renderedScale: 0, pendingScale: 0 };
    this.positionView(v);
    this.content.appendChild(pageEl);
    this.views.set(pageNo, v);
    for (const d of this.decorators) d.mount(v, this);
    return v;
  }

  private unmount(v: PageView): void {
    v.abort?.abort();
    for (const d of this.decorators) d.unmount(v, this);
    v.el.remove();
    v.canvas.width = v.canvas.height = 0;
    this.views.delete(v.pageNo);
  }

  private positionView(v: PageView): void {
    const b = this.layout.boxes[v.pageNo - 1];
    if (!b) return;
    const s = v.el.style;
    s.left = `${b.left}px`;
    s.top = `${b.top}px`;
    s.width = `${b.width}px`;
    s.height = `${b.height}px`;
    for (const d of this.decorators) d.layout(v, this);
  }

  private ensureRendered(v: PageView, visible: boolean): void {
    const target = this.renderer.pixelScale(v.pageNo, this.cssScale);
    if (v.renderedScale === target || v.pendingScale === target) return;
    // While zooming, keep stretching the old bitmap instead of re-rendering per tick.
    if (this.settling && v.renderedScale) return;

    v.abort?.abort();
    const cached = this.renderer.peek(v.pageNo, target);
    if (cached) {
      this.blit(v, cached, target);
      return;
    }
    const ac = new AbortController();
    v.abort = ac;
    v.pendingScale = target;
    const prio = (visible ? Priority.Visible : Priority.Nearby) + (this.focused ? 0 : Priority.VisibleOtherPane);
    this.renderer.render(v.pageNo, target, prio, ac.signal).then(
      (src) => {
        if (v.abort === ac) v.abort = undefined;
        v.pendingScale = 0;
        if (this.views.get(v.pageNo) === v) this.blit(v, src, target);
      },
      (e) => {
        if (v.pendingScale === target) v.pendingScale = 0;
        if (e instanceof CancelledError) return;
        console.error(`Rendering page ${v.pageNo} failed`, e);
        v.el.classList.add('error');
        v.el.querySelector('.page-label')!.textContent = `Page ${v.pageNo} could not be rendered`;
      },
    );
  }

  private blit(v: PageView, src: HTMLCanvasElement, scale: number): void {
    v.canvas.width = src.width;
    v.canvas.height = src.height;
    v.canvas.getContext('2d')!.drawImage(src, 0, 0);
    v.renderedScale = scale;
    v.el.classList.remove('loading');
  }

  focus(): void {
    this.el.focus({ preventScroll: true });
  }

  destroy(): void {
    this.resizeObs.disconnect();
    clearTimeout(this.settleTimer);
    for (const v of [...this.views.values()]) this.unmount(v);
    for (const d of this.disposers) d();
    this.el.remove();
  }
}
