// ✓ / ✗ glyphs as vector strokes, shared by the screen layer and the PDF
// export (the bundled font has no check-mark glyphs, and strokes scale cleanly).
//
// Coordinates are in units of the mark size, centred on the mark, y DOWN.

import type { Mark } from './schema';

export const MARK_STROKE = 0.13;

export const MARK_COLORS: Record<Mark['kind'], string> = {
  check: '#1e9e3a',
  cross: '#d11a2a',
};

/** Polylines making up each glyph. */
export const MARK_PATHS: Record<Mark['kind'], [number, number][][]> = {
  check: [[[-0.36, 0.02], [-0.1, 0.3], [0.38, -0.32]]],
  cross: [
    [[-0.3, -0.3], [0.3, 0.3]],
    [[-0.3, 0.3], [0.3, -0.3]],
  ],
};
