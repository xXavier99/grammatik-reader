// Text box typography shared by the on-screen layer and the PDF export.

/** Line box height as a multiple of the font size. */
export const LINE_HEIGHT = 1.25;

/** CSS font-family of the bundled Noto Sans (see styles.css @font-face). */
export const TEXT_FONT_FAMILY = 'Annot Noto Sans';

/**
 * PDF y of the top edge for a box whose first line should be vertically
 * centred on `clickY` (PDF units, y up).
 */
export function boxTopForClick(clickY: number, fontSize: number): number {
  return clickY + (fontSize * LINE_HEIGHT) / 2;
}

/** Rounds PDF coordinates for storage (0.01 pt is far below visible). */
export function roundPt(v: number): number {
  return Math.round(v * 100) / 100;
}
