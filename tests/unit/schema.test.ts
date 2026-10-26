import { describe, expect, it } from 'vitest';
import { createEmptyDoc, migrate, SchemaError, SCHEMA_VERSION } from '../../src/model/schema';

const load = (raw: unknown) => migrate(raw, 'Book.pdf', 50, 'fp1');

describe('createEmptyDoc', () => {
  it('produces a valid v1 document that survives a JSON round trip', () => {
    const doc = createEmptyDoc('Book.pdf', 50, 'fp1');
    expect(doc.version).toBe(SCHEMA_VERSION);
    const { doc: again, warnings } = load(JSON.parse(JSON.stringify(doc)));
    expect(warnings).toEqual([]);
    expect(again).toEqual(doc);
  });
});

describe('migrate', () => {
  it('rejects non-objects and missing versions', () => {
    expect(() => load(null)).toThrow(SchemaError);
    expect(() => load([])).toThrow(SchemaError);
    expect(() => load({ pages: {} })).toThrow(/version/);
  });

  it('rejects files from a newer app version', () => {
    expect(() => load({ version: 99 })).toThrow(/newer version/);
  });

  it('fills defaults for a minimal v1 file', () => {
    const { doc } = load({ version: 1 });
    expect(doc.settings.defaultFontSize).toBe(11);
    expect(doc.view.lastPage).toBe(1);
    expect(doc.pages).toEqual({});
  });

  it('keeps valid annotations and drops invalid ones with warnings', () => {
    const { doc, warnings } = load({
      version: 1,
      pages: {
        '3': {
          texts: [
            { id: 'a', x: 10, y: 700, text: 'gehe', width: null, fontSize: 12, color: '#FF0000', areaId: 'z', lineIndex: 2 },
            { id: 'b', x: 'nope', y: 1, text: 'x' },
          ],
          areas: [
            { id: 'z', x: 0, y: 800, width: 300, height: 200, lines: 8, fontSize: 11 },
            { id: 'bad', x: 0, y: 0, width: -1, height: 5 },
          ],
          marks: [
            { id: 'm', kind: 'check', x: 50, y: 50, size: 14 },
            { id: 'm2', kind: 'star', x: 1, y: 1 },
          ],
        },
        '999': { texts: [{ id: 'c', x: 1, y: 1, text: 'lost' }] },
      },
    });
    expect(doc.pages['3'].texts).toEqual([
      { id: 'a', kind: 'text', x: 10, y: 700, width: null, fontSize: 12, color: '#ff0000', text: 'gehe', areaId: 'z', lineIndex: 2 },
    ]);
    expect(doc.pages['3'].areas).toHaveLength(1);
    expect(doc.pages['3'].marks).toHaveLength(1);
    expect(doc.pages['999']).toBeUndefined();
    expect(warnings).toHaveLength(4);
  });

  it('clamps view state and mapping pages to the document', () => {
    const { doc } = load({
      version: 1,
      view: { lastPage: 400, zoom: 50, split: 'diagonal', secondPane: { page: -3 } },
      answerKey: { answerStartPage: 41, linked: true, mapping: [{ fromPage: 12, toPage: 10, answerPage: 99 }] },
    });
    expect(doc.view.lastPage).toBe(50);
    expect(doc.view.zoom).toBe(10);
    expect(doc.view.split).toBe('none');
    expect(doc.view.secondPane.page).toBe(1);
    expect(doc.answerKey).toEqual({ answerStartPage: 41, linked: true, mapping: [{ fromPage: 10, toPage: 12, answerPage: 50 }] });
  });

  it('warns when the PDF fingerprint differs', () => {
    const { warnings } = load({ version: 1, pdf: { fingerprint: 'other' } });
    expect(warnings[0]).toMatch(/different version/);
  });
});
