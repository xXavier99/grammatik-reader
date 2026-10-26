// Renders annotations from the store onto every mounted page of every pane and
// routes pointer input on pages to the active tool.

import { firstRowHeight, rowSpacing } from '../model/areas';
import { blankRect, boxForBlank } from '../model/blanks';
import { pdfToScreen, type Viewport } from '../model/coords';
import { getPage } from '../model/history';
import { MARK_COLORS, MARK_PATHS, MARK_STROKE } from '../model/marks';
import type { AnswerArea, Blank, Mark, TextBox, Underline } from '../model/schema';
import type { Store } from '../model/store';
import { LINE_HEIGHT, TEXT_FONT_FAMILY } from '../model/text';
import type { EditorState } from '../tools/editor';
import { el } from './dom';
import type { PageDecorator, PageView, PdfPane } from './pane';

export interface PageContext {
  pane: PdfPane;
  view: PageView;
  vp: Viewport;
}

export interface Tool {
  onPointerDown(e: PointerEvent, ctx: PageContext): void;
  /** True if the tool shows its own editor for this box in this pane. */
  isEditing?(pane: PdfPane, id: string): boolean;
  /** The page was re-rendered (zoom, content change). */
  afterRender?(ctx: PageContext): void;
  /** The page is leaving the DOM. */
  onUnmount?(ctx: PageContext): void;
  /** Suppress the browser context menu on pages (right-click is a tool action). */
  readonly wantsContextMenu?: boolean;
}

export class AnnotationLayer implements PageDecorator {
  private panes = new Set<PdfPane>();
  private tool: Tool | null = null;
  private disposers: (() => void)[] = [];

  constructor(
    private store: Store,
    private editor: EditorState,
  ) {
    this.disposers.push(
      store.subscribe((c) => {
        if (c.kind === 'view') return;
        // Settings changes (no pages) can resize blanks everywhere.
        this.renderAll(c.kind === 'content' && c.pages?.length ? c.pages : undefined);
      }),
      editor.subscribe(() => this.renderAll()),
    );
  }

  attach(pane: PdfPane): void {
    this.panes.add(pane);
    pane.addDecorator(this);
  }

  detach(pane: PdfPane): void {
    this.panes.delete(pane);
  }

  setTool(tool: Tool): void {
    this.tool = tool;
  }

  ctx(pane: PdfPane, view: PageView): PageContext {
    return { pane, view, vp: pane.viewportFor(view.pageNo) };
  }

  // ---- PageDecorator -----------------------------------------------------

  mount(view: PageView, pane: PdfPane): void {
    const ov = view.overlay;
    ov.addEventListener('pointerdown', (e) => this.tool?.onPointerDown(e, this.ctx(pane, view)));
    // Keep focus where the tool puts it (e.g. a new text box), and avoid
    // starting a native text selection on the page.
    ov.addEventListener('contextmenu', (e) => {
      if (this.tool?.wantsContextMenu) e.preventDefault();
    });
    ov.addEventListener('mousedown', (e) => {
      if (!(e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement)) e.preventDefault();
    });
    this.renderPage(pane, view);
  }

  layout(view: PageView, pane: PdfPane): void {
    if (view.overlay.isConnected || view.el.parentElement) this.renderPage(pane, view);
  }

  unmount(view: PageView, pane: PdfPane): void {
    this.tool?.onUnmount?.(this.ctx(pane, view));
  }

  // ---- rendering ---------------------------------------------------------

  renderAll(pages?: number[]): void {
    for (const pane of this.panes) {
      for (const view of pane.pageViews) {
        if (!pages || pages.includes(view.pageNo)) this.renderPage(pane, view);
      }
    }
  }

  renderPage(pane: PdfPane, view: PageView): void {
    const ctx = this.ctx(pane, view);
    const pa = getPage(this.store.doc, view.pageNo);
    this.renderAreas(view, pa?.areas ?? [], ctx.vp);
    const texts = pa?.texts ?? [];
    const existing = new Map<string, HTMLElement>();
    for (const n of view.overlay.querySelectorAll<HTMLElement>(':scope > .ann-text[data-id]')) existing.set(n.dataset.id!, n);

    for (const tb of texts) {
      let node = existing.get(tb.id);
      existing.delete(tb.id);
      if (!node) {
        node = createTextNode(tb.id);
        view.overlay.appendChild(node);
      }
      updateTextNode(node, tb, ctx.vp, {
        selected: this.editor.isSelected(tb.id),
        editing: !!this.tool?.isEditing?.(pane, tb.id),
      });
    }
    for (const n of existing.values()) n.remove();
    this.renderBlanks(view, pa?.blanks ?? [], texts, ctx.vp);
    this.renderUnderlines(view, pa?.underlines ?? [], ctx.vp);
    this.renderMarks(view, pa?.marks ?? [], ctx.vp);
    this.tool?.afterRender?.(ctx);
  }

