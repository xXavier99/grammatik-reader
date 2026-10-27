// Select mode: pick text boxes, ✓/✗ marks, blanks, underlines and covers to move or delete them.
// Click selects one item, Shift/Ctrl+click adds or removes it, dragging on
// empty space selects everything the rectangle touches, dragging a selected
// item moves the whole selection. Delete removes it.

import { screenToPdf } from '../model/coords';
import { deleteOp, findEntity, getPage, updateOp, type Collection, type Mutation } from '../model/history';
import type { SidecarDoc } from '../model/schema';
import type { Store } from '../model/store';
import { roundPt } from '../model/text';
import type { PageContext, Tool } from '../ui/annotations';
import { el } from '../ui/dom';
import type { EditorState, Selection } from './editor';

const DRAG_THRESHOLD = 3;

/** Overlay nodes that can be selected, with the collection each belongs to. */
const ITEM_SELECTORS: [string, Collection][] = [
  ['.ann-text[data-id]', 'texts'],
  ['.ann-mark', 'marks'],
  ['.ann-blank:not(.filled)', 'blanks'],
  ['.ann-underline', 'underlines'],
  // Last: a cover lies under everything else, so items on it win.
  ['.ann-cover[data-id]', 'covers'],
];

function itemAt(target: HTMLElement): { node: HTMLElement; coll: Collection } | null {
  for (const [sel, coll] of ITEM_SELECTORS) {
    const node = target.closest<HTMLElement>(sel);
    if (node) return { node, coll };
  }
  return null;
}

/**
 * Mutations deleting `items` together with what depends on them: a mark's
 * corrections go with it; text typed into a deleted blank stays, unlinked.
 */
export function deletionOps(doc: SidecarDoc, items: readonly Selection[]): Mutation[] {
  const doomed = new Map<string, Selection>();
  for (const it of items) {
    doomed.set(it.id, it);
    if (it.coll === 'marks') {
      for (const t of getPage(doc, it.page)?.texts ?? []) {
        if (t.markId === it.id) doomed.set(t.id, { page: it.page, coll: 'texts', id: t.id });
      }
    }
  }
  const ops: (Mutation | null)[] = [];
  for (const it of doomed.values()) {
    ops.push(deleteOp(doc, it.page, it.coll, it.id));
    if (it.coll !== 'blanks') continue;
    for (const t of getPage(doc, it.page)?.texts ?? []) {
      if (t.blankId === it.id && !doomed.has(t.id)) ops.push(updateOp(doc, it.page, 'texts', t.id, { blankId: undefined }));
    }
  }
  return ops.filter((m): m is Mutation => !!m);
}

export class SelectTool implements Tool {
  private seq = 0;

  constructor(
    private store: Store,
    private editor: EditorState,
  ) {}

  onPointerDown(e: PointerEvent, ctx: PageContext): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const page = ctx.view.pageNo;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const hit = itemAt(e.target as HTMLElement);
    // A selection lives on one page.
    const current = this.editor.selected.filter((s) => s.page === page);

