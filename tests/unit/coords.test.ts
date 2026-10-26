import { describe, expect, it } from 'vitest';
import {
  CSS_PER_PDF_UNIT, displaySize, invertMatrix, makeViewport, normalizeRotation, pdfToScreen, screenToPdf,
  type PageGeom, type Rotation,
} from '../../src/model/coords';

const A4: PageGeom = { view: [0, 0, 595, 842], rotation: 0 };

describe('makeViewport', () => {
  it('maps the PDF origin (bottom-left) to the screen bottom-left at rotation 0', () => {
    const vp = makeViewport(A4, 2);
    expect(vp.width).toBe(1190);
    expect(vp.height).toBe(1684);
    expect(pdfToScreen(vp, 0, 0)).toEqual([0, 1684]);
    expect(pdfToScreen(vp, 595, 842)).toEqual([1190, 0]);
    expect(pdfToScreen(vp, 100, 800)).toEqual([200, 84]);
  });

  it('accounts for a non-zero view box origin', () => {
    const vp = makeViewport({ view: [10, 20, 110, 220], rotation: 0 }, 1);
    expect(pdfToScreen(vp, 10, 220)).toEqual([0, 0]);
    expect(pdfToScreen(vp, 110, 20)).toEqual([100, 200]);
  });

  it.each<[Rotation, [number, number]]>([
    [90, [0, 0]],
    [180, [595, 0]],
    [270, [842, 595]],
  ])('rotation %i puts the PDF origin at %j and swaps size when needed', (rotation, origin) => {
    const vp = makeViewport({ ...A4, rotation }, 1);
    const [x, y] = pdfToScreen(vp, 0, 0);
    expect(x).toBeCloseTo(origin[0]);
    expect(y).toBeCloseTo(origin[1]);
    const swapped = rotation % 180 !== 0;
    expect(vp.width).toBe(swapped ? 842 : 595);
    expect(vp.height).toBe(swapped ? 595 : 842);
  });

  it('round-trips screen <-> PDF at every rotation and zoom', () => {
    for (const rotation of [0, 90, 180, 270] as Rotation[]) {
      for (const scale of [0.5, 1, CSS_PER_PDF_UNIT, 3.7]) {
        const vp = makeViewport({ view: [5, 7, 600, 850], rotation }, scale);
        const [sx, sy] = pdfToScreen(vp, 123.4, 567.8);
        const [x, y] = screenToPdf(vp, sx, sy);
        expect(x).toBeCloseTo(123.4, 9);
        expect(y).toBeCloseTo(567.8, 9);
      }
    }
  });

  it('is zoom independent: screen distance scales linearly', () => {
    const a = makeViewport(A4, 1);
    const b = makeViewport(A4, 2.5);
    const [ax, ay] = pdfToScreen(a, 300, 400);
    const [bx, by] = pdfToScreen(b, 300, 400);
    expect(bx).toBeCloseTo(ax * 2.5);
    expect(by).toBeCloseTo(ay * 2.5);
  });
});

describe('helpers', () => {
  it('inverts a matrix', () => {
    const m = makeViewport({ ...A4, rotation: 90 }, 1.7).transform;
    const inv = invertMatrix(m);
    const id = [
      m[0] * inv[0] + m[2] * inv[1], m[1] * inv[0] + m[3] * inv[1],
      m[0] * inv[2] + m[2] * inv[3], m[1] * inv[2] + m[3] * inv[3],
    ];
    expect(id.map((v) => Math.round(v * 1e9) / 1e9 + 0)).toEqual([1, 0, 0, 1]);
  });

  it('normalizes rotation', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(360)).toBe(0);
  });

  it('reports display size after rotation', () => {
    expect(displaySize({ ...A4, rotation: 90 })).toEqual({ width: 842, height: 595 });
    expect(displaySize(A4)).toEqual({ width: 595, height: 842 });
  });
});
