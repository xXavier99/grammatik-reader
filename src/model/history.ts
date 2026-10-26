// Invertible document mutations, grouped into undoable transactions.
//
// Entities are treated as immutable values: a mutation stores full before /
// after snapshots, so undo is just applying the mutation backwards.

import { emptyPage, isPageEmpty, type AnswerArea, type Blank, type Mark, type PageAnnotations, type SidecarDoc, type TextBox } from './schema';

export interface CollectionTypes {
  texts: TextBox;
  areas: AnswerArea;
  marks: Mark;
  blanks: Blank;
}
export type Collection = keyof CollectionTypes;
export type Entity = CollectionTypes[Collection];

export interface Mutation {
  page: number;
  coll: Collection;
  id: string;
  /** null = entity did not exist (creation). */
  before: Entity | null;
  /** null = entity removed (deletion). */
  after: Entity | null;
  /** Position in the collection, so undoing a delete restores the order. */
  index?: number;
}

export interface Transaction {
  label: string;
  mutations: Mutation[];
  /** Consecutive transactions with the same key collapse into one undo step. */
  mergeKey?: string;
}

export function getPage(doc: SidecarDoc, page: number, create = false): PageAnnotations | undefined {
  const key = String(page);
  let pa = doc.pages[key];
  if (!pa && create) {
    pa = emptyPage();
    doc.pages[key] = pa;
  }
  return pa;
}

export function findEntity<C extends Collection>(doc: SidecarDoc, page: number, coll: C, id: string): CollectionTypes[C] | undefined {
  const list = getPage(doc, page)?.[coll] as CollectionTypes[C][] | undefined;
  return list?.find((e) => e.id === id);
}

/** Applies one mutation in the given direction. */
export function applyMutation(doc: SidecarDoc, m: Mutation, backward = false): void {
  const target = backward ? m.before : m.after;
  const pa = getPage(doc, m.page, true)!;
  const list = pa[m.coll] as Entity[];
  const i = list.findIndex((e) => e.id === m.id);
  if (target) {
    const value = clone(target);
    if (i >= 0) list[i] = value;
    else if (m.index !== undefined && m.index <= list.length) list.splice(m.index, 0, value);
    else list.push(value);
  } else if (i >= 0) {
    if (!backward) m.index = i;
    list.splice(i, 1);
  }
  if (isPageEmpty(pa)) delete doc.pages[String(m.page)];
}

export function applyTransaction(doc: SidecarDoc, tx: Transaction, backward = false): void {
  const ms = backward ? [...tx.mutations].reverse() : tx.mutations;
  for (const m of ms) applyMutation(doc, m, backward);
}

/** Folds `next` into `prev` (same merge key): keeps the earliest "before". */
export function mergeInto(prev: Transaction, next: Transaction): void {
  for (const m of next.mutations) {
    const existing = prev.mutations.find((p) => p.page === m.page && p.coll === m.coll && p.id === m.id);
    if (existing) {
      existing.after = m.after;
      if (m.index !== undefined) existing.index = m.index;
    } else prev.mutations.push(m);
  }
  prev.mutations = prev.mutations.filter((m) => !isNoop(m));
}

export function isNoop(m: Mutation): boolean {
  if (!m.before && !m.after) return true;
  return !!m.before && !!m.after && JSON.stringify(m.before) === JSON.stringify(m.after);
}

export function pagesOf(tx: Transaction): number[] {
  return [...new Set(tx.mutations.map((m) => m.page))];
}

export class History {
  private undoStack: Transaction[] = [];
  private redoStack: Transaction[] = [];

  constructor(private limit = 500) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  peekUndo(): Transaction | undefined {
    return this.undoStack[this.undoStack.length - 1];
  }
  peekRedo(): Transaction | undefined {
    return this.redoStack[this.redoStack.length - 1];
  }

  /** Records an already-applied transaction. */
  push(tx: Transaction): void {
    this.redoStack = [];
    const top = this.undoStack[this.undoStack.length - 1];
    if (top && tx.mergeKey && top.mergeKey === tx.mergeKey) {
      mergeInto(top, tx);
      if (!top.mutations.length) this.undoStack.pop();
      return;
    }
    tx.mutations = tx.mutations.filter((m) => !isNoop(m));
    if (!tx.mutations.length) return;
    this.undoStack.push(tx);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
  }

  /** Pops the transaction to undo (caller applies it backwards). */
  popUndo(): Transaction | undefined {
    const tx = this.undoStack.pop();
    if (tx) this.redoStack.push(tx);
    return tx;
  }

  popRedo(): Transaction | undefined {
    const tx = this.redoStack.pop();
    if (tx) this.undoStack.push(tx);
    return tx;
  }

  /** Stops the current top entry from absorbing further merges. */
  seal(): void {
    const top = this.undoStack[this.undoStack.length - 1];
    if (top) top.mergeKey = undefined;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}

export function clone<T>(v: T): T {
  return structuredClone(v);
}

// ---- mutation builders (read "before" from the current document) -----------

export function createOp<C extends Collection>(page: number, coll: C, entity: CollectionTypes[C]): Mutation {
  return { page, coll, id: entity.id, before: null, after: clone(entity) };
}

export function updateOp<C extends Collection>(
  doc: SidecarDoc, page: number, coll: C, id: string, patch: Partial<CollectionTypes[C]>,
): Mutation | null {
  const before = findEntity(doc, page, coll, id);
  if (!before) return null;
  return { page, coll, id, before: clone(before), after: { ...clone(before), ...patch } as Entity };
}

export function deleteOp(doc: SidecarDoc, page: number, coll: Collection, id: string): Mutation | null {
  const before = findEntity(doc, page, coll, id);
  if (!before) return null;
  return { page, coll, id, before: clone(before), after: null };
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}