    if (!hit) {
      this.startBand(e, ctx, additive ? current : []);
      return;
    }
    const item: Selection = { page, coll: hit.coll, id: hit.node.dataset.id! };
    const wasSelected = current.some((s) => s.id === item.id);
    if (additive) {
      this.editor.selectMany(wasSelected ? current.filter((s) => s.id !== item.id) : [...current, item]);
      return;
    }
    if (!wasSelected) this.editor.select(item);
    this.startMove(e, ctx, hit.node, () => {
      // A plain click inside a multiple selection narrows it to this item.
      if (wasSelected) this.editor.select(item);
    });
  }

  // ---- move --------------------------------------------------------------

  private startMove(e: PointerEvent, ctx: PageContext, node: HTMLElement, onClick: () => void): void {
    const page = ctx.view.pageNo;
    const doc = this.store.doc;
    // Snapshot start positions; marks bring their corrections along.
    const starts = new Map<string, { coll: Collection; x: number; y: number }>();
    for (const s of this.editor.selected) {
      const ent = findEntity(doc, page, s.coll, s.id);
      if (!ent) continue;
      starts.set(s.id, { coll: s.coll, x: ent.x, y: ent.y });
      if (s.coll === 'marks') {
        for (const t of getPage(doc, page)?.texts ?? []) {
          if (t.markId === s.id) starts.set(t.id, { coll: 'texts', x: t.x, y: t.y });
        }
      }
    }
    const key = `select-move:${++this.seq}`;
    const rect = ctx.view.overlay.getBoundingClientRect();
    const [x0, y0] = screenToPdf(ctx.vp, e.clientX - rect.left, e.clientY - rect.top);
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    node.setPointerCapture(e.pointerId);
    document.body.classList.add('dragging-move');

    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_THRESHOLD) return;
      moved = true;
      const [x1, y1] = screenToPdf(ctx.vp, ev.clientX - rect.left, ev.clientY - rect.top);
      const dx = x1 - x0;
      const dy = y1 - y0;
      const ops = [...starts].map(([id, s]) => updateOp(this.store.doc, page, s.coll, id, { x: roundPt(s.x + dx), y: roundPt(s.y + dy) }));
      this.store.change(starts.size > 1 ? 'Move selection' : 'Move', ops, key);
    };
    const onUp = () => {
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', onUp);
      node.removeEventListener('pointercancel', onUp);
      document.body.classList.remove('dragging-move');
      this.store.history.seal();
      if (!moved) onClick();
    };
    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerup', onUp);
    node.addEventListener('pointercancel', onUp);
  }

  // ---- rectangle selection -----------------------------------------------

  private startBand(e: PointerEvent, ctx: PageContext, base: Selection[]): void {
    const page = ctx.view.pageNo;
    const overlay = ctx.view.overlay;
    const rect = overlay.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    let ex = sx;
    let ey = sy;
    this.editor.selectMany(base);
    const band = el('div', { class: 'select-band' });
    overlay.appendChild(band);
    overlay.setPointerCapture(e.pointerId);

    const update = () => {
      const l = Math.min(sx, ex);
      const t = Math.min(sy, ey);
      const r = Math.max(sx, ex);
      const b = Math.max(sy, ey);
      const s = band.style;
      s.left = `${l}px`;
      s.top = `${t}px`;
      s.width = `${r - l}px`;
      s.height = `${b - t}px`;
      if (r - l < DRAG_THRESHOLD && b - t < DRAG_THRESHOLD) return;
      const hits: Selection[] = [];
      const o = overlay.getBoundingClientRect();
      for (const [sel, coll] of ITEM_SELECTORS) {
        for (const n of overlay.querySelectorAll<HTMLElement>(`:scope > ${sel}`)) {
          // Rendered bounds (include rotation, e.g. diagonal lines), in overlay coordinates.
          const nr = n.getBoundingClientRect();
          // Covers are large backgrounds: only taken when the rectangle encloses them.
          const intersects = coll === 'covers'
            ? nr.left - o.left >= l && nr.right - o.left <= r && nr.top - o.top >= t && nr.bottom - o.top <= b
            : nr.left - o.left < r && nr.right - o.left > l && nr.top - o.top < b && nr.bottom - o.top > t;
          if (intersects && !base.some((s) => s.id === n.dataset.id)) hits.push({ page, coll, id: n.dataset.id! });
        }
      }
      this.editor.selectMany([...base, ...hits]);
    };
    const onMove = (ev: PointerEvent) => {
      ex = ev.clientX - rect.left;
      ey = ev.clientY - rect.top;
      update();
    };
    const onUp = () => {
      overlay.removeEventListener('pointermove', onMove);
      overlay.removeEventListener('pointerup', onUp);
      overlay.removeEventListener('pointercancel', onUp);
      band.remove();
    };
    overlay.addEventListener('pointermove', onMove);
    overlay.addEventListener('pointerup', onUp);
    overlay.addEventListener('pointercancel', onUp);
  }

  // ---- commands ----------------------------------------------------------

  deleteSelection(): boolean {
    const items = this.editor.selected;
    if (!items.length) return false;
    this.store.change(items.length > 1 ? 'Delete selection' : 'Delete', deletionOps(this.store.doc, items));
    this.editor.select(null);
    return true;
  }
}
