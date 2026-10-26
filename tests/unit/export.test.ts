/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { degrees, PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { buildAnnotatedPdf, exportFileName } from '../../src/export/exportPdf';
import { baselineOffset, boxLines, wrapParagraph } from '../../src/export/layout';
import { makeViewport, pdfToScreen, screenToPdf, type PageGeom } from '../../src/model/coords';
import { createEmptyDoc, type TextBox } from '../../src/model/schema';

const charWidth = (s: string) => s.length * 10; // 10 units per character

describe('wrapping (fixed-width boxes)', () => {
  it('keeps text that fits on one line', () => {
    expect(wrapParagraph('ich gehe', 100, charWidth)).toEqual(['ich gehe']);
  });
  it('breaks at spaces', () => {
    expect(wrapParagraph('ich gehe nach Hause', 90, charWidth)).toEqual(['ich gehe', 'nach', 'Hause']);
  });
  it('breaks a word longer than the box between characters', () => {
    expect(wrapParagraph('Donaudampfschiff', 50, charWidth)).toEqual(['Donau', 'dampf', 'schif', 'f']);
  });
  it('honours explicit newlines and only wraps fixed-width boxes', () => {
    expect(boxLines('a b c\nd', null, charWidth)).toEqual(['a b c', 'd']);
    expect(boxLines('aa bb\ncc', 30, charWidth)).toEqual(['aa', 'bb', 'cc']);
    expect(boxLines('', 30, charWidth)).toEqual(['']);
  });
  it('places baselines one line height apart', () => {
    expect(baselineOffset(0, 10, 1)).toBe(10);
    expect(baselineOffset(2, 10, 1)).toBe(35);
  });
  it('names the export file', () => {
    expect(exportFileName('Book.pdf')).toBe('Book - answers.pdf');
    expect(exportFileName('Grammatik aktiv.PDF')).toBe('Grammatik aktiv - answers.pdf');
  });
});

/** Text items of a page as [string, x, y, angle°] using pdf.js (what viewers show). */
async function textItems(bytes: Uint8Array, pageNo: number) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: false }).promise;
  const page = await doc.getPage(pageNo);
  const content = await page.getTextContent();
  const items = (content.items as { str: string; transform: number[] }[])
    .filter((i) => i.str.trim())
    .map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], angle: Math.round((Math.atan2(i.transform[1], i.transform[0]) * 180) / Math.PI) }));
  await doc.destroy();
  return items;
}

