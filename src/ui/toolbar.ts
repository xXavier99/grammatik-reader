// Top toolbar: file, save status, mode, text style, undo/redo, page navigation, zoom, help.

import type { SaveStatus } from '../storage/autosave';
import type { Mode } from '../tools/editor';
import { el } from './dom';
import type { SplitMode } from './split';

export interface ToolbarActions {
  toggleSidebar(): void;
  open(): void;
  showSaveDetail(): void;
  setMode(m: Mode): void;
  undo(): void;
  redo(): void;
  setFontSize(pt: number): void;
  setColor(hex: string): void;
  setLines(n: number): void;
  toggleSplit(): void;
  toggleOrientation(): void;
  toggleLink(): void;
  mapPages(): void;
  answerKey(anchor: HTMLElement): void;
  exportPdf(): void;
  goToPage(page: number): void;
  prevPage(): void;
  nextPage(): void;
  zoomIn(): void;
  zoomOut(): void;
  fitWidth(): void;
  help(): void;
}

const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: 'Saved',
  unsaved: 'Unsaved',
  saving: 'Saving…',
  error: 'Save failed',
  conflict: 'Changed elsewhere',
};

const MODES: { mode: Mode; label: string; title: string; enabled: boolean }[] = [
  { mode: 'select', label: 'Select', title: 'Select mode: click or drag a rectangle to select, drag to move, Delete to remove (V)', enabled: true },
  { mode: 'text', label: 'Text', title: 'Text mode: click to type (T)', enabled: true },
  { mode: 'area', label: 'Area', title: 'Answer areas: drag a rectangle over the rows to fill (A)', enabled: true },
  { mode: 'underline', label: 'Underline', title: 'Underline: drag over text; the line goes along the bottom of the drag (U)', enabled: true },
  { mode: 'blank', label: 'Blanks', title: 'Blanks: click where each answer starts, in order; Tab then walks them (B)', enabled: true },
  { mode: 'check', label: 'Check', title: 'Check mode: left click ✓, right click ✗ + correction (C)', enabled: true },
];

function button(label: string, title: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = el('button', { type: 'button', title, class: cls }, label);
  b.addEventListener('click', onClick);
  return b;
}

export class Toolbar {
  readonly el: HTMLElement;
  private fileName: HTMLSpanElement;
  private status: HTMLButtonElement;
  private pageInput: HTMLInputElement;
  private pageCount: HTMLSpanElement;
  private zoomLabel: HTMLSpanElement;
  private fitBtn: HTMLButtonElement;
  private modeBtns = new Map<Mode, HTMLButtonElement>();
  private undoBtn: HTMLButtonElement;
  private redoBtn: HTMLButtonElement;
  private sizeInput: HTMLInputElement;
  private colorInput: HTMLInputElement;
  private linesInput: HTMLInputElement;
  private splitBtn: HTMLButtonElement;
  private splitExtras: HTMLDivElement;
  private orientBtn: HTMLButtonElement;
  private linkBtn: HTMLButtonElement;

