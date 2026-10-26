// Check mode: left click puts a ✓ next to an answer (or at the click),
// right click puts a ✗ and opens a correction next to it. Clicking a mark
// removes it, dragging moves it (with its correction); right-clicking a ✓
// turns it into a ✗.

import { screenToPdf } from '../model/coords';
import { createOp, deleteOp, findEntity, getPage, newId, updateOp, type Mutation } from '../model/history';
import type { Mark } from '../model/schema';
import type { Store } from '../model/store';
import { boxTopForClick, LINE_HEIGHT, roundPt } from '../model/text';
import type { PageContext, Tool } from '../ui/annotations';
import type { PdfPane } from '../ui/pane';
import type { TextTool } from './text';

const DRAG_THRESHOLD = 3;
/** How far right of an answer (CSS px, at least) a click still counts as "next to" it. */
const NEAR_RIGHT_PX = 48;
const NEAR_PAD_PX = 4;

export class CheckTool implements Tool {
  readonly wantsContextMenu = true;
  private seq = 0;

  constructor(
    private store: Store,
    private textTool: TextTool,
  ) {}

  // Correction boxes are edited by the text tool; forward its rendering hooks.
  isEditing(pane: PdfPane, id: string): boolean {
    return this.textTool.isEditing(pane, id);
  }
  afterRender(ctx: PageContext): void {
    this.textTool.afterRender(ctx);
  }
  onUnmount(ctx: PageContext): void {
    this.textTool.onUnmount(ctx);
  }

  onPointerDown(e: PointerEvent, ctx: PageContext): void {
    const right = e.button === 2;
    if (e.button !== 0 && !right) return;
    const target = e.target as HTMLElement;
    if (target instanceof HTMLTextAreaElement) return; // Typing in a correction.

    const markNode = target.closest<HTMLElement>('.ann-mark');
    if (markNode) {
      e.preventDefault();
      this.textTool.finishEditing();
      const id = markNode.dataset.id!;
      if (right) this.onMarkRightClick(ctx, id);
      else this.startMarkDrag(e, ctx, id, markNode);
      return;
    }

    const textNode = target.closest<HTMLElement>('.ann-text[data-id]');
    if (textNode?.classList.contains('correction') && !right) {
      this.textTool.onPointerDown(e, ctx); // Edit / move the correction.
      return;
    }

    e.preventDefault();
    this.textTool.finishEditing();
    const rect = ctx.view.overlay.getBoundingClientRect();
    const lx = e.clientX - rect.left;
    const ly = e.clientY - rect.top;
    if (right) {
      this.addCross(ctx, lx, ly);
      return;
    }
    const answer = textNode ?? this.answerNear(ctx, lx, ly);
    if (answer) this.checkAnswer(ctx, answer);
    else this.addMark(ctx, 'check', ...screenToPdf(ctx.vp, lx, ly));
  }

  // ---- placing marks -----------------------------------------------------

  /** The answer box whose row the click is in, slightly left of or right of it. */
  private answerNear(ctx: PageContext, x: number, y: number): HTMLElement | null {
    let best: HTMLElement | null = null;
    let bestDist = Infinity;
    const markPx = this.store.doc.settings.markSize * ctx.vp.scale;
    for (const n of ctx.view.overlay.querySelectorAll<HTMLElement>('.ann-text[data-id]:not(.correction)')) {
      const l = n.offsetLeft;
      const t = n.offsetTop;
      const r = l + n.offsetWidth;
      const b = t + n.offsetHeight;
      if (x < l - NEAR_PAD_PX || x > r + Math.max(NEAR_RIGHT_PX, markPx * 3)) continue;
      if (y < t - NEAR_PAD_PX || y > b + NEAR_PAD_PX) continue;
      const d = Math.abs(y - (t + b) / 2);
      if (d < bestDist) {
        best = n;
        bestDist = d;
      }
    }
    return best;
  }

