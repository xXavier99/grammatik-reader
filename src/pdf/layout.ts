// Pure layout maths for the virtualized vertical page strip.

export interface Size {
  width: number;
  height: number;
}

export interface PageBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Layout {
  boxes: PageBox[];
  totalWidth: number;
  totalHeight: number;
}

export const PAGE_GAP = 16;
export const SIDE_PAD = 16;

/**
 * Stacks pages vertically. Each page is centred in the container if it fits,
 * otherwise starts at the left padding (so one wide page does not push the
 * others off-screen). `sizes` are display sizes in PDF units; `scale` is CSS
 * px per PDF unit.
 */
export function computeLayout(sizes: Size[], scale: number, containerWidth: number, gap = PAGE_GAP, pad = SIDE_PAD): Layout {
  let maxW = 0;
  for (const s of sizes) maxW = Math.max(maxW, s.width * scale);
  const totalWidth = Math.max(containerWidth, Math.ceil(maxW + 2 * pad));
  const boxes: PageBox[] = [];
  let y = gap;
  for (const s of sizes) {
    const width = Math.round(s.width * scale);
    const height = Math.round(s.height * scale);
    const left = Math.max(pad, Math.round((containerWidth - width) / 2));
    boxes.push({ top: y, left, width, height });
    y += height + gap;
  }
  return { boxes, totalWidth, totalHeight: y };
}

/** Index of the first box whose bottom edge is below `y` (binary search). */
export function firstBoxBelow(boxes: PageBox[], y: number): number {
  let lo = 0;
  let hi = boxes.length - 1;
  let ans = boxes.length;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (boxes[mid].top + boxes[mid].height > y) {
      ans = mid;
      hi = mid - 1;
    } else lo = mid + 1;
  }
  return ans;
}

/** Inclusive [first, last] indices of boxes intersecting the band, or null. */
export function visibleRange(boxes: PageBox[], top: number, height: number, overscan = 0): [number, number] | null {
  if (!boxes.length) return null;
  const y0 = top - overscan;
  const y1 = top + height + overscan;
  const first = firstBoxBelow(boxes, y0);
  if (first >= boxes.length || boxes[first].top >= y1) return null;
  let last = first;
  while (last + 1 < boxes.length && boxes[last + 1].top < y1) last++;
  return [first, last];
}

/** Index of the page occupying the most of the viewport (ties → earlier page). */
export function dominantPage(boxes: PageBox[], top: number, height: number): number {
  const range = visibleRange(boxes, top, height);
  if (!range) return boxes.length ? Math.min(boxes.length - 1, firstBoxBelow(boxes, top)) : 0;
  let best = range[0];
  let bestArea = -1;
  for (let i = range[0]; i <= range[1]; i++) {
    const b = boxes[i];
    const visible = Math.min(b.top + b.height, top + height) - Math.max(b.top, top);
    if (visible > bestArea + 0.5) {
      best = i;
      bestArea = visible;
    }
  }
  return best;
}

/** Zoom (multiple of 100 %) that fits `pageWidth` PDF units into the container. */
export function fitWidthZoom(pageWidth: number, containerWidth: number, cssPerUnit: number, pad = SIDE_PAD): number {
  const avail = Math.max(50, containerWidth - 2 * pad);
  return avail / (pageWidth * cssPerUnit);
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[s.length >> 1];
}

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 5;

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** Next preset zoom step above/below `z` (for the +/- buttons). */
export function stepZoom(z: number, dir: 1 | -1): number {
  const steps = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
  if (dir > 0) return steps.find((s) => s > z + 0.001) ?? MAX_ZOOM;
  return [...steps].reverse().find((s) => s < z - 0.001) ?? MIN_ZOOM;
}