  private renderMarks(view: PageView, marks: Mark[], vp: Viewport): void {
    const existing = new Map<string, HTMLElement>();
    for (const n of view.overlay.querySelectorAll<HTMLElement>(':scope > .ann-mark')) existing.set(n.dataset.id!, n);
    for (const m of marks) {
      let node = existing.get(m.id);
      existing.delete(m.id);
      if (!node || node.dataset.kind !== m.kind) {
        node?.remove();
        node = createMarkNode(m);
        view.overlay.appendChild(node);
      }
      const [sx, sy] = pdfToScreen(vp, m.x, m.y);
      const px = m.size * vp.scale;
      const s = node.style;
      s.left = `${sx - px / 2}px`;
      s.top = `${sy - px / 2}px`;
      s.width = s.height = `${px}px`;
      node.classList.toggle('selected', this.editor.isSelected(m.id));
    }
    for (const n of existing.values()) n.remove();
  }

  private renderUnderlines(view: PageView, lines: Underline[], vp: Viewport): void {
    const existing = new Map<string, HTMLElement>();
    for (const n of view.overlay.querySelectorAll<HTMLElement>(':scope > .ann-underline')) existing.set(n.dataset.id!, n);
    for (const u of lines) {
      let node = existing.get(u.id);
      existing.delete(u.id);
      if (!node) {
        node = el('div', { class: 'ann-underline', 'data-id': u.id }, el('span', { class: 'ann-underline-bar' }));
        view.overlay.appendChild(node);
      }
      placeUnderline(node, vp, u);
      node.classList.toggle('selected', this.editor.isSelected(u.id));
    }
    for (const n of existing.values()) n.remove();
  }

  /** Numbered markers in fill order; a blank with text in it is "filled" (hidden outside Blanks mode). */
  private renderBlanks(view: PageView, blanks: Blank[], texts: TextBox[], vp: Viewport): void {
    const existing = new Map<string, HTMLElement>();
    for (const n of view.overlay.querySelectorAll<HTMLElement>(':scope > .ann-blank')) existing.set(n.dataset.id!, n);
    const fontSize = this.store.doc.settings.defaultFontSize;
    blanks.forEach((b, i) => {
      let node = existing.get(b.id);
      existing.delete(b.id);
      if (!node) {
        node = el('div', { class: 'ann-blank', 'data-id': b.id }, el('span', { class: 'ann-blank-no' }));
        view.overlay.appendChild(node);
      }
      const r = blankRect(vp, b, fontSize);
      const s = node.style;
      s.left = `${r.left}px`;
      s.top = `${r.top}px`;
      s.width = `${r.width}px`;
      s.height = `${r.height}px`;
      const no = node.firstElementChild as HTMLElement;
      if (no.textContent !== String(i + 1)) no.textContent = String(i + 1);
      node.classList.toggle('filled', !!boxForBlank(texts, b.id));
      node.classList.toggle('selected', this.editor.isSelected(b.id));
    });
    for (const n of existing.values()) n.remove();
  }

  private renderAreas(view: PageView, areas: AnswerArea[], vp: Viewport): void {
    const existing = new Map<string, HTMLElement>();
    for (const n of view.overlay.querySelectorAll<HTMLElement>(':scope > .ann-area')) existing.set(n.dataset.id!, n);
    // Areas come first in the overlay (below text boxes), in document order so
    // the last drawn is on top. Nodes are only moved when out of place, since
    // moving a node would drop an active pointer capture.
    let prev: HTMLElement | null = null;
    for (const area of areas) {
      let node = existing.get(area.id);
      existing.delete(area.id);
      if (!node) node = createAreaNode(area.id);
      const expected: ChildNode | null = prev ? prev.nextSibling : view.overlay.firstChild;
      if (expected !== node) view.overlay.insertBefore(node, expected);
      updateAreaNode(node, area, vp, this.editor.isSelected(area.id));
      prev = node;
    }
    for (const n of existing.values()) n.remove();
  }

  destroy(): void {
    for (const d of this.disposers) d();
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function createMarkNode(m: Mark): HTMLElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '-0.5 -0.5 1 1');
  for (const line of MARK_PATHS[m.kind]) {
    const pl = document.createElementNS(SVG_NS, 'polyline');
    pl.setAttribute('points', line.map(([x, y]) => `${x},${y}`).join(' '));
    pl.setAttribute('fill', 'none');
    pl.setAttribute('stroke', MARK_COLORS[m.kind]);
    pl.setAttribute('stroke-width', String(MARK_STROKE));
    pl.setAttribute('stroke-linecap', 'round');
    pl.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(pl);
  }
  const node = el('div', {
    class: `ann-mark ${m.kind}`,
    'data-id': m.id,
    'data-kind': m.kind,
    title: m.kind === 'check' ? 'Correct (click: remove · drag: move · right-click: mark wrong)' : 'Wrong (click: remove · drag: move · right-click: edit correction)',
  });
  node.appendChild(svg);
  return node;
}

