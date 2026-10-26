// UI state shared by all panes: the active mode and the current selection.

import type { Collection } from '../model/history';

export type Mode = 'text' | 'area' | 'check';

export interface Selection {
  page: number;
  coll: Collection;
  id: string;
}

type Listener = () => void;

export class EditorState {
  private _mode: Mode = 'text';
  private _selection: Selection | null = null;
  private listeners = new Set<Listener>();

  get mode(): Mode {
    return this._mode;
  }
  get selection(): Selection | null {
    return this._selection;
  }

  setMode(m: Mode): void {
    if (m === this._mode) return;
    this._mode = m;
    this._selection = null;
    this.emit();
  }

  select(sel: Selection | null): void {
    const same = sel?.id === this._selection?.id && sel?.page === this._selection?.page;
    if (same) return;
    this._selection = sel;
    this.emit();
  }

  isSelected(id: string): boolean {
    return this._selection?.id === id;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
