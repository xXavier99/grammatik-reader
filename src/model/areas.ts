// Answer-area row maths (pure; PDF user space, y up).
//
// The top edge of an area is the top of the first row's text; the bottom
// edge is the bottom of the last row (the printed line). Every row ends on
// its bottom line and text sits on it. The first row is exactly one text line
// high; the remaining rows share the rest evenly:
//
//   top ───────────  row 0: one text line (area.fontSize × LINE_HEIGHT)
//   ─────────────── ← bottom of row 0
//                    row 1: spacing
//   ─────────────── ← bottom of row 1
//   …
//   bottom ──────── ← bottom of the last row

import type { AnswerArea } from './schema';
import { LINE_HEIGHT } from './text';

type RowGeom = Pick<AnswerArea, 'y' | 'height' | 'lines' | 'fontSize'>;

/** Height of the first row: one line of text at the area's font size. */
export function firstRowHeight(area: Pick<AnswerArea, 'height' | 'fontSize'>): number {
  return Math.min(area.height, area.fontSize * LINE_HEIGHT);
}

/** Distance between consecutive row bottoms (the height of rows 1…n-1). */
export function rowSpacing(area: Pick<AnswerArea, 'height' | 'lines' | 'fontSize'>): number {
  if (area.lines <= 1) return area.height;
  return Math.max(1, (area.height - firstRowHeight(area)) / (area.lines - 1));
}

/** PDF y of the bottom (the line) of row `i`; the last row ends on the bottom edge. */
export function rowBottom(area: RowGeom, i: number): number {
  return area.y - area.height + (area.lines - 1 - i) * rowSpacing(area);
}

export function containsPoint(area: AnswerArea, x: number, y: number): boolean {
  return x >= area.x && x <= area.x + area.width && y <= area.y && y >= area.y - area.height;
}

/** Topmost-drawn (last) area containing the point, if any. */
export function areaAt(areas: AnswerArea[], x: number, y: number): AnswerArea | undefined {
  for (let i = areas.length - 1; i >= 0; i--) if (containsPoint(areas[i], x, y)) return areas[i];
  return undefined;
}

/** Row index (0 = top row) for a point's y, clamped to the area. */
export function rowIndexAt(area: RowGeom, y: number): number {
  if (area.lines <= 1) return 0;
  const b0 = rowBottom(area, 0);
  if (y >= b0) return 0;
  const i = Math.ceil((b0 - y) / rowSpacing(area));
  return Math.min(area.lines - 1, Math.max(0, i));
}

/** Box top (PDF y) so that a text line of `fontSize` sits on the bottom of row `index`. */
export function boxTopForRow(area: RowGeom, index: number, fontSize: number): number {
  return rowBottom(area, index) + fontSize * LINE_HEIGHT;
}

/** Top of the box on the next (dir = 1) or previous (dir = -1) row. */
export function adjacentRowTop(boxTop: number, spacing: number, dir: 1 | -1): number {
  return boxTop - dir * spacing;
}

/** Areas in reading order: top to bottom, then left to right. */
export function readingOrder(areas: AnswerArea[]): AnswerArea[] {
  return [...areas].sort((a, b) => (Math.abs(a.y - b.y) > 2 ? b.y - a.y : a.x - b.x));
}

/** Normalizes a dragged rectangle (two corners) into an area's geometry. */
export function rectFromCorners(x1: number, y1: number, x2: number, y2: number): Pick<AnswerArea, 'x' | 'y' | 'width' | 'height'> {
  return { x: Math.min(x1, x2), y: Math.max(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}
