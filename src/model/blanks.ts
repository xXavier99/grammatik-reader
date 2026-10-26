// Blanks: placeholders for answers scattered over a text, placed in the order
// they should be filled. Tab walks them in that order; clicks near one snap
// to it ("magnet"). Geometry here is in page-local CSS pixels, as the reader
// sees the page.

import { pdfToScreen, type Viewport } from './coords';
import type { Blank, TextBox } from './schema';
import { LINE_HEIGHT } from './text';

/** Width of a blank's marker, in ems of the text font size. */
export const BLANK_WIDTH_EM = 2.5;
/** Clicks within this distance (CSS px) of a blank's marker snap to it. */
export const MAGNET_PX = 18;

export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Screen rectangle of a blank's marker: one text line high, starting at the blank. */
export function blankRect(vp: Viewport, b: Blank, fontSize: number): ScreenRect {
  const [sx, sy] = pdfToScreen(vp, b.x, b.y);
  const height = fontSize * LINE_HEIGHT * vp.scale;
  return { left: sx, top: sy - height / 2, width: fontSize * BLANK_WIDTH_EM * vp.scale, height };
}

/** Distance from a point to a rectangle (0 inside). */
export function rectDistance(r: ScreenRect, x: number, y: number): number {
  const dx = Math.max(r.left - x, 0, x - (r.left + r.width));
  const dy = Math.max(r.top - y, 0, y - (r.top + r.height));
  return Math.hypot(dx, dy);
}

/** The blank whose marker is closest to (x, y), if within `maxDist`. */
export function nearestBlank(blanks: Blank[], vp: Viewport, fontSize: number, x: number, y: number, maxDist = MAGNET_PX): Blank | undefined {
  let best: Blank | undefined;
  let bestDist = maxDist;
  for (const b of blanks) {
    const d = rectDistance(blankRect(vp, b, fontSize), x, y);
    if (d <= bestDist) {
      best = b;
      bestDist = d;
    }
  }
  return best;
}

/** The text box typed into a blank, if any. */
export function boxForBlank(texts: TextBox[], blankId: string): TextBox | undefined {
  return texts.find((t) => t.blankId === blankId);
}

/** The blank after (dir 1) or before (dir -1) `id` in fill order. */
export function adjacentBlank(blanks: Blank[], id: string, dir: 1 | -1): Blank | undefined {
  const i = blanks.findIndex((b) => b.id === id);
  return i < 0 ? undefined : blanks[i + dir];
}

/** First blank (in fill order) that has no text yet. */
export function firstEmptyBlank(blanks: Blank[], texts: TextBox[]): Blank | undefined {
  return blanks.find((b) => !boxForBlank(texts, b.id));
}
