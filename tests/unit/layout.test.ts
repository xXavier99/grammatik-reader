import { describe, expect, it } from 'vitest';
import {
  clampZoom, computeLayout, dominantPage, fitWidthZoom, MAX_ZOOM, MIN_ZOOM, stepZoom, visibleRange,
} from '../../src/pdf/layout';

const sizes = Array.from({ length: 100 }, () => ({ width: 600, height: 800 }));

describe('computeLayout', () => {
  it('stacks pages with gaps and centres them', () => {
    const l = computeLayout(sizes, 1, 1000, 10, 16);
    expect(l.boxes[0]).toEqual({ top: 10, left: 200, width: 600, height: 800 });
    expect(l.boxes[1].top).toBe(820);
    expect(l.totalHeight).toBe(10 + 100 * 810);
    expect(l.totalWidth).toBe(1000);
  });

  it('grows wider than the container when zoomed in', () => {
    const l = computeLayout(sizes, 2, 1000, 10, 16);
    expect(l.totalWidth).toBe(1232);
    expect(l.boxes[0].left).toBe(16);
  });

  it('centres mixed page sizes individually', () => {
    const l = computeLayout([{ width: 600, height: 800 }, { width: 800, height: 600 }], 1, 1000, 10, 16);
    expect(l.boxes[0].left).toBe(200);
    expect(l.boxes[1].left).toBe(100);
  });

  it('keeps fitting pages centred in the container when one page is wider', () => {
    const l = computeLayout([{ width: 600, height: 800 }, { width: 1200, height: 600 }], 1, 664, 10, 16);
    expect(l.totalWidth).toBe(1232);
    expect(l.boxes[0].left).toBe(32);
    expect(l.boxes[1].left).toBe(16);
  });
});

describe('visibleRange / dominantPage', () => {
  const { boxes } = computeLayout(sizes, 1, 1000, 10, 16);

  it('finds only the pages intersecting the viewport', () => {
    expect(visibleRange(boxes, 0, 500)).toEqual([0, 0]);
    expect(visibleRange(boxes, 700, 500)).toEqual([0, 1]);
    expect(visibleRange(boxes, 810 * 50, 900)).toEqual([50, 51]);
    expect(visibleRange(boxes, 810 * 50 - 1, 900)).toEqual([49, 51]);
  });

  it('includes overscan', () => {
    expect(visibleRange(boxes, 810 * 50 + 10, 100, 900)).toEqual([48, 51]);
  });

  it('returns null past the end', () => {
    expect(visibleRange(boxes, 1e9, 500)).toBeNull();
  });

  it('picks the page covering most of the viewport', () => {
    expect(dominantPage(boxes, 700, 500)).toBe(1);
    expect(dominantPage(boxes, 300, 500)).toBe(0);
  });
});

describe('zoom helpers', () => {
  it('fits width', () => {
    expect(fitWidthZoom(600, 632, 1, 16)).toBeCloseTo(1);
  });
  it('clamps', () => {
    expect(clampZoom(100)).toBe(MAX_ZOOM);
    expect(clampZoom(0)).toBe(MIN_ZOOM);
  });
  it('steps through presets', () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(1.04, 1)).toBe(1.1);
    expect(stepZoom(5, 1)).toBe(5);
  });
});
