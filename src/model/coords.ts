// Transforms between PDF user space and on-screen (CSS pixel) page space.
// Mirrors pdf.js PageViewport so overlays line up exactly with the canvas.

/** CSS pixels per PDF unit at 100 % zoom (PDF units are 1/72 in). */
export const CSS_PER_PDF_UNIT = 96 / 72;

export type Rotation = 0 | 90 | 180 | 270;

/** Static page geometry: the page's view box (pdf.js `page.view`) and /Rotate. */
export interface PageGeom {
  view: [number, number, number, number];
  rotation: Rotation;
}

/** Affine matrix [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Matrix = [number, number, number, number, number, number];

export interface Viewport {
  /** Size in CSS pixels after rotation. */
  width: number;
  height: number;
  /** PDF user space → page-local CSS pixels (origin top-left). */
  transform: Matrix;
  scale: number;
}

export function normalizeRotation(r: number): Rotation {
  const n = ((Math.round(r / 90) * 90) % 360 + 360) % 360;
  return n as Rotation;
}

/**
 * Builds the viewport for a page at `scale` CSS pixels per PDF unit.
 * Same maths as pdf.js `PageViewport` (with no extra offset).
 */
export function makeViewport(geom: PageGeom, scale: number): Viewport {
  const [x0, y0, x1, y1] = geom.view;
  const cx = (x1 + x0) / 2;
  const cy = (y1 + y0) / 2;
  let a: number, b: number, c: number, d: number;
  switch (geom.rotation) {
    case 90: a = 0; b = 1; c = 1; d = 0; break;
    case 180: a = -1; b = 0; c = 0; d = 1; break;
    case 270: a = 0; b = -1; c = -1; d = 0; break;
    default: a = 1; b = 0; c = 0; d = -1;
  }
  let offX: number, offY: number, width: number, height: number;
  if (a === 0) {
    offX = Math.abs(cy - y0) * scale;
    offY = Math.abs(cx - x0) * scale;
    width = (y1 - y0) * scale;
    height = (x1 - x0) * scale;
  } else {
    offX = Math.abs(cx - x0) * scale;
    offY = Math.abs(cy - y0) * scale;
    width = (x1 - x0) * scale;
    height = (y1 - y0) * scale;
  }
  const transform: Matrix = [
    a * scale, b * scale, c * scale, d * scale,
    offX - a * scale * cx - c * scale * cy,
    offY - b * scale * cx - d * scale * cy,
  ];
  return { width, height, transform, scale };
}

export function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function invertMatrix(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  if (det === 0) throw new Error('Singular matrix');
  return [
    m[3] / det, -m[1] / det, -m[2] / det, m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

/** PDF user-space point → page-local CSS pixels. */
export function pdfToScreen(vp: Viewport, x: number, y: number): [number, number] {
  return applyMatrix(vp.transform, x, y);
}

/** Page-local CSS pixels → PDF user-space point. */
export function screenToPdf(vp: Viewport, sx: number, sy: number): [number, number] {
  return applyMatrix(invertMatrix(vp.transform), sx, sy);
}

/** Unscaled page size in PDF units after rotation (what the reader sees). */
export function displaySize(geom: PageGeom): { width: number; height: number } {
  const w = geom.view[2] - geom.view[0];
  const h = geom.view[3] - geom.view[1];
  return geom.rotation === 90 || geom.rotation === 270 ? { width: h, height: w } : { width: w, height: h };
}
