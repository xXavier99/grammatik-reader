// Pure text layout for export, mirroring how the on-screen text boxes are laid
// out (CSS `white-space: pre` / `pre-wrap; overflow-wrap: break-word`,
// line-height LINE_HEIGHT).

import { LINE_HEIGHT } from '../model/text';

export type Measure = (s: string) => number;

/** Splits a fixed-width paragraph like the browser: at spaces, long words by character. */
export function wrapParagraph(text: string, width: number, measure: Measure): string[] {
  if (measure(text) <= width) return [text];
  const tokens = text.split(/( +)/).filter((t) => t !== '');
  const lines: string[] = [];
  let line = '';
  for (const tok of tokens) {
    if (measure(line + tok) <= width) {
      line += tok;
      continue;
    }
    if (/^ +$/.test(tok)) {
      // Spaces at a break "hang" past the edge and are not carried over.
      lines.push(line);
      line = '';
      continue;
    }
    if (line.trim() !== '') lines.push(line.trimEnd());
    line = '';
    if (measure(tok) <= width) {
      line = tok;
      continue;
    }
    // A single word wider than the box: break it between characters.
    for (const ch of tok) {
      if (line !== '' && measure(line + ch) > width) {
        lines.push(line);
        line = '';
      }
      line += ch;
    }
  }
  if (line !== '' || lines.length === 0) lines.push(line);
  return lines;
}

/** Visual lines of a text box (explicit newlines, plus wrapping when it has a fixed width). */
export function boxLines(text: string, widthPt: number | null, measure: Measure): string[] {
  const paragraphs = text.split('\n');
  if (widthPt === null) return paragraphs;
  return paragraphs.flatMap((p) => wrapParagraph(p, widthPt, measure));
}

/**
 * Distance (in the box's own downward direction, PDF units) from the box top
 * to the baseline of line `i`. `baselineRatio` is the baseline position inside
 * one line box as a fraction of the font size (measured in the browser).
 */
export function baselineOffset(i: number, fontSize: number, baselineRatio: number): number {
  return (i * LINE_HEIGHT + baselineRatio) * fontSize;
}
