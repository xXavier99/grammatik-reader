import { describe, expect, it } from 'vitest';
import { adjacentBlank, blankRect, firstEmptyBlank, nearestBlank } from '../../src/model/blanks';
import { makeViewport } from '../../src/model/coords';
import { createOp, findEntity } from '../../src/model/history';
import { createEmptyDoc, migrate, type Blank, type Mark, type TextBox } from '../../src/model/schema';
import { Store } from '../../src/model/store';
import { deletionOps } from '../../src/tools/select';

const A4 = { view: [0, 0, 595.28, 841.89] as [number, number, number, number], rotation: 0 as const };
const vp = makeViewport(A4, 2);
const blanks: Blank[] = [
  { id: 'b1', x: 100, y: 700 },
  { id: 'b2', x: 300, y: 700 },
  { id: 'b3', x: 100, y: 650 },
];
const box = (id: string, extra: Partial<TextBox> = {}): TextBox => ({
  id, kind: 'text', x: 100, y: 707, width: null, fontSize: 11, color: '#1a4fd6', text: 'x', ...extra,
});

describe('blank geometry', () => {
  it('draws the marker one text line high, starting at the blank', () => {
    const r = blankRect(vp, blanks[0], 11);
    expect(r.left).toBeCloseTo(200);
    expect(r.height).toBeCloseTo(11 * 1.25 * 2);
    expect(r.top + r.height / 2).toBeCloseTo((841.89 - 700) * 2);
    expect(r.width).toBeCloseTo(11 * 2.5 * 2);
  });

  it('snaps clicks on or near a marker, and picks the closest one', () => {
    const r = blankRect(vp, blanks[1], 11);
    expect(nearestBlank(blanks, vp, 11, r.left + 5, r.top + 5)?.id).toBe('b2');
    expect(nearestBlank(blanks, vp, 11, r.left - 10, r.top + 5)?.id).toBe('b2');
    expect(nearestBlank(blanks, vp, 11, r.left - 40, r.top + 5)).toBeUndefined();
    // Between two blanks on top of each other, the closer one wins.
    const top = blankRect(vp, blanks[0], 11);
    const below = blankRect(vp, blanks[2], 11);
    expect(nearestBlank(blanks, vp, 11, top.left + 5, top.top + top.height + 5)?.id).toBe('b1');
    expect(nearestBlank(blanks, vp, 11, below.left + 5, below.top - 5)?.id).toBe('b3');
  });
});

describe('blank order', () => {
  it('walks blanks in the order they were placed', () => {
    expect(adjacentBlank(blanks, 'b1', 1)?.id).toBe('b2');
    expect(adjacentBlank(blanks, 'b2', 1)?.id).toBe('b3');
    expect(adjacentBlank(blanks, 'b3', 1)).toBeUndefined();
    expect(adjacentBlank(blanks, 'b2', -1)?.id).toBe('b1');
    expect(adjacentBlank(blanks, 'nope', 1)).toBeUndefined();
  });

  it('finds the first blank without text', () => {
    expect(firstEmptyBlank(blanks, [box('t', { blankId: 'b1' })])?.id).toBe('b2');
    expect(firstEmptyBlank(blanks, [])?.id).toBe('b1');
  });
});

describe('deletionOps', () => {
  function setup() {
    const store = new Store(createEmptyDoc('Book.pdf', 3, null));
    const mark: Mark = { id: 'm', kind: 'cross', x: 300, y: 500, size: 14 };
    store.change('setup', [
      createOp(1, 'blanks', blanks[0]),
      createOp(1, 'texts', box('filled', { blankId: 'b1' })),
      createOp(1, 'marks', mark),
      createOp(1, 'texts', box('corr', { kind: 'correction', markId: 'm' })),
      createOp(1, 'texts', box('other')),
    ]);
    return store;
  }

  it('removes a mark with its correction, in one undo step', () => {
    const store = setup();
    store.change('Delete', deletionOps(store.doc, [{ page: 1, coll: 'marks', id: 'm' }]));
    expect(store.doc.pages['1'].texts.map((t) => t.id)).toEqual(['filled', 'other']);
    store.undo();
    expect(store.doc.pages['1'].texts.map((t) => t.id)).toEqual(['filled', 'corr', 'other']);
  });

  it('keeps the text of a deleted blank but unlinks it', () => {
    const store = setup();
    store.change('Delete', deletionOps(store.doc, [{ page: 1, coll: 'blanks', id: 'b1' }]));
    expect(store.doc.pages['1'].blanks).toEqual([]);
    expect(findEntity(store.doc, 1, 'texts', 'filled')?.blankId).toBeUndefined();
    store.undo();
    expect(findEntity(store.doc, 1, 'texts', 'filled')?.blankId).toBe('b1');
  });

  it('deletes a mixed selection without duplicates', () => {
    const store = setup();
    const ops = deletionOps(store.doc, [
      { page: 1, coll: 'marks', id: 'm' },
      { page: 1, coll: 'texts', id: 'corr' },
      { page: 1, coll: 'texts', id: 'other' },
      { page: 1, coll: 'texts', id: 'filled' },
      { page: 1, coll: 'blanks', id: 'b1' },
    ]);
    expect(ops).toHaveLength(5);
    store.change('Delete', ops);
    expect(store.doc.pages['1']).toBeUndefined();
  });
});

describe('blanks in the sidecar', () => {
  it('round-trip and drop invalid entries', () => {
    const { doc, warnings } = migrate(
      {
        version: 1,
        pages: { '2': { texts: [{ ...box('t'), blankId: 'b1' }], blanks: [blanks[0], { id: 'bad', x: 'no', y: 1 }] } },
      },
      'Book.pdf', 3, null,
    );
    expect(doc.pages['2'].blanks).toEqual([blanks[0]]);
    expect(doc.pages['2'].texts[0].blankId).toBe('b1');
    expect(warnings).toEqual(['Dropped an invalid blank on page 2.']);
    // Files written before blanks existed load with none.
    expect(migrate({ version: 1, pages: { '1': { texts: [box('t')] } } }, 'Book.pdf', 3, null).doc.pages['1'].blanks).toEqual([]);
  });
});
