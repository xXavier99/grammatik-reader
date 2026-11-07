import { describe, expect, it } from 'vitest';
import { detectGaps, readingOrder, type InkImage } from '../../src/model/blankDetect';

const S = 2; // px per pt

function blankImage(width: number, height: number): InkImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) };
}

function fill(img: InkImage, x0: number, y0: number, x1: number, y1: number, grey = 0): void {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = (y * img.width + x) * 4;
      img.data[p] = img.data[p + 1] = img.data[p + 2] = grey;
    }
  }
}

/** Fake printed text: thin vertical stems, no long horizontal strokes. */
function text(img: InkImage, x0: number, x1: number, top: number, baseline: number): void {
  for (let x = x0; x < x1; x += 5) fill(img, x, top, x + 2, baseline);
}

const all = { left: 0, top: 0, right: 1e9, bottom: 1e9 };

describe('gap line detection', () => {
  it('finds gap lines in reading order, centred on their text line', () => {
    const img = blankImage(400, 200);
    // Line 1: "text___ text___ text", text from y 40 to 60, lines just below.
    text(img, 20, 98, 40, 60);
    fill(img, 100, 62, 160, 64);
    text(img, 165, 248, 40, 60);
    fill(img, 250, 62, 300, 64, 120); // a grey line counts too
    text(img, 305, 380, 40, 60);
    // Line 2, placed first in the image data on purpose: order comes from position.
    text(img, 10, 48, 120, 140);
    fill(img, 50, 142, 110, 144);

    const gaps = detectGaps(img, S, all);
    expect(gaps).toEqual([
      { x: 100, y: 51 },
      { x: 250, y: 51 },
      { x: 50, y: 131 },
    ]);
  });

  it('ignores short strokes, thick bars and lines outside the selection', () => {
    const img = blankImage(400, 200);
    text(img, 20, 98, 40, 60);
    fill(img, 100, 62, 110, 64); // 5 pt: too short
    fill(img, 150, 50, 250, 70); // filled box
    fill(img, 300, 62, 360, 64);
    fill(img, 50, 142, 110, 144);
    expect(detectGaps(img, S, all).map((g) => g.x)).toEqual([300, 50]);
    // Only lines whose middle is inside the rectangle.
    expect(detectGaps(img, S, { left: 0, top: 100, right: 200, bottom: 200 }).map((g) => g.x)).toEqual([50]);
  });

  it('finds faint grey hairlines spread over several pixel rows', () => {
    const img = blankImage(400, 100);
    text(img, 20, 98, 40, 60);
    // As rendered from a book: a light grey line, anti-aliased over three rows.
    fill(img, 100, 61, 143, 62, 185);
    fill(img, 100, 62, 143, 63, 153);
    fill(img, 100, 63, 143, 64, 200);
    expect(detectGaps(img, S, all)).toEqual([{ x: 100, y: 50.5 }]);
  });

  it('uses the typical text height for a line with no text around it', () => {
    const img = blankImage(600, 200);
    text(img, 20, 98, 40, 60);
    fill(img, 100, 62, 160, 64);
    fill(img, 400, 142, 460, 144); // alone, far from any text
    expect(detectGaps(img, S, all)).toEqual([
      { x: 100, y: 51 },
      { x: 400, y: 131 },
    ]);
  });

  it('keeps items on one text line in left-to-right order', () => {
    const items = [{ x: 50, y: 103 }, { x: 10, y: 100 }, { x: 5, y: 130 }];
    expect(readingOrder(items, 10)).toEqual([{ x: 10, y: 100 }, { x: 50, y: 103 }, { x: 5, y: 130 }]);
  });
});