/**
 * Positions an underline node: a horizontal strip (tall enough to click)
 * from the start point, rotated to the line's on-screen direction.
 */
export function placeUnderline(node: HTMLElement, vp: Viewport, u: Pick<Underline, 'x' | 'y' | 'dx' | 'dy' | 'width' | 'color'>): void {
  const [x1, y1] = pdfToScreen(vp, u.x, u.y);
  const [x2, y2] = pdfToScreen(vp, u.x + u.dx, u.y + u.dy);
  const thick = Math.max(1, u.width * vp.scale);
  const hit = Math.max(10, thick);
  const s = node.style;
  s.left = `${x1}px`;
  s.top = `${y1 - hit / 2}px`;
  s.width = `${Math.hypot(x2 - x1, y2 - y1)}px`;
  s.height = `${hit}px`;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  s.transform = Math.abs(angle) > 1e-3 ? `rotate(${angle}rad)` : '';
  const bar = (node.firstElementChild as HTMLElement).style;
  bar.height = `${thick}px`;
  bar.marginTop = `${-thick / 2}px`;
  bar.background = u.color;
}

export const AREA_HANDLES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
export type AreaHandle = (typeof AREA_HANDLES)[number];

function createAreaNode(id: string): HTMLElement {
  return el(
    'div',
    { class: 'ann-area', 'data-id': id },
    el('span', { class: 'ann-area-label' }),
    ...AREA_HANDLES.map((h) => el('span', { class: `ann-area-handle h-${h}`, 'data-handle': h })),
  );
}

/** CSS variables for the row separators: first one after row 0, then every `spacing`. */
export function setRowVars(node: HTMLElement, area: Pick<AnswerArea, 'height' | 'lines' | 'fontSize'>, scale: number): void {
  const s = node.style;
  if (area.lines <= 1) {
    s.setProperty('--row', `${area.height * scale + 100}px`);
    s.setProperty('--row-offset', '0px');
    return;
  }
  const spacing = rowSpacing(area) * scale;
  s.setProperty('--row', `${spacing}px`);
  s.setProperty('--row-offset', `${firstRowHeight(area) * scale - spacing}px`);
}

/** Screen rectangle (page-local CSS px) of a PDF-space rectangle. */
export function screenRect(vp: Viewport, x: number, y: number, w: number, h: number) {
  const [ax, ay] = pdfToScreen(vp, x, y);
  const [bx, by] = pdfToScreen(vp, x + w, y - h);
  return { left: Math.min(ax, bx), top: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}

function updateAreaNode(node: HTMLElement, area: AnswerArea, vp: Viewport, selected: boolean): void {
  const r = screenRect(vp, area.x, area.y, area.width, area.height);
  const s = node.style;
  s.left = `${r.left}px`;
  s.top = `${r.top}px`;
  s.width = `${r.width}px`;
  s.height = `${r.height}px`;
  setRowVars(node, area, vp.scale);
  node.classList.toggle('selected', selected);
  const label = node.firstElementChild as HTMLElement;
  label.textContent = `${area.lines} ${area.lines === 1 ? 'line' : 'lines'}`;
}

export function createTextNode(id: string): HTMLElement {
  return el(
    'div',
    { class: 'ann-text', 'data-id': id },
    el('span', { class: 'ann-body' }),
    el('span', { class: 'ann-grip', title: 'Drag to move (or Alt+drag the text)' }),
    el('span', { class: 'ann-resize', title: 'Drag to set width · double-click for automatic width' }),
  );
}

/** Applies a text box's geometry and style for the given viewport. */
export function applyTextStyle(node: HTMLElement, tb: TextBox, vp: Viewport): void {
  const [sx, sy] = pdfToScreen(vp, tb.x, tb.y);
  const s = node.style;
  s.left = `${sx}px`;
  s.top = `${sy}px`;
  s.fontFamily = `'${TEXT_FONT_FAMILY}'`;
  s.fontSize = `${tb.fontSize * vp.scale}px`;
  s.lineHeight = String(LINE_HEIGHT);
  s.color = tb.color;
  s.width = tb.width !== null ? `${tb.width * vp.scale}px` : '';
  node.classList.toggle('fixed-width', tb.width !== null);
}

/** A trailing newline only takes up a line if something follows it. */
export function displayText(text: string): string {
  return text.endsWith('\n') ? `${text}​` : text;
}

function updateTextNode(node: HTMLElement, tb: TextBox, vp: Viewport, st: { selected: boolean; editing: boolean }): void {
  applyTextStyle(node, tb, vp);
  const body = node.firstElementChild as HTMLElement;
  const shown = displayText(tb.text);
  if (body.textContent !== shown) body.textContent = shown;
  node.classList.toggle('selected', st.selected);
  node.classList.toggle('editing', st.editing);
  node.classList.toggle('empty', tb.text === '');
  node.classList.toggle('correction', tb.kind === 'correction');
}
