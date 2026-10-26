// Blanks mode: click where each answer starts, in the order they should be
// filled. Click a blank to select it, drag to move it, Delete removes it.
// Enter starts typing in the selected blank (or the first empty one).

import { firstEmptyBlank } from '../model/blanks';
import { screenToPdf } from '../model/coords';
import { createOp, findEntity, getPage, newId, updateOp } from '../model/history';
import type { Blank } from '../model/schema';
import type { Store } from '../model/store';
import { roundPt } from '../model/text';
import type { PageContext, Tool } from '../ui/annotations';
import type { PdfPane } from '../ui/pane';
import type { EditorState } from './editor';
import { deletionOps } from './select';

const DRAG_THRESHOLD = 3;

export class BlankTool implements Tool {
  private seq = 0;

  constructor(
    private store: Store,
    private editor: EditorState,
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
    const rect = ctx.view.overlay.getBoundingClientRect();
    const [x, y] = screenToPdf(ctx.vp, e.clientX - rect.left, e.clientY - rect.top);
    const blank: Blank = { id: newId('b'), x: roundPt(x), y: roundPt(y) };
    this.store.change('Add blank', [createOp(ctx.view.pageNo, 'blanks', blank)]);
    this.editor.select(null);
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
