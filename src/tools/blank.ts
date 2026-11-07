// Blanks mode: click where each answer starts, in the order they should be
// filled, or drag a rectangle to place one on every printed gap line in it.
// Click a blank to select it, drag to move it, Delete removes it.
// Enter starts typing in the selected blank (or the first empty one).

import { detectGaps, type PixelRect } from '../model/blankDetect';
import { firstEmptyBlank } from '../model/blanks';
import { screenToPdf } from '../model/coords';
import { createOp, findEntity, getPage, newId, updateOp, type Mutation } from '../model/history';
import type { Blank } from '../model/schema';
import type { Store } from '../model/store';
import { roundPt } from '../model/text';
import { CancelledError, Priority, type Renderer } from '../pdf/renderer';
import type { PageContext, Tool } from '../ui/annotations';
import { toast } from '../ui/dialogs';
import { el } from '../ui/dom';
import type { PdfPane } from '../ui/pane';
import type { EditorState } from './editor';
import { deletionOps } from './select';

const DRAG_THRESHOLD = 3;
/** Resolution (px per PDF unit) the page is scanned at for gap lines. */
const SCAN_SCALE = 3;
/** Page area scanned around the rectangle (pt), to find the text next to and above each line. */
const SCAN_MARGIN_PT = 25;
/** A detected line this close (pt) to an existing blank already has one. */
const DUPLICATE_PT = 6;

export class BlankTool implements Tool {
  private seq = 0;

  constructor(
    private store: Store,
    private editor: EditorState,
    private renderer: Renderer,
  ) {}