describe('buildAnnotatedPdf', () => {
  const font = readFileSync('src/assets/fonts/NotoSans-Regular.ttf');
  const RATIO = 1.0; // baseline 1.0 × font size below the line-box top

  async function source() {
    const pdf = await PDFDocument.create();
    pdf.addPage([595, 842]);
    const rotated = pdf.addPage([595, 842]);
    rotated.setRotation(degrees(90));
    return pdf.save();
  }

  const text = (id: string, extra: Partial<TextBox>): TextBox => ({
    id, kind: 'text', x: 100, y: 700, width: null, fontSize: 12, color: '#1a4fd6', text: 'x', ...extra,
  });

  it('draws each line at the stored position, on plain and rotated pages', async () => {
    const doc = createEmptyDoc('Book.pdf', 2, null);
    doc.pages['1'] = {
      texts: [
        text('a', { text: 'gehe müssen Straße\nzweite Zeile' }),
        text('b', { kind: 'correction', x: 300, y: 500, text: 'kommt', markId: 'm' }),
      ],
      areas: [{ id: 'z', x: 0, y: 800, width: 100, height: 50, lines: 2, fontSize: 11 }],
      marks: [{ id: 'm', kind: 'cross', x: 290, y: 494, size: 14 }],
      blanks: [],
      underlines: [],
    };
    doc.pages['2'] = { texts: [text('c', { x: 200, y: 300, text: 'gedreht' })], areas: [], marks: [], blanks: [], underlines: [] };
    const geoms: PageGeom[] = [
      { view: [0, 0, 595, 842], rotation: 0 },
      { view: [0, 0, 595, 842], rotation: 90 },
    ];
    const bytes = await buildAnnotatedPdf({
      original: await source(), doc, geoms, fontBytes: font, baselineRatio: RATIO, options: { includeChecks: true },
    });

    const p1 = await textItems(bytes, 1);
    expect(p1.map((i) => i.str)).toEqual(['gehe müssen Straße', 'zweite Zeile', 'kommt']);
    expect(p1[0].x).toBeCloseTo(100, 1);
    expect(p1[0].y).toBeCloseTo(700 - 12 * RATIO, 1);
    expect(p1[1].y).toBeCloseTo(700 - 12 * (1.25 + RATIO), 1);
    expect(p1[2].y).toBeCloseTo(500 - 12 * RATIO, 1);

    // Rotated page: the line starts at the stored anchor's baseline and runs
    // along the reader's left-to-right direction.
    const p2 = await textItems(bytes, 2);
    const vp = makeViewport(geoms[1], 1);
    const [sx, sy] = pdfToScreen(vp, 200, 300);
    const [ex, ey] = screenToPdf(vp, sx, sy + 12 * RATIO);
    expect(p2[0].str).toBe('gedreht');
    expect(p2[0].x).toBeCloseTo(ex, 1);
    expect(p2[0].y).toBeCloseTo(ey, 1);
    expect(p2[0].angle).toBe(90);
  });

  it('leaves out marks and corrections when asked, and never areas or blanks', async () => {
    const doc = createEmptyDoc('Book.pdf', 2, null);
    doc.pages['1'] = {
      texts: [text('a', { text: 'Antwort' }), text('b', { kind: 'correction', text: 'Korrektur', markId: 'm' })],
      areas: [{ id: 'z', x: 0, y: 800, width: 100, height: 50, lines: 2, fontSize: 11 }],
      marks: [{ id: 'm', kind: 'cross', x: 290, y: 494, size: 14 }],
      blanks: [{ id: 'k', x: 120, y: 600 }],
      underlines: [],
    };
    const geoms: PageGeom[] = [{ view: [0, 0, 595, 842], rotation: 0 }, { view: [0, 0, 595, 842], rotation: 90 }];
    const without = await buildAnnotatedPdf({
      original: await source(), doc, geoms, fontBytes: font, baselineRatio: RATIO, options: { includeChecks: false },
    });
    expect((await textItems(without, 1)).map((i) => i.str)).toEqual(['Antwort']);
    const withChecks = await buildAnnotatedPdf({
      original: await source(), doc, geoms, fontBytes: font, baselineRatio: RATIO, options: { includeChecks: true },
    });
    expect(withChecks.length).toBeGreaterThan(without.length); // the ✗ strokes
  });

  it('draws underlines, with or without marks', async () => {
    const geoms: PageGeom[] = [{ view: [0, 0, 595, 842], rotation: 0 }, { view: [0, 0, 595, 842], rotation: 90 }];
    const doc = createEmptyDoc('Book.pdf', 2, null);
    doc.pages['1'] = {
      texts: [], areas: [], marks: [], blanks: [],
      underlines: [{ id: 'u', x: 100, y: 600, dx: 150, dy: 0, width: 1.2, color: '#1a4fd6' }],
    };
    const bytes = await buildAnnotatedPdf({
      original: await source(), doc, geoms, fontBytes: font, baselineRatio: RATIO, options: { includeChecks: false },
    });
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
    const ops = await (await pdf.getPage(1)).getOperatorList();
    // One stroke colour set and one stroked path: the underline.
    expect(ops.fnArray.filter((fn: number) => fn === pdfjs.OPS.setStrokeRGBColor)).toHaveLength(1);
    expect(ops.fnArray.filter((fn: number) => fn === pdfjs.OPS.stroke || fn === pdfjs.OPS.constructPath).length).toBeGreaterThan(0);
    await pdf.destroy();
  });

  it('does not modify the source bytes', async () => {
    const src = await source();
    const copy = src.slice();
    await buildAnnotatedPdf({
      original: src, doc: createEmptyDoc('Book.pdf', 2, null), geoms: [], fontBytes: font, baselineRatio: RATIO,
      options: { includeChecks: true },
    });
    expect(Buffer.from(src).equals(Buffer.from(copy))).toBe(true);
  });
});
