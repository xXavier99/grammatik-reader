// Finds printed gap lines ("am nächst___ Samstag") in a rendered page image,
// so Blanks mode can place a blank on each one in a dragged rectangle. Works
// on pixels, so it does not matter whether the PDF draws the line as a path or
// as underscore glyphs. All geometry here is in image pixels.

/** RGBA pixels, as returned by `getImageData`. */
export interface InkImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface PixelRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A gap line: (x, y) is its left end, vertically centred on the printed text line above it. */
export interface DetectedGap {
  x: number;
  y: number;
}

/** Luminance below this counts as ink (grey lines included, paper excluded). */
const INK_LUMA = 170;
/** Gap lines are at least this long (pt). Letters never have horizontal strokes this long. */
const MIN_LENGTH_PT = 12;
/** Thicker than this (pt) is a filled box or a rule, not a gap line. */
const MAX_THICKNESS_PT = 2.5;
/** Horizontal distance (pt) on each side of a line searched for the text it belongs to. */
const TEXT_BAND_PT = 20;
/** How far above a line (pt) its text may reach. */
const MAX_TEXT_HEIGHT_PT = 20;
/** Empty space allowed between a line and the text above it (pt). */
const LINE_TEXT_GAP_PT = 4;
/** Empty rows (pt) that end the text above a line (the gap to the previous text line). */
const INTERLINE_GAP_PT = 1.5;
/** Text height assumed when no text is found near any line (pt). */
const DEFAULT_TEXT_HEIGHT_PT = 10;
/** Lines whose centres are this close vertically (pt) are on the same text line. */
const SAME_LINE_PT = 5;

interface Stroke {
  x0: number;
  /** Exclusive. */
  x1: number;
  top: number;
  bottom: number;
}

export function inkMask(img: InkImage): Uint8Array {
  const mask = new Uint8Array(img.width * img.height);
  const d = img.data;
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    if (d[p + 3] >= 128 && 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2] < INK_LUMA) mask[i] = 1;
  }
  return mask;
}

/**
 * Gap lines whose middle lies inside `sel`, in reading order (top to bottom,
 * left to right). `pxPerPt` is the image resolution in pixels per PDF unit.
 */
export function detectGaps(img: InkImage, pxPerPt: number, sel: PixelRect): DetectedGap[] {
  const { width: w, height: h } = img;
  const mask = inkMask(img);
  const pt = (v: number, min = 1) => Math.max(min, Math.round(v * pxPerPt));
  const minLen = pt(MIN_LENGTH_PT);
  const maxThick = pt(MAX_THICKNESS_PT, 2);

  // Long horizontal runs of ink per row, joined across rows into strokes.
  const strokes: Stroke[] = [];
  let open: Stroke[] = [];
  for (let y = 0; y < h; y++) {
    const next: Stroke[] = [];
    for (const [x0, x1] of rowRuns(mask, w, y, minLen)) {
      const s = open.find((o) => overlap(o.x0, o.x1, x0, x1) >= 0.5 * Math.min(o.x1 - o.x0, x1 - x0));
      if (s) {
        s.x0 = Math.min(s.x0, x0);
        s.x1 = Math.max(s.x1, x1);
        s.bottom = y;
        open = open.filter((o) => o !== s);
        next.push(s);
      } else {
        const ns = { x0, x1, top: y, bottom: y };
        strokes.push(ns);
        next.push(ns);
      }
    }
    open = next;
  }

  const lines = strokes.filter((s) => {
    if (s.bottom - s.top + 1 > maxThick) return false;
    const mid = (s.x0 + s.x1) / 2;
    if (mid < sel.left || mid > sel.right || s.top < sel.top || s.top > sel.bottom) return false;
    // Paper right above and below: not the edge of a picture or a filled shape.
    return inkFraction(mask, w, h, s.top - 1, s.x0, s.x1) <= 0.3 && inkFraction(mask, w, h, s.bottom + 1, s.x0, s.x1) <= 0.3;
  });

  const heights = lines.map((s) => textHeightAbove(mask, w, s, pt));
  const known = heights.filter((v): v is number => v !== null).sort((a, b) => a - b);
  const fallback = known.length ? known[Math.floor(known.length / 2)] : DEFAULT_TEXT_HEIGHT_PT * pxPerPt;
  const gaps = lines.map((s, i) => ({ x: s.x0, y: s.top - (heights[i] ?? fallback) / 2 }));
  return readingOrder(gaps, SAME_LINE_PT * pxPerPt);
}

/** Runs of ink at least `minLen` long in row `y`, bridging 1 px holes (anti-aliasing). */
function rowRuns(mask: Uint8Array, w: number, y: number, minLen: number): [number, number][] {
  const runs: [number, number][] = [];
  const row = y * w;
  let x = 0;
  while (x < w) {
    if (!mask[row + x]) {
      x++;
      continue;
    }
    const x0 = x;
    let end = x + 1;
    while (end < w && (mask[row + end] || (end + 1 < w && mask[row + end + 1]))) end++;
    if (end - x0 >= minLen) runs.push([x0, end]);
    x = end + 1;
  }
  return runs;
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function inkFraction(mask: Uint8Array, w: number, h: number, y: number, x0: number, x1: number): number {
  if (y < 0 || y >= h || x1 <= x0) return 0;
  let n = 0;
  for (let x = x0; x < x1; x++) n += mask[y * w + x];
  return n / (x1 - x0);
}

/**
 * Height of the printed text a line belongs to, measured from the line's top
 * to the top of the ink above it (next to and over the line). Null if none.
 */
function textHeightAbove(mask: Uint8Array, w: number, s: Stroke, pt: (v: number, min?: number) => number): number | null {
  const bx0 = Math.max(0, s.x0 - pt(TEXT_BAND_PT));
  const bx1 = Math.min(w, s.x1 + pt(TEXT_BAND_PT));
  const lowest = Math.max(0, s.top - pt(MAX_TEXT_HEIGHT_PT));
  const skip = pt(LINE_TEXT_GAP_PT);
  const stop = pt(INTERLINE_GAP_PT, 2);
  let inkTop = -1;
  let empty = 0;
  for (let y = s.top - 1; y >= lowest; y--) {
    let ink = false;
    for (let x = bx0; x < bx1 && !ink; x++) ink = mask[y * w + x] === 1;
    if (ink) {
      inkTop = y;
      empty = 0;
    } else if (++empty > (inkTop < 0 ? skip : stop)) {
      break;
    }
  }
  return inkTop < 0 ? null : s.top - inkTop;
}

/** Sorts top to bottom; gaps on the same text line go left to right. */
export function readingOrder<T extends { x: number; y: number }>(items: T[], sameLine: number): T[] {
  const byY = [...items].sort((a, b) => a.y - b.y);
  const out: T[] = [];
  let i = 0;
  while (i < byY.length) {
    let j = i + 1;
    while (j < byY.length && byY[j].y - byY[i].y < sameLine) j++;
    out.push(...byY.slice(i, j).sort((a, b) => a.x - b.x));
    i = j;
  }
  return out;
}
