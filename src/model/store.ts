// Single source of truth for the sidecar document. Views subscribe and
// re-render the parts that changed; both split panes read the same store.

import { applyTransaction, History, pagesOf, type Mutation, type Transaction } from './history';
import type { SidecarDoc } from './schema';

export type ChangeKind = 'content' | 'view' | 'reset';

export interface Change {
  kind: ChangeKind;
  /** Pages whose annotations changed (for 'content'); undefined = all. */
  pages?: number[];
  /** Set for undo/redo, so views can e.g. scroll to the affected page. */
  source?: 'undo' | 'redo';
}

export type Listener = (change: Change) => void;

export class Store {
  private listeners = new Set<Listener>();
  readonly history = new History();
  /** Bumped on every annotation/settings change (drives the "unsaved" state). */
  contentRev = 0;
  /** Bumped on view-state changes (page, zoom, split): saved lazily. */
  viewRev = 0;

  constructor(public doc: SidecarDoc) {}

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  protected emit(change: Change): void {
    for (const fn of this.listeners) fn(change);
  }

  /** Replace the whole document (load / reload from disk). Clears undo history. */
  replace(doc: SidecarDoc): void {
    this.doc = doc;
    this.history.clear();
    this.emit({ kind: 'reset' });
  }

  /** Applies an undoable change. Null mutations (missing entities) are ignored. */
  change(label: string, mutations: (Mutation | null)[], mergeKey?: string): void {
    const tx: Transaction = { label, mutations: mutations.filter((m): m is Mutation => !!m), mergeKey };
    if (!tx.mutations.length) return;
    applyTransaction(this.doc, tx);
    const pages = pagesOf(tx);
    this.history.push(tx);
    this.contentRev++;
    this.emit({ kind: 'content', pages });
  }

  undo(): Transaction | undefined {
    const tx = this.history.popUndo();
    if (!tx) return;
    applyTransaction(this.doc, tx, true);
    this.contentRev++;
    this.emit({ kind: 'content', pages: pagesOf(tx), source: 'undo' });
    return tx;
  }

  redo(): Transaction | undefined {
    const tx = this.history.popRedo();
    if (!tx) return;
    applyTransaction(this.doc, tx);
    this.contentRev++;
    this.emit({ kind: 'content', pages: pagesOf(tx), source: 'redo' });
    return tx;
  }

  setView(patch: Partial<SidecarDoc['view']>): void {
    let changed = false;
    for (const [k, v] of Object.entries(patch) as [keyof SidecarDoc['view'], unknown][]) {
      if (JSON.stringify(this.doc.view[k]) !== JSON.stringify(v)) changed = true;
    }
    if (!changed) return;
    this.doc.view = { ...this.doc.view, ...patch };
    this.viewRev++;
    this.emit({ kind: 'view' });
  }

  setAnswerKey(patch: Partial<SidecarDoc['answerKey']>): void {
    this.doc.answerKey = { ...this.doc.answerKey, ...patch };
    this.contentRev++;
    this.emit({ kind: 'content', pages: [] });
  }

  setSettings(patch: Partial<SidecarDoc['settings']>): void {
    this.doc.settings = { ...this.doc.settings, ...patch };
    this.contentRev++;
    this.emit({ kind: 'content', pages: [] });
  }
}
