// Text mode: click to type, edit, drag (grip or Alt+drag), resize width, delete.

import { adjacentRowTop, areaAt, boxTopForRow, readingOrder, rowIndexAt, rowSpacing } from '../model/areas';
import { pdfToScreen, screenToPdf } from '../model/coords';
import { createOp, deleteOp, findEntity, getPage, newId, updateOp } from '../model/history';
import type { AnswerArea, TextBox } from '../model/schema';
import type { Store } from '../model/store';
import { boxTopForClick, LINE_HEIGHT, roundPt } from '../model/text';
import { applyTextStyle, displayText, type AnnotationLayer, type PageContext, type Tool } from '../ui/annotations';
import { el } from '../ui/dom';
import type { PdfPane } from '../ui/pane';
import type { EditorState } from './editor';

interface Editing {
  pane: PdfPane;
  ctx: PageContext;
  page: number;
  id: string;
  ta: HTMLTextAreaElement;
  mirror: HTMLElement;
  /** Merge key: the whole editing session (incl. creation) is one undo step. */
  key: string;
}

const DRAG_THRESHOLD = 3;
/** Boxes within this horizontal distance (PDF units) count as "in the same column". */
const ROW_X_TOLERANCE = 30;
/** Gap between an area's left edge and text jumped to with Tab. */
const AREA_TEXT_INSET = 2;