  /** ✓ just right of an answer's first line; clicking the same spot again removes it. */
  private checkAnswer(ctx: PageContext, node: HTMLElement): void {
    const page = ctx.view.pageNo;
    const tb = findEntity(this.store.doc, page, 'texts', node.dataset.id!);
    if (!tb) return;
    const size = this.store.doc.settings.markSize;
    const markPx = size * ctx.vp.scale;
    const firstLinePx = Math.min(node.offsetHeight, tb.fontSize * LINE_HEIGHT * ctx.vp.scale);
    const [x, y] = screenToPdf(ctx.vp, node.offsetLeft + node.offsetWidth + markPx * 0.75, node.offsetTop + firstLinePx / 2);
    const existing = (getPage(this.store.doc, page)?.marks ?? []).find((m) => Math.hypot(m.x - x, m.y - y) < size * 0.8);
    if (existing) this.removeMark(page, existing.id);
    else this.addMark(ctx, 'check', x, y);
  }

  private addMark(ctx: PageContext, kind: Mark['kind'], x: number, y: number, key?: string): Mark {
    const mark: Mark = { id: newId('m'), kind, x: roundPt(x), y: roundPt(y), size: this.store.doc.settings.markSize };
    this.store.change(kind === 'check' ? 'Mark correct' : 'Mark wrong', [createOp(ctx.view.pageNo, 'marks', mark)], key);
    return mark;
  }

  /** ✗ at the click, plus a correction box to its right (one undo step together). */
  private addCross(ctx: PageContext, lx: number, ly: number): void {
    const key = `cross:${++this.seq}`;
    const [x, y] = screenToPdf(ctx.vp, lx, ly);
    const mark = this.addMark(ctx, 'cross', x, y, key);
    this.openCorrection(ctx, mark, key);
  }

  private openCorrection(ctx: PageContext, mark: Mark, key?: string): void {
    const existing = this.correctionsOf(ctx.view.pageNo, mark.id)[0];
    if (existing) {
      this.textTool.startEditing(ctx, existing.id, null);
      return;
    }
    const s = this.store.doc.settings;
    this.textTool.createBox(
      ctx,
      {
        x: mark.x + mark.size * 0.75,
        y: boxTopForClick(mark.y, s.defaultFontSize),
        fontSize: s.defaultFontSize,
        color: s.correctionColor,
        kind: 'correction',
        markId: mark.id,
      },
      key,
    );
  }

  private onMarkRightClick(ctx: PageContext, id: string): void {
    const page = ctx.view.pageNo;
    const mark = findEntity(this.store.doc, page, 'marks', id);
    if (!mark) return;
    if (mark.kind === 'check') {
      const key = `cross:${++this.seq}`;
      this.store.change('Mark wrong', [updateOp(this.store.doc, page, 'marks', id, { kind: 'cross' })], key);
      this.openCorrection(ctx, { ...mark, kind: 'cross' }, key);
    } else this.openCorrection(ctx, mark);
  }

  // ---- move / remove -----------------------------------------------------

  private correctionsOf(page: number, markId: string) {
    return (getPage(this.store.doc, page)?.texts ?? []).filter((t) => t.markId === markId);
  }

  /** Removes a mark together with its correction(s). */
  private removeMark(page: number, id: string): void {
    this.store.change('Remove mark', [
      deleteOp(this.store.doc, page, 'marks', id),
      ...this.correctionsOf(page, id).map((t) => deleteOp(this.store.doc, page, 'texts', t.id)),
    ]);
  }

  /** Drag moves the mark (and its correction); a click without moving removes it. */
  private startMarkDrag(e: PointerEvent, ctx: PageContext, id: string, node: HTMLElement): void {
    const page = ctx.view.pageNo;
    const start = findEntity(this.store.doc, page, 'marks', id);
    if (!start) return;
    const corrections = this.correctionsOf(page, id);
    const key = `move-mark:${id}:${++this.seq}`;
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
      const dx = x1 - x0;
      const dy = y1 - y0;
      const ops: (Mutation | null)[] = [
        updateOp(this.store.doc, page, 'marks', id, { x: roundPt(start.x + dx), y: roundPt(start.y + dy) }),
        ...corrections.map((t) => updateOp(this.store.doc, page, 'texts', t.id, { x: roundPt(t.x + dx), y: roundPt(t.y + dy) })),
      ];
      this.store.change('Move mark', ops, key);
    };
    const onUp = () => {
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', onUp);
      node.removeEventListener('pointercancel', onUp);
      this.store.history.seal();
      if (!moved) this.removeMark(page, id);
    };
    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerup', onUp);
    node.addEventListener('pointercancel', onUp);
  }
}

