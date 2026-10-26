// Area mode: draw answer areas (split evenly into N rows), select, move,
// resize by edges/corners, delete, change the line count.

import { rectFromCorners, rowSpacing } from '../model/areas';
import { screenToPdf } from '../model/coords';
import { createOp, deleteOp, findEntity, newId, updateOp } from '../model/history';
import type { AnswerArea } from '../model/schema';
import type { Store } from '../model/store';
import { roundPt } from '../model/text';
import { screenRect, setRowVars, type AreaHandle, type PageContext, type Tool } from '../ui/annotations';
import { el } from '../ui/dom';
import type { EditorState } from './editor';

const MIN_DRAW_PX = 6;
const MIN_SIZE_PT = 4;
const DRAG_THRESHOLD = 3;

export class AreaTool implements Tool {
  private seq = 0;

  constructor(
    private store: Store,
    private editor: EditorState,
    /** Called after a new area is drawn (the session starts typing in its first row). */
    private onDrawn: (ctx: PageContext, area: AnswerArea) => void,
  ) {}

  onPointerDown(e: PointerEvent, ctx: PageContext): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const target = e.target as HTMLElement;
    const node = target.closest<HTMLElement>('.ann-area');
    if (node) {
      const id = node.dataset.id!;
      this.editor.select({ page: ctx.view.pageNo, coll: 'areas', id });
      this.startDrag(e, ctx, id, (target.dataset.handle as AreaHandle | undefined) ?? 'move');
    } else {
      this.editor.select(null);
      this.startDraw(e, ctx);
    }
  }

  // ---- draw --------------------------------------------------------------

  private startDraw(e: PointerEvent, ctx: PageContext): void {
    const overlay = ctx.view.overlay;
    const rect = overlay.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const preview = el('div', { class: 'ann-area drawing' });
    overlay.appendChild(preview);
    overlay.setPointerCapture(e.pointerId);
    let ex = sx;
    let ey = sy;
    const place = () => {
      const s = preview.style;
      s.left = `${Math.min(sx, ex)}px`;
      s.top = `${Math.min(sy, ey)}px`;
      s.width = `${Math.abs(ex - sx)}px`;
      s.height = `${Math.abs(ey - sy)}px`;
      const { areaLines: lines, defaultFontSize: fontSize } = this.store.doc.settings;
      setRowVars(preview, { height: Math.abs(ey - sy) / ctx.vp.scale, lines, fontSize }, ctx.vp.scale);
    };
    place();
    const onMove = (ev: PointerEvent) => {
      ex = ev.clientX - rect.left;
      ey = ev.clientY - rect.top;
      place();
    };
    const onUp = () => {
      overlay.removeEventListener('pointermove', onMove);
      overlay.removeEventListener('pointerup', onUp);
      overlay.removeEventListener('pointercancel', onUp);
      preview.remove();
      if (Math.abs(ex - sx) < MIN_DRAW_PX || Math.abs(ey - sy) < MIN_DRAW_PX) return;
      const [x1, y1] = screenToPdf(ctx.vp, sx, sy);
      const [x2, y2] = screenToPdf(ctx.vp, ex, ey);
      const r = rectFromCorners(x1, y1, x2, y2);
      const area: AnswerArea = {
        id: newId('a'),
        x: roundPt(r.x),
        y: roundPt(r.y),
        width: roundPt(r.width),
        height: roundPt(r.height),
        lines: this.store.doc.settings.areaLines,
        fontSize: this.store.doc.settings.defaultFontSize,
      };
      this.store.change('Add answer area', [createOp(ctx.view.pageNo, 'areas', area)]);
      this.rememberSpacing(area);
      this.onDrawn(ctx, area);
    };
    overlay.addEventListener('pointermove', onMove);
    overlay.addEventListener('pointerup', onUp);
    overlay.addEventListener('pointercancel', onUp);
  }

  // ---- move / resize -----------------------------------------------------

  private startDrag(e: PointerEvent, ctx: PageContext, id: string, handle: AreaHandle | 'move'): void {
    const page = ctx.view.pageNo;
    const start = findEntity(this.store.doc, page, 'areas', id);
    if (!start) return;
    const key = `area:${handle}:${id}:${++this.seq}`;
    const target = e.target as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const sx = e.clientX;
    const sy = e.clientY;
    // Screen position of the area's top-left, to convert screen deltas into PDF deltas.
    const r0 = screenRect(ctx.vp, start.x, start.y, start.width, start.height);
    const [px0, py0] = screenToPdf(ctx.vp, r0.left, r0.top);
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      const dxs = ev.clientX - sx;
      const dys = ev.clientY - sy;
      if (!moved && Math.hypot(dxs, dys) < DRAG_THRESHOLD) return;
      moved = true;
      const [px, py] = screenToPdf(ctx.vp, r0.left + dxs, r0.top + dys);
      const dx = px - px0;
      const dy = py - py0;
      const g = resizeArea(start, handle, dx, dy);
      this.store.change(handle === 'move' ? 'Move answer area' : 'Resize answer area', [updateOp(this.store.doc, page, 'areas', id, g)], key);
    };
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      this.store.history.seal();
      const area = findEntity(this.store.doc, page, 'areas', id);
      if (area) this.rememberSpacing(area);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  }

  // ---- commands ----------------------------------------------------------

  /** Changes the line count of the selected area. Returns false if none is selected. */
  setLines(lines: number): boolean {
    const sel = this.editor.selection;
    if (!sel || sel.coll !== 'areas') return false;
    this.store.change('Change area lines', [updateOp(this.store.doc, sel.page, 'areas', sel.id, { lines })]);
    const area = findEntity(this.store.doc, sel.page, 'areas', sel.id);
    if (area) this.rememberSpacing(area);
    return true;
  }

  deleteSelection(): boolean {
    const sel = this.editor.selection;
    if (!sel || sel.coll !== 'areas') return false;
    this.store.change('Delete answer area', [deleteOp(this.store.doc, sel.page, 'areas', sel.id)]);
    this.editor.select(null);
    return true;
  }

  /** The row spacing of the last area touched is reused by Enter / ↑ / ↓ everywhere. */
  private rememberSpacing(area: AnswerArea): void {
    if (area.lines <= 1) return; // A single row has no spacing.
    const s = roundPt(rowSpacing(area));
    if (this.store.doc.settings.lineSpacing !== s) this.store.setSettings({ lineSpacing: s });
  }
}

/** New geometry after dragging `handle` by (dx, dy) PDF units. */
export function resizeArea(a: AnswerArea, handle: AreaHandle | 'move', dx: number, dy: number): Pick<AnswerArea, 'x' | 'y' | 'width' | 'height'> {
  let { x, y, width, height } = a;
  if (handle === 'move') return { x: roundPt(x + dx), y: roundPt(y + dy), width, height };
  if (handle.includes('n')) {
    const d = Math.max(dy, MIN_SIZE_PT - height);
    y += d;
    height += d;
  }
  if (handle.includes('s')) height = Math.max(MIN_SIZE_PT, height - dy);
  if (handle.includes('e')) width = Math.max(MIN_SIZE_PT, width + dx);
  if (handle.includes('w')) {
    const d = Math.min(dx, width - MIN_SIZE_PT);
    x += d;
    width -= d;
  }
  return { x: roundPt(x), y: roundPt(y), width: roundPt(width), height: roundPt(height) };
}