function findLastIndex<T>(arr: T[], pred: (v: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return i;
  return -1;
}

export class TextTool implements Tool {
  private editing: Editing | null = null;
  private seq = 0;

  constructor(
    private store: Store,
    private editor: EditorState,
    private layer: AnnotationLayer,
  ) {}

  // ---- Tool --------------------------------------------------------------

  isEditing(pane: PdfPane, id: string): boolean {
    return this.editing?.pane === pane && this.editing.id === id;
  }

  afterRender(ctx: PageContext): void {
    const ed = this.editing;
    if (!ed || ed.pane !== ctx.pane || ed.page !== ctx.view.pageNo) return;
    const tb = this.box(ed.page, ed.id);
    if (!tb) {
      // Removed underneath us (e.g. reload from disk).
      this.teardown();
      return;
    }
    ed.ctx = ctx;
    applyTextStyle(ed.ta, tb, ctx.vp);
    applyTextStyle(ed.mirror, tb, ctx.vp);
    this.autosize();
  }

  onUnmount(ctx: PageContext): void {
    if (this.editing?.pane === ctx.pane && this.editing.page === ctx.view.pageNo) this.finishEditing();
  }

  onPointerDown(e: PointerEvent, ctx: PageContext): void {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target === this.editing?.ta) return; // Native caret placement.

    const node = target.closest<HTMLElement>('.ann-text');
    if (node) {
      const id = node.dataset.id!;
      e.preventDefault();
      if (target.classList.contains('ann-resize')) {
        this.finishEditing();
        this.editor.select({ page: ctx.view.pageNo, coll: 'texts', id });
        this.startDrag(e, ctx, id, 'resize', node);
      } else if (target.classList.contains('ann-grip') || e.altKey) {
        this.finishEditing();
        this.editor.select({ page: ctx.view.pageNo, coll: 'texts', id });
        this.startDrag(e, ctx, id, 'move', node);
      } else {
        const caret = caretOffsetAt(e.clientX, e.clientY, node);
        this.finishEditing();
        this.startEditing(ctx, id, caret);
      }
      return;
    }

    // Empty space on the page.
    e.preventDefault();
    if (this.editing) {
      const wasEmpty = this.editing.ta.value.trim() === '';
      this.finishEditing();
      // Clicking away from an empty box just discards it.
      if (wasEmpty) return;
    }
    this.createAt(e, ctx);
  }

  // ---- create / edit -----------------------------------------------------

  private box(page: number, id: string): TextBox | undefined {
    return findEntity(this.store.doc, page, 'texts', id);
  }

  private createAt(e: PointerEvent, ctx: PageContext): void {
    const rect = ctx.view.overlay.getBoundingClientRect();
    const [px, py] = screenToPdf(ctx.vp, e.clientX - rect.left, e.clientY - rect.top);
    const { defaultFontSize: fontSize, defaultColor: color } = this.store.doc.settings;
    const area = areaAt(getPage(this.store.doc, ctx.view.pageNo)?.areas ?? [], px, py);
    if (area) {
      // Snap into the row under the click; this area's spacing becomes the remembered one.
      const row = rowIndexAt(area, py);
      this.rememberAreaSpacing(area);
      this.createBox(ctx, { x: px, y: boxTopForRow(area, row, fontSize), fontSize, color, areaId: area.id, lineIndex: row });
    } else {
      this.createBox(ctx, { x: px, y: boxTopForClick(py, fontSize), fontSize, color });
    }
  }

  /**
   * Creates an empty box and starts editing it. `key` lets callers merge the
   * creation with their own change (e.g. a ✗ mark and its correction).
   */
  createBox(
    ctx: PageContext,
    p: {
      x: number; y: number; fontSize: number; color: string;
      areaId?: string; lineIndex?: number; kind?: TextBox['kind']; markId?: string;
    },
    key?: string,
  ): void {
    const tb: TextBox = {
      id: newId('t'),
      kind: p.kind ?? 'text',
      x: roundPt(p.x),
      y: roundPt(p.y),
      width: null,
      fontSize: p.fontSize,
      color: p.color,
      text: '',
    };
    if (p.areaId) {
      tb.areaId = p.areaId;
      tb.lineIndex = p.lineIndex;
    }
    if (p.markId) tb.markId = p.markId;
    const k = key ?? `text:${tb.id}:${++this.seq}`;
    this.store.change(tb.kind === 'correction' ? 'Add correction' : 'Add text', [createOp(ctx.view.pageNo, 'texts', tb)], k);
    this.startEditing(ctx, tb.id, 0, k);
  }

  private rememberAreaSpacing(area: AnswerArea): void {
    if (area.lines <= 1) return;
    const s = roundPt(rowSpacing(area));
    if (this.store.doc.settings.lineSpacing !== s) this.store.setSettings({ lineSpacing: s });
  }

  startEditing(ctx: PageContext, id: string, caret: number | null, key?: string): void {
    const page = ctx.view.pageNo;
    const tb = this.box(page, id);
    if (!tb) return;
    const ta = el('textarea', { class: 'ann-editor', spellcheck: 'false', wrap: 'soft', 'aria-label': 'Answer text' });
    const mirror = el('div', { class: 'ann-text ann-mirror', 'aria-hidden': 'true' });
    ta.value = tb.text;
    applyTextStyle(ta, tb, ctx.vp);
    applyTextStyle(mirror, tb, ctx.vp);
    ctx.view.overlay.append(mirror, ta);

    this.editing = { pane: ctx.pane, ctx, page, id, ta, mirror, key: key ?? `text:${id}:${++this.seq}` };
    this.editor.select({ page, coll: 'texts', id });
    this.layer.renderPage(ctx.pane, ctx.view); // hides the static node for this box
    this.autosize();

    ta.addEventListener('input', () => this.onInput());
    ta.addEventListener('keydown', (e) => this.onKeyDown(e));
    ta.addEventListener('blur', () => {
      // Switching windows blurs too; keep editing so typing resumes on return.
      if (!document.hasFocus()) return;
      if (this.editing?.ta === ta) this.finishEditing();
    });
    ta.focus({ preventScroll: true });
    const pos = Math.min(caret ?? ta.value.length, ta.value.length);
    ta.setSelectionRange(pos, pos);
  }

  private onInput(): void {
    const ed = this.editing;
    if (!ed) return;
    this.store.change('Edit text', [updateOp(this.store.doc, ed.page, 'texts', ed.id, { text: ed.ta.value })], ed.key);
    this.autosize();
  }

  private onKeyDown(e: KeyboardEvent): void {
    const ed = this.editing;
    if (!ed || e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
    const ta = ed.ta;
    const noSel = ta.selectionStart === ta.selectionEnd;
    if (this.box(ed.page, ed.id)?.kind === 'correction') {
      // Corrections are single notes: Enter (or Esc) finishes; Shift+Enter is a newline.
      if (e.key === 'Tab') e.preventDefault();
      if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        const pane = ed.pane;
        this.finishEditing();
        pane.focus();
      }
      return;
    }
    switch (e.key) {
      case 'Escape': {
        e.preventDefault();
        const pane = ed.pane;
        this.finishEditing();
        pane.focus();
        return;
      }
      case 'Enter':
        // Shift+Enter: a real newline inside the box (native).
        if (e.shiftKey) return;
        e.preventDefault();
        this.moveRow(1);
        return;
      case 'ArrowUp':
        if (e.shiftKey || !noSel || ta.value.lastIndexOf('\n', ta.selectionStart - 1) !== -1) return;
        e.preventDefault();
        this.moveRow(-1);
        return;
      case 'ArrowDown':
        if (e.shiftKey || !noSel || ta.value.indexOf('\n', ta.selectionEnd) !== -1) return;
        e.preventDefault();
        this.moveRow(1);
        return;
      case 'Tab':
        e.preventDefault();
        this.jumpToArea(e.shiftKey ? -1 : 1);
        return;
    }
  }

  /** Row spacing for a box: its area's rows, else the remembered spacing, else one text line. */
  private spacingFor(page: number, tb: TextBox): { spacing: number; area?: AnswerArea } {
    const area = tb.areaId ? findEntity(this.store.doc, page, 'areas', tb.areaId) : undefined;
    if (area && area.lines > 1) return { spacing: rowSpacing(area), area };
    return { spacing: this.store.doc.settings.lineSpacing ?? tb.fontSize * LINE_HEIGHT };
  }

  /**
   * Enter / ↓ (dir 1) and ↑ (dir -1): continue on the next/previous row at the
   * same x, editing the box already there or creating a new one.
   */
  private moveRow(dir: 1 | -1): void {
    const ed = this.editing;
    if (!ed) return;
    const tb = this.box(ed.page, ed.id);
    if (!tb) return;
    const { spacing, area } = this.spacingFor(ed.page, tb);
    const top = adjacentRowTop(tb.y, spacing, dir);
    const ctx = ed.ctx;
    // Stay put if the next row would leave the page.
    const [, syTop] = pdfToScreen(ctx.vp, tb.x, top);
    const [, syBottom] = pdfToScreen(ctx.vp, tb.x, top - tb.fontSize * LINE_HEIGHT);
    if (Math.min(syTop, syBottom) < 0 || Math.max(syTop, syBottom) > ctx.vp.height) return;

    const next = tb.lineIndex !== undefined ? tb.lineIndex + dir : -1;
    const inArea = !!area && next >= 0 && next < area.lines;

    this.finishEditing();
    // Inside an area the row identifies the answer; elsewhere look near the same x.
    const sameAreaRow = inArea
      ? (getPage(this.store.doc, ed.page)?.texts ?? []).find((t) => t.areaId === area.id && t.lineIndex === next)
      : undefined;
    const existing = sameAreaRow ?? this.boxInRow(ed.page, tb.x, top, spacing, tb.id);
    if (existing) {
      this.startEditing(ctx, existing.id, null);
      return;
    }
    this.createBox(ctx, {
      x: tb.x,
      y: top,
      fontSize: tb.fontSize,
      color: tb.color,
      ...(inArea ? { areaId: area.id, lineIndex: next } : {}),
    });
  }

  /** A box (other than `exceptId`) whose top lies in the row starting near `top`, near `x`. */
  private boxInRow(page: number, x: number, top: number, spacing: number, exceptId?: string): TextBox | undefined {
    const texts = getPage(this.store.doc, page)?.texts ?? [];
    return texts.find((t) => t.id !== exceptId && Math.abs(t.y - top) < spacing / 2 && Math.abs(t.x - x) < ROW_X_TOLERANCE);
  }

  /** Tab / Shift+Tab: first row of the next / previous answer area on the page. */
  private jumpToArea(dir: 1 | -1): void {
    const ed = this.editing;
    if (!ed) return;
    const tb = this.box(ed.page, ed.id);
    if (!tb) return;
    const areas = readingOrder(getPage(this.store.doc, ed.page)?.areas ?? []);
    if (!areas.length) return;
    let i = areas.findIndex((a) => a.id === tb.areaId);
    if (i >= 0) i += dir;
    else {
      // Not in an area: the first area below (or, backwards, above) the box.
      i = dir > 0 ? areas.findIndex((a) => a.y < tb.y) : findLastIndex(areas, (a) => a.y - a.height > tb.y);
    }
    const target = areas[i];
    if (!target) return;
    const ctx = ed.ctx;
    this.finishEditing();
    this.enterArea(ctx, target);
  }

  /** Starts typing in the first row of `area` (existing box there, or a new one at its left edge). */
  enterArea(ctx: PageContext, area: AnswerArea): void {
    const target = area;
    const page = ctx.view.pageNo;
    const fontSize = this.store.doc.settings.defaultFontSize;
    const existing = (getPage(this.store.doc, page)?.texts ?? []).find((t) => t.areaId === target.id && t.lineIndex === 0);
    this.rememberAreaSpacing(target);
    if (existing) this.startEditing(ctx, existing.id, null);
    else {
      this.createBox(ctx, {
        x: target.x + AREA_TEXT_INSET,
        y: boxTopForRow(target, 0, fontSize),
        fontSize,
        color: this.store.doc.settings.defaultColor,
        areaId: target.id,
        lineIndex: 0,
      });
    }
  }

  /** Ends editing; an empty box is removed (merged into the same undo step). */
  finishEditing(): void {
    const ed = this.editing;
    if (!ed) return;
    const tb = this.box(ed.page, ed.id);
    this.teardown();
    if (tb && tb.text.trim() === '') {
      this.store.change('Delete text', [deleteOp(this.store.doc, ed.page, 'texts', ed.id)], ed.key);
      if (this.editor.isSelected(ed.id)) this.editor.select(null);
    }
    this.store.history.seal();
    this.layer.renderPage(ed.pane, ed.ctx.view);
  }

  private teardown(): void {
    const ed = this.editing;
    if (!ed) return;
    this.editing = null;
    ed.ta.remove();
    ed.mirror.remove();
  }

  get isEditingAny(): boolean {
    return !!this.editing;
  }

  /** Sizes the textarea to its content using a hidden mirror with identical styling. */
  private autosize(): void {
    const ed = this.editing;
    if (!ed) return;
    ed.mirror.textContent = displayText(ed.ta.value) || '​';
    const w = ed.mirror.offsetWidth;
    const h = ed.mirror.offsetHeight;
    // Room for the caret after the last character.
    if (!ed.ta.classList.contains('fixed-width')) ed.ta.style.width = `${Math.max(w, 2) + 2}px`;
    ed.ta.style.height = `${h}px`;
  }

  // ---- drag / resize -----------------------------------------------------

  private startDrag(e: PointerEvent, ctx: PageContext, id: string, kind: 'move' | 'resize', node: HTMLElement): void {
    const tb = this.box(ctx.view.pageNo, id);
    if (!tb) return;
    const page = ctx.view.pageNo;
    const key = `${kind}:${id}:${++this.seq}`;
    const scale = ctx.vp.scale;
    const startW = tb.width ?? node.querySelector<HTMLElement>('.ann-body')!.offsetWidth / scale;
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    const target = e.target as HTMLElement;
    target.setPointerCapture(e.pointerId);
    document.body.classList.add(kind === 'move' ? 'dragging-move' : 'dragging-resize');

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      moved = true;
      if (kind === 'move') {
        // Move the anchor by the screen delta, converted through the viewport.
        const [ax, ay] = this.anchorScreen(ctx, tb);
        const [x, y] = screenToPdf(ctx.vp, ax + dx, ay + dy);
        this.store.change('Move text', [updateOp(this.store.doc, page, 'texts', id, { x: roundPt(x), y: roundPt(y) })], key);
      } else {
        const width = roundPt(Math.max(tb.fontSize, startW + dx / scale));
        this.store.change('Resize text', [updateOp(this.store.doc, page, 'texts', id, { width })], key);
      }
    };
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      document.body.classList.remove('dragging-move', 'dragging-resize');
      this.store.history.seal();
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);

    if (kind === 'resize') {
      target.addEventListener(
        'dblclick',
        () => this.store.change('Automatic width', [updateOp(this.store.doc, page, 'texts', id, { width: null })]),
        { once: true },
      );
    }
  }

  /** Screen position (page-local CSS px) of a box's original anchor. */
  private anchorScreen(ctx: PageContext, tb: TextBox): [number, number] {
    const m = ctx.vp.transform;
    return [m[0] * tb.x + m[2] * tb.y + m[4], m[1] * tb.x + m[3] * tb.y + m[5]];
  }

  // ---- keyboard on a selected (not edited) box ---------------------------

  deleteSelection(): boolean {
    const sel = this.editor.selection;
    if (!sel || sel.coll !== 'texts' || this.editing) return false;
    this.store.change('Delete text', [deleteOp(this.store.doc, sel.page, 'texts', sel.id)]);
    this.editor.select(null);
    return true;
  }

  /** Enter on a selected box starts editing it (caret at the end). */
  editSelection(pane: PdfPane): boolean {
    const sel = this.editor.selection;
    if (!sel || sel.coll !== 'texts' || this.editing) return false;
    const view = [...pane.pageViews].find((v) => v.pageNo === sel.page);
    if (!view) return false;
    this.startEditing(this.layer.ctx(pane, view), sel.id, null);
    return true;
  }
}

/** Character offset in a text node's body under the pointer, if any. */
function caretOffsetAt(x: number, y: number, node: HTMLElement): number | null {
  const range = document.caretRangeFromPoint?.(x, y);
  const body = node.querySelector('.ann-body');
  if (!range || !body || !body.contains(range.startContainer)) return null;
  return range.startOffset;
}