  constructor(a: ToolbarActions) {
    this.fileName = el('span', { class: 'file-name' });
    this.status = button('', 'Save status (click to save now)', () => a.showSaveDetail(), 'save-status');
    this.pageInput = el('input', { type: 'text', class: 'page-input', inputmode: 'numeric', 'aria-label': 'Page number' });
    this.pageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const n = parseInt(this.pageInput.value, 10);
        if (Number.isFinite(n)) a.goToPage(n);
        this.pageInput.blur();
      } else if (e.key === 'Escape') this.pageInput.blur();
    });
    this.pageInput.addEventListener('focus', () => this.pageInput.select());
    this.pageCount = el('span', { class: 'page-count' });
    this.zoomLabel = el('span', { class: 'zoom-label' });
    this.fitBtn = button('Fit', 'Fit page width (Ctrl+0)', () => a.fitWidth(), 'fit-btn');

    const modes = el('div', { class: 'segmented', role: 'group', 'aria-label': 'Mode' });
    for (const m of MODES) {
      const b = button(m.label, m.title, () => a.setMode(m.mode));
      b.dataset.mode = m.mode;
      b.disabled = !m.enabled;
      this.modeBtns.set(m.mode, b);
      modes.append(b);
    }

    this.undoBtn = button('↶', 'Undo (Ctrl+Z)', () => a.undo(), 'icon');
    this.redoBtn = button('↷', 'Redo (Ctrl+Y)', () => a.redo(), 'icon');

    this.sizeInput = el('input', {
      type: 'number', class: 'size-input', min: '4', max: '96', step: '1', 'aria-label': 'Font size (pt)', title: 'Font size (pt)',
    });
    this.sizeInput.addEventListener('change', () => {
      const v = parseFloat(this.sizeInput.value);
      if (Number.isFinite(v) && v >= 4 && v <= 96) a.setFontSize(v);
    });
    this.sizeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') this.sizeInput.blur();
    });
    this.colorInput = el('input', { type: 'color', class: 'color-input', 'aria-label': 'Text colour' });
    this.colorInput.addEventListener('input', () => a.setColor(this.colorInput.value));
    this.linesInput = el('input', {
      type: 'number', class: 'lines-input', min: '1', max: '100', step: '1', 'aria-label': 'Lines per answer area',
    });
    this.linesInput.addEventListener('change', () => {
      const v = parseInt(this.linesInput.value, 10);
      if (Number.isFinite(v) && v >= 1 && v <= 100) a.setLines(v);
    });
    this.linesInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') this.linesInput.blur();
    });

    this.splitBtn = button('Split', 'Show a second pane (e.g. the answer key) below', () => a.toggleSplit());
    this.orientBtn = button('⇅', 'Panes stacked / side by side', () => a.toggleOrientation(), 'icon');
    this.linkBtn = button('Link', 'Bottom pane follows the top pane using the answer-key table', () => a.toggleLink());
    const keyBtn = button('Key…', 'Answer key: answer section start and page mapping table', () => a.answerKey(keyBtn), 'answer-key-btn');
    this.splitExtras = el('div', { class: 'group split-extras' },
      this.orientBtn,
      this.linkBtn,
      button('Map', 'Map the top pane’s page to the bottom pane’s page (M)', () => a.mapPages()),
    );

    this.el = el(
      'header',
      { class: 'toolbar' },
      el('div', { class: 'group' },
        button('☰', 'Toggle thumbnails', () => a.toggleSidebar(), 'icon'),
        button('Open…', 'Open a PDF', () => a.open()),
        this.fileName,
      ),
      el('div', { class: 'group' }, modes),
      el('div', { class: 'group', title: 'Text style for new boxes (also applied to the selected box)' },
        this.sizeInput, this.colorInput),
      el('div', { class: 'group', title: 'Rows in a newly drawn answer area (also applied to the selected area)' },
        el('span', { class: 'unit' }, 'Lines'), this.linesInput),
      el('div', { class: 'group' }, this.undoBtn, this.redoBtn),
      el('div', { class: 'group' },
        button('‹', 'Previous page (PageUp)', () => a.prevPage(), 'icon'),
        this.pageInput,
        this.pageCount,
        button('›', 'Next page (PageDown)', () => a.nextPage(), 'icon'),
      ),
      el('div', { class: 'group' },
        button('−', 'Zoom out (Ctrl+−)', () => a.zoomOut(), 'icon'),
        this.zoomLabel,
        button('+', 'Zoom in (Ctrl++)', () => a.zoomIn(), 'icon'),
        this.fitBtn,
      ),
      el('div', { class: 'group' }, this.splitBtn, keyBtn),
      this.splitExtras,
      el('div', { class: 'spacer' }),
      el('div', { class: 'group' }, button('Export', 'Export a copy of the PDF with your answers', () => a.exportPdf()), this.status, button('?', 'Keyboard shortcuts (?)', () => a.help(), 'icon')),
    );
  }

  setFileName(name: string): void {
    this.fileName.textContent = name;
    this.fileName.title = name;
  }

  setSaveStatus(s: SaveStatus, detail?: string): void {
    this.status.textContent = STATUS_TEXT[s];
    this.status.dataset.status = s;
    this.status.title = detail ?? (s === 'saved' ? 'All changes saved' : 'Click to save now (Ctrl+S)');
  }

  setMode(m: Mode): void {
    for (const [mode, b] of this.modeBtns) b.classList.toggle('active', mode === m);
  }

  setUndoState(canUndo: boolean, canRedo: boolean): void {
    this.undoBtn.disabled = !canUndo;
    this.redoBtn.disabled = !canRedo;
  }

  /** Shows the style of the selected box, or the defaults when nothing is selected. */
  setTextStyle(fontSize: number, color: string): void {
    if (document.activeElement !== this.sizeInput) this.sizeInput.value = String(fontSize);
    if (document.activeElement !== this.colorInput) this.colorInput.value = color;
  }

  setSplit(mode: SplitMode, linked: boolean): void {
    const on = mode !== 'none';
    this.splitBtn.classList.toggle('active', on);
    this.splitExtras.hidden = !on;
    this.orientBtn.textContent = mode === 'vertical' ? '⇆' : '⇅';
    this.orientBtn.title = mode === 'vertical' ? 'Side by side (click: stack top/bottom)' : 'Stacked top/bottom (click: side by side)';
    this.linkBtn.classList.toggle('active', linked);
  }

  setLines(n: number): void {
    if (document.activeElement !== this.linesInput) this.linesInput.value = String(n);
  }

  setPage(page: number, count: number): void {
    if (document.activeElement !== this.pageInput) this.pageInput.value = String(page);
    this.pageCount.textContent = `/ ${count}`;
  }

  setZoom(zoom: number, fit: boolean): void {
    this.zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    this.fitBtn.classList.toggle('active', fit);
  }
}