  onPointerDown(e: PointerEvent, ctx: PageContext): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const node = (e.target as HTMLElement).closest<HTMLElement>('.ann-blank');
    if (node) {
      this.editor.select({ page: ctx.view.pageNo, coll: 'blanks', id: node.dataset.id! });
      this.startDrag(e, ctx, node.dataset.id!, node);
      return;
    }
    this.editor.select(null);
    this.startPlace(e, ctx);
  }

  /** A click places one blank; dragging a rectangle places one on every gap line inside it. */
  private startPlace(e: PointerEvent, ctx: PageContext): void {
    const overlay = ctx.view.overlay;
    const rect = overlay.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    let ex = sx;
    let ey = sy;
    let preview: HTMLElement | null = null;
    overlay.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      ex = ev.clientX - rect.left;
      ey = ev.clientY - rect.top;
      if (!preview && Math.hypot(ex - sx, ey - sy) < DRAG_THRESHOLD) return;
      preview ??= overlay.appendChild(el('div', { class: 'blank-scan' }));
      const s = preview.style;
      s.left = `${Math.min(sx, ex)}px`;
      s.top = `${Math.min(sy, ey)}px`;
      s.width = `${Math.abs(ex - sx)}px`;
      s.height = `${Math.abs(ey - sy)}px`;
    };
    const onUp = () => {
      overlay.removeEventListener('pointermove', onMove);
      overlay.removeEventListener('pointerup', onUp);
      overlay.removeEventListener('pointercancel', onUp);
      if (!preview) {
        const [x, y] = screenToPdf(ctx.vp, sx, sy);
        const blank: Blank = { id: newId('b'), x: roundPt(x), y: roundPt(y) };
        this.store.change('Add blank', [createOp(ctx.view.pageNo, 'blanks', blank)]);
        return;
      }
      const sel = { left: Math.min(sx, ex), top: Math.min(sy, ey), right: Math.max(sx, ex), bottom: Math.max(sy, ey) };
      const node = preview;
      node.classList.add('busy');
      this.placeOnGaps(ctx, sel)
        .catch((err) => {
          if (!(err instanceof CancelledError)) toast(`Could not scan the page: ${err}`, 'error');
        })
        .finally(() => node.remove());
    };
    overlay.addEventListener('pointermove', onMove);
    overlay.addEventListener('pointerup', onUp);
    overlay.addEventListener('pointercancel', onUp);
  }

  /** Places a blank on each gap line in `sel` (page-local CSS px) that has none yet. */
  private async placeOnGaps(ctx: PageContext, sel: PixelRect): Promise<void> {
    const page = ctx.view.pageNo;
    const cached = this.renderer.peekAny(page);
    const { canvas, scale } = cached && cached.scale >= SCAN_SCALE * 0.75
      ? cached
      : { canvas: await this.renderer.render(page, SCAN_SCALE, Priority.Visible), scale: SCAN_SCALE };
    // Canvas pixels are the page viewport at `scale` instead of ctx.vp.scale.
    const k = scale / ctx.vp.scale;
    const margin = SCAN_MARGIN_PT * scale;
    const left = Math.max(0, Math.floor(sel.left * k - margin));
    const top = Math.max(0, Math.floor(sel.top * k - margin));
    const right = Math.min(canvas.width, Math.ceil(sel.right * k + margin));
    const bottom = Math.min(canvas.height, Math.ceil(sel.bottom * k + margin));
    if (right <= left || bottom <= top) return;
    const img = canvas.getContext('2d')!.getImageData(left, top, right - left, bottom - top);
    const gaps = detectGaps(img, scale, {
      left: sel.left * k - left, top: sel.top * k - top, right: sel.right * k - left, bottom: sel.bottom * k - top,
    });

    const existing = getPage(this.store.doc, page)?.blanks ?? [];
    const ops: Mutation[] = [];
    for (const g of gaps) {
      const [x, y] = screenToPdf(ctx.vp, (g.x + left) / k, (g.y + top) / k);
      if (existing.some((b) => Math.abs(b.x - x) < DUPLICATE_PT && Math.abs(b.y - y) < DUPLICATE_PT)) continue;
      ops.push(createOp(page, 'blanks', { id: newId('b'), x: roundPt(x), y: roundPt(y) }));
    }
    if (ops.length) this.store.change(ops.length === 1 ? 'Add blank' : `Add ${ops.length} blanks`, ops);
    else toast(gaps.length ? 'Every gap line here already has a blank.' : 'No gap lines found in the selection.');
  }

  private startDrag(e: PointerEvent, ctx: PageContext, id: string, node: HTMLElement): void {
    const page = ctx.view.pageNo;
    const start = findEntity(this.store.doc, page, 'blanks', id);
    if (!start) return;
    const key = `move-blank:${id}:${++this.seq}`;
    const rect = ctx.view.overlay.getBoundingClientRect();
    const [x0, y0] = screenToPdf(ctx.vp, e.clientX - rect.left, e.clientY - rect.top);
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    node.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_THRESHOLD) return;
      moved = true;
      const [x1, y1] = screenToPdf(ctx.vp, ev.clientX - rect.left, ev.clientY - rect.top);
      const patch = { x: roundPt(start.x + x1 - x0), y: roundPt(start.y + y1 - y0) };
      this.store.change('Move blank', [updateOp(this.store.doc, page, 'blanks', id, patch)], key);
    };
    const onUp = () => {
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', onUp);
      node.removeEventListener('pointercancel', onUp);
      this.store.history.seal();
    };
    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerup', onUp);
    node.addEventListener('pointercancel', onUp);
  }

  /** Removes the selected blank (text typed into it stays). */
  deleteSelection(): boolean {
    const sel = this.editor.selection;
    if (!sel || sel.coll !== 'blanks') return false;
    this.store.change('Delete blank', deletionOps(this.store.doc, [sel]));
    this.editor.select(null);
    return true;
  }

  /** The blank to start typing in: the selected one, else the first empty one on the pane's page. */
  blankToFill(pane: PdfPane): { page: number; blank: Blank } | null {
    const sel = this.editor.selection;
    if (sel?.coll === 'blanks') {
      const blank = findEntity(this.store.doc, sel.page, 'blanks', sel.id);
      if (blank) return { page: sel.page, blank };
    }
    const pa = getPage(this.store.doc, pane.page);
    const blank = pa && firstEmptyBlank(pa.blanks, pa.texts);
    return blank ? { page: pane.page, blank } : null;
  }
}
