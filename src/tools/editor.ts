// UI state shared by all panes: the active mode and the current selection.

import type { Collection } from '../model/history';

export type Mode = 'select' | 'text' | 'area' | 'cover' | 'blank' | 'underline' | 'line' | 'check';

export interface Selection {
  page: number;
  coll: Collection;
  id: string;
}

type Listener = () => void;

export class EditorState {
  private _mode: Mode = 'text';
  /** Usually zero or one entry; Select mode can hold several. */
  private _selected: Selection[] = [];
  private listeners = new Set<Listener>();

  get mode(): Mode {
    return this._mode;
  }

  /** The selected item when exactly one is selected. */
  get selection(): Selection | null {
    return this._selected.length === 1 ? this._selected[0] : null;
  }

  get selected(): readonly Selection[] {
    return this._selected;
  }

  setMode(m: Mode): void {
    if (m === this._mode) return;
    this._mode = m;
    this._selected = [];
    this.emit();
  }

  select(sel: Selection | null): void {
    const cur = this.selection;
    const same = this._selected.length === (sel ? 1 : 0) && sel?.id === cur?.id && sel?.page === cur?.page;
    if (same) return;
    this._selected = sel ? [sel] : [];
    this.emit();
  }

  selectMany(sels: Selection[]): void {
    const same = sels.length === this._selected.length && sels.every((s, i) => s.id === this._selected[i].id);
    if (same) return;
    this._selected = [...sels];
    this.emit();
  }

  isSelected(id: string): boolean {
    return this._selected.some((s) => s.id === id);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
