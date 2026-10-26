import { describe, expect, it } from 'vitest';
import { createOp, deleteOp, findEntity, updateOp } from '../../src/model/history';
import { createEmptyDoc, type TextBox } from '../../src/model/schema';
import { Store } from '../../src/model/store';

const box = (id: string, text = ''): TextBox => ({
  id, kind: 'text', x: 10, y: 700, width: null, fontSize: 11, color: '#1a4fd6', text,
});

function setup() {
  const store = new Store(createEmptyDoc('Book.pdf', 10, null));
  const texts = (page = 1) => store.doc.pages[String(page)]?.texts.map((t) => `${t.id}:${t.text}`) ?? [];
  return { store, texts };
}

describe('Store undo/redo', () => {
  it('undoes and redoes create, edit and delete', () => {
    const { store, texts } = setup();
    store.change('Add', [createOp(1, 'texts', box('a', 'x'))]);
    store.change('Edit', [updateOp(store.doc, 1, 'texts', 'a', { text: 'gehe' })]);
    store.change('Delete', [deleteOp(store.doc, 1, 'texts', 'a')]);
    expect(texts()).toEqual([]);
    expect(store.doc.pages['1']).toBeUndefined(); // empty pages are pruned

    store.undo();
    expect(texts()).toEqual(['a:gehe']);
    store.undo();
    expect(texts()).toEqual(['a:x']);
    store.undo();
    expect(texts()).toEqual([]);
    expect(store.history.canUndo).toBe(false);

    store.redo();
    store.redo();
    expect(texts()).toEqual(['a:gehe']);
    store.redo();
    expect(texts()).toEqual([]);
  });

  it('restores a deleted entity at its original position', () => {
    const { store, texts } = setup();
    store.change('Add', [createOp(1, 'texts', box('a')), createOp(1, 'texts', box('b')), createOp(1, 'texts', box('c'))]);
    store.change('Delete', [deleteOp(store.doc, 1, 'texts', 'b')]);
    store.undo();
    expect(texts()).toEqual(['a:', 'b:', 'c:']);
  });

  it('merges a typing session (with its creation) into one undo step', () => {
    const { store, texts } = setup();
    store.change('Add', [createOp(1, 'texts', box('a'))], 'k1');
    for (const t of ['g', 'ge', 'geh', 'gehe']) store.change('Edit', [updateOp(store.doc, 1, 'texts', 'a', { text: t })], 'k1');
    expect(texts()).toEqual(['a:gehe']);
    store.undo();
    expect(texts()).toEqual([]);
    expect(store.history.canUndo).toBe(false);
    store.redo();
    expect(texts()).toEqual(['a:gehe']);
  });

  it('drops a create+delete session entirely (empty box discarded)', () => {
    const { store } = setup();
    store.change('Keep', [createOp(1, 'texts', box('keep', 'x'))]);
    store.change('Add', [createOp(1, 'texts', box('a'))], 'k2');
    store.change('Delete', [deleteOp(store.doc, 1, 'texts', 'a')], 'k2');
    store.undo();
    expect(findEntity(store.doc, 1, 'texts', 'keep')).toBeUndefined();
  });

  it('keeps separate steps for different merge keys and after sealing', () => {
    const { store, texts } = setup();
    store.change('Add', [createOp(1, 'texts', box('a', 'x'))]);
    store.change('Move', [updateOp(store.doc, 1, 'texts', 'a', { x: 20 })], 'move1');
    store.change('Move', [updateOp(store.doc, 1, 'texts', 'a', { x: 30 })], 'move1');
    store.history.seal();
    store.change('Move', [updateOp(store.doc, 1, 'texts', 'a', { x: 40 })], 'move1');
    store.undo();
    expect(findEntity(store.doc, 1, 'texts', 'a')!.x).toBe(30);
    store.undo();
    expect(findEntity(store.doc, 1, 'texts', 'a')!.x).toBe(10);
    expect(texts()).toEqual(['a:x']);
  });

  it('clears redo on a new change and ignores no-op changes', () => {
    const { store } = setup();
    store.change('Add', [createOp(1, 'texts', box('a', 'x'))]);
    store.undo();
    expect(store.history.canRedo).toBe(true);
    store.change('Add', [createOp(2, 'texts', box('b', 'y'))]);
    expect(store.history.canRedo).toBe(false);
    const rev = store.contentRev;
    store.change('Nothing', [updateOp(store.doc, 2, 'texts', 'missing', { text: 'z' })]);
    expect(store.contentRev).toBe(rev);
  });

  it('stored entities are independent of the history snapshots', () => {
    const { store } = setup();
    const b = box('a', 'x');
    store.change('Add', [createOp(1, 'texts', b)]);
    b.text = 'mutated outside';
    expect(findEntity(store.doc, 1, 'texts', 'a')!.text).toBe('x');
  });

  it('reports the affected pages and bumps the content revision', () => {
    const { store } = setup();
    const seen: (number[] | undefined)[] = [];
    store.subscribe((c) => seen.push(c.pages));
    store.change('Add', [createOp(3, 'texts', box('a', 'x'))]);
    store.undo();
    expect(seen).toEqual([[3], [3]]);
    expect(store.contentRev).toBe(2);
  });
});
