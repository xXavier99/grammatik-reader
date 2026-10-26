// Underline mode: drag over printed text; a line is drawn along the bottom
// of the dragged rectangle, from its left to its right edge. Clicking a line
// selects it (Delete removes it).

import { screenToPdf } from '../model/coords';
import { createOp, newId } from '../model/history';
import { UNDERLINE_WIDTH, type Underline } from '../model/schema';
import type { Store } from '../model/store';
import { roundPt } from '../model/text';
import { placeUnderline, type PageContext, type Tool } from '../ui/annotations';
import { el } from '../ui/dom';
import type { EditorState } from './editor';

/** Shorter drags (CSS px) are treated as clicks. */
const MIN_LENGTH_PX = 4;

export class UnderlineTool implements Tool {
  constructor(
    private store: Store,
    private editor: EditorState,
  ) {}

  onPointerDown(e: PointerEvent, ctx: PageContext): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const hit = (e.target as HTMLElement).closest<HTMLElement>('.ann-underline');
    if (hit) {
      this.editor.select({ page: ctx.view.pageNo, coll: 'underlines', id: hit.dataset.id! });
      return;
    }
    this.editor.select(null);
    this.startDraw(e, ctx);
  }

  private startDraw(e: PointerEvent, ctx: PageContext): void {
    const overlay = ctx.view.overlay;
    const rect = overlay.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    let ex = sx;
    let ey = sy;
    const color = this.store.doc.settings.underlineColor;
    const band = el('div', { class: 'underline-band' });
    const preview = el('div', { class: 'ann-underline drawing' }, el('span', { class: 'ann-underline-bar' }));
    overlay.append(band, preview);
    overlay.setPointerCapture(e.pointerId);

    /** The line in PDF space: along the bottom of the drag, left to right on screen. */
    const line = (): Omit<Underline, 'id'> => {
      const bottom = Math.max(sy, ey);
      const [x, y] = screenToPdf(ctx.vp, Math.min(sx, ex), bottom);
      const [x2, y2] = screenToPdf(ctx.vp, Math.max(sx, ex), bottom);
      return { x, y, dx: x2 - x, dy: y2 - y, width: UNDERLINE_WIDTH, color };
    };
    const place = () => {
      const s = band.style;
      s.left = `${Math.min(sx, ex)}px`;
      s.top = `${Math.min(sy, ey)}px`;
      s.width = `${Math.abs(ex - sx)}px`;
      s.height = `${Math.abs(ey - sy)}px`;
      placeUnderline(preview, ctx.vp, line());
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
      band.remove();
      preview.remove();
      if (Math.abs(ex - sx) < MIN_LENGTH_PX) return;
      const l = line();
      const u: Underline = { id: newId('u'), ...l, x: roundPt(l.x), y: roundPt(l.y), dx: roundPt(l.dx), dy: roundPt(l.dy) };
      this.store.change('Underline', [createOp(ctx.view.pageNo, 'underlines', u)]);
    };
    overlay.addEventListener('pointermove', onMove);
    overlay.addEventListener('pointerup', onUp);
    overlay.addEventListener('pointercancel', onUp);
  }
}
