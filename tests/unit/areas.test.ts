import { describe, expect, it } from 'vitest';
import {
  adjacentRowTop, areaAt, boxTopForRow, containsPoint, firstRowHeight, readingOrder, rectFromCorners, rowBottom, rowIndexAt,
  rowSpacing,
} from '../../src/model/areas';
import type { AnswerArea } from '../../src/model/schema';
import { LINE_HEIGHT } from '../../src/model/text';
import { resizeArea } from '../../src/tools/area';

const LH = 11 * LINE_HEIGHT; // 13.75: one text line at 11 pt
// 3 rows: top = top of row 0's text (y 700), bottom = line under row 2.
// Row 0 is one text line high, rows 1 and 2 are 24 pt each.
const area: AnswerArea = { id: 'a', x: 100, y: 700, width: 300, height: LH + 48, lines: 3, fontSize: 11 };

describe('row maths', () => {
  it('makes the first row one text line high and splits the rest evenly', () => {
    expect(firstRowHeight(area)).toBeCloseTo(LH, 9);
    expect(rowSpacing(area)).toBeCloseTo(24, 9);
    expect(rowBottom(area, 0)).toBeCloseTo(700 - LH, 9);
    expect(rowBottom(area, 1)).toBeCloseTo(700 - LH - 24, 9);
    expect(rowBottom(area, 2)).toBeCloseTo(area.y - area.height, 9);
  });

  it('treats a single-line area as one row ending on the bottom edge', () => {
    const one = { ...area, lines: 1, height: 30 };
    expect(rowBottom(one, 0)).toBe(670);
    expect(rowIndexAt(one, 690)).toBe(0);
    expect(boxTopForRow(one, 0, 11)).toBeCloseTo(670 + LH, 9);
  });

  it('clamps the first row to the area when the area is very flat', () => {
    expect(firstRowHeight({ height: 5, fontSize: 11 })).toBe(5);
    expect(rowSpacing({ height: 5, lines: 3, fontSize: 11 })).toBe(1);
  });

  it('snaps a point to the row it falls in, clamped to the area', () => {
    const b0 = rowBottom(area, 0);
    expect(rowIndexAt(area, 699)).toBe(0);
    expect(rowIndexAt(area, b0 + 0.1)).toBe(0);
    expect(rowIndexAt(area, b0 - 0.1)).toBe(1);
    expect(rowIndexAt(area, b0 - 23.9)).toBe(1);
    expect(rowIndexAt(area, b0 - 24.1)).toBe(2);
    expect(rowIndexAt(area, 800)).toBe(0);
    expect(rowIndexAt(area, 0)).toBe(2);
  });

  it('puts the text on the bottom of its row; row 0 starts exactly at the top edge', () => {
    expect(boxTopForRow(area, 0, 11)).toBeCloseTo(area.y, 9);
    for (const row of [0, 1, 2]) {
      expect(boxTopForRow(area, row, 11) - LH).toBeCloseTo(rowBottom(area, row), 9);
    }
  });

  it('Enter / arrows move exactly one row spacing, also past the area', () => {
    const r0 = boxTopForRow(area, 0, 11);
    expect(adjacentRowTop(r0, 24, 1)).toBeCloseTo(boxTopForRow(area, 1, 11), 9);
    expect(adjacentRowTop(boxTopForRow(area, 2, 11), 24, -1)).toBeCloseTo(boxTopForRow(area, 1, 11), 9);
    expect(adjacentRowTop(boxTopForRow(area, 2, 11), 24, 1)).toBeCloseTo(r0 - 72, 9);
  });

  it('hit-tests areas, preferring the last drawn', () => {
    const b: AnswerArea = { ...area, id: 'b', x: 150 };
    expect(containsPoint(area, 100, area.y - area.height)).toBe(true);
    expect(containsPoint(area, 99, 680)).toBe(false);
    expect(areaAt([area, b], 200, 680)?.id).toBe('b');
    expect(areaAt([area, b], 120, 680)?.id).toBe('a');
    expect(areaAt([area, b], 120, 600)).toBeUndefined();
  });

  it('orders areas top to bottom, then left to right', () => {
    const lower: AnswerArea = { ...area, id: 'lower', y: 500 };
    const right: AnswerArea = { ...area, id: 'right', x: 400, y: 701 };
    expect(readingOrder([lower, right, area]).map((a) => a.id)).toEqual(['a', 'right', 'lower']);
  });

  it('normalizes a dragged rectangle in any direction', () => {
    expect(rectFromCorners(400, 652, 100, 700)).toEqual({ x: 100, y: 700, width: 300, height: 48 });
  });
});

describe('resizeArea', () => {
  const a: AnswerArea = { ...area, height: 48 };
  it('moves', () => {
    expect(resizeArea(a, 'move', 10, -5)).toEqual({ x: 110, y: 695, width: 300, height: 48 });
  });
  it('resizes from the top edge without moving the bottom', () => {
    const g = resizeArea(a, 'n', 0, 12);
    expect(g.y).toBe(712);
    expect(g.y - g.height).toBe(652);
  });
  it('resizes from the bottom and right', () => {
    expect(resizeArea(a, 'se', 20, -12)).toEqual({ x: 100, y: 700, width: 320, height: 60 });
  });
  it('resizes from the left keeping the right edge', () => {
    const g = resizeArea(a, 'w', 50, 0);
    expect(g.x + g.width).toBe(400);
  });
  it('never collapses below the minimum size', () => {
    const g = resizeArea(a, 'nw', 1000, -1000);
    expect(g.width).toBe(4);
    expect(g.height).toBe(4);
    expect(g.x + g.width).toBe(400);
    expect(g.y - g.height).toBe(652);
  });
});
