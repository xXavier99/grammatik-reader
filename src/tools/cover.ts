// Cover mode: drag to draw a white rectangle that hides part of the printed
// page; select, move, resize by edges/corners, delete. Covers sit below every
// other annotation, so text can be written on top of them in Text mode.

import { rectFromCorners } from '../model/areas';
import { screenToPdf } from '../model/coords';
import { createOp, findEntity, newId, updateOp } from '../model/history';
import type { Cover } from '../model/schema';
import type { Store } from '../model/store';
import { roundPt } from '../model/text';
import { screenRect, type AreaHandle, type PageContext, type Tool } from '../ui/annotations';
import { el } from '../ui/dom';
import { resizeArea } from './area';
import type { EditorState } from './editor';

const MIN_DRAW_PX = 4;
const DRAG_THRESHOLD = 3;

export class CoverTool implements Tool {
  private seq = 0;

  constructor(
    private store: Store,
    private editor: EditorState,
  ) {}

  onPointerDown(e: PointerEvent, ctx: PageContext): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const target = e.target as HTMLElement;
    const node = target.closest<HTMLElement>('.ann-cover');
    if (node) {
      const id = node.dataset.id!;
      this.editor.select({ page: ctx.view.pageNo, coll: 'covers', id });
      this.startDrag(e, ctx, id, (target.dataset.handle as AreaHandle | undefined) ?? 'move');
    } else {
      this.editor.select(null);
      this.startDraw(e, ctx);
    }
  }

  private startDraw(e: PointerEvent, ctx: PageContext): void {
    const overlay = ctx.view.overlay;
    const rect = overlay.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const preview = el('div', { class: 'ann-cover drawing' });
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
      const cover: Cover = { id: newId('w'), x: roundPt(r.x), y: roundPt(r.y), width: roundPt(r.width), height: roundPt(r.height) };
      this.store.change('Add cover', [createOp(ctx.view.pageNo, 'covers', cover)]);
      this.editor.select({ page: ctx.view.pageNo, coll: 'covers', id: cover.id });
    };
    overlay.addEventListener('pointermove', onMove);
    overlay.addEventListener('pointerup', onUp);
    overlay.addEventListener('pointercancel', onUp);
  }

  private startDrag(e: PointerEvent, ctx: PageContext, id: string, handle: AreaHandle | 'move'): void {
    const page = ctx.view.pageNo;
    const start = findEntity(this.store.doc, page, 'covers', id);
    if (!start) return;
    const key = `cover:${handle}:${id}:${++this.seq}`;
    const target = e.target as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const sx = e.clientX;
    const sy = e.clientY;
    const r0 = screenRect(ctx.vp, start.x, start.y, start.width, start.height);
    const [px0, py0] = screenToPdf(ctx.vp, r0.left, r0.top);
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      const dxs = ev.clientX - sx;
      const dys = ev.clientY - sy;
      if (!moved && Math.hypot(dxs, dys) < DRAG_THRESHOLD) return;
      moved = true;
      const [px, py] = screenToPdf(ctx.vp, r0.left + dxs, r0.top + dys);
      const g = resizeArea(start, handle, px - px0, py - py0);
      this.store.change(handle === 'move' ? 'Move cover' : 'Resize cover', [updateOp(this.store.doc, page, 'covers', id, g)], key);
    };
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      this.store.history.seal();
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  }
}
