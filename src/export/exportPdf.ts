// Bakes annotations into a copy of the PDF with pdf-lib. No DOM access: the
// caller supplies the original bytes, the font and the measured baseline.

import fontkit from '@pdf-lib/fontkit';
import { degrees, LineCapStyle, PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { makeViewport, pdfToScreen, screenToPdf, type PageGeom, type Viewport } from '../model/coords';
import { MARK_COLORS, MARK_PATHS, MARK_STROKE } from '../model/marks';
import type { Mark, SidecarDoc, TextBox, Underline } from '../model/schema';
import { baselineOffset, boxLines } from './layout';

export interface ExportOptions {
  /** Include ✓/✗ marks and corrections. */
  includeChecks: boolean;
}

export interface ExportInput {
  original: ArrayBuffer | Uint8Array;
  doc: SidecarDoc;
  /** Page geometry as seen by pdf.js (view box + rotation), index = page - 1. */
  geoms: PageGeom[];
  fontBytes: ArrayBuffer | Uint8Array;
  /** Baseline position inside a line box, as a fraction of the font size. */
  baselineRatio: number;
  options: ExportOptions;
}

export async function buildAnnotatedPdf(input: ExportInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(input.original, { ignoreEncryption: true, updateMetadata: false });
  pdf.registerFontkit(fontkit);
  // Full embed: subsetting with fontkit is known to garble some glyphs.
  const font = await pdf.embedFont(input.fontBytes, { subset: false });
  const pages = pdf.getPages();

  for (const [key, pa] of Object.entries(input.doc.pages)) {
    const pageNo = Number(key);
    const page = pages[pageNo - 1];
    const geom = input.geoms[pageNo - 1];
    if (!page || !geom) continue;
    // Scale 1: one "screen" unit = one PDF unit, laid out as the reader sees the page.
    const vp = makeViewport(geom, 1);
    for (const u of pa.underlines) drawUnderline(page, u);
    for (const tb of pa.texts) {
      if (tb.kind === 'correction' && !input.options.includeChecks) continue;
      drawTextBox(page, font, vp, tb, input.baselineRatio);
    }
    if (input.options.includeChecks) for (const m of pa.marks) drawMark(page, vp, m);
  }
  return pdf.save();
}

/** Angle (degrees, PDF space) of the reader's left-to-right direction on this page. */
function readingAngle(vp: Viewport): number {
  const [x0, y0] = screenToPdf(vp, 0, 0);
  const [x1, y1] = screenToPdf(vp, 1, 0);
  return (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
}

function drawTextBox(page: PDFPage, font: PDFFont, vp: Viewport, tb: TextBox, baselineRatio: number): void {
  if (!tb.text.trim()) return;
  const measure = (s: string) => font.widthOfTextAtSize(s, tb.fontSize);
  const lines = boxLines(tb.text, tb.width, measure);
  const [sx, sy] = pdfToScreen(vp, tb.x, tb.y);
  const rotate = degrees(readingAngle(vp));
  const color = hexToRgb(tb.color);
  lines.forEach((line, i) => {
    if (!line) return;
    const [x, y] = screenToPdf(vp, sx, sy + baselineOffset(i, tb.fontSize, baselineRatio));
    page.drawText(line, { x, y, size: tb.fontSize, font, color, rotate });
  });
}

function drawMark(page: PDFPage, vp: Viewport, m: Mark): void {
  const [cx, cy] = pdfToScreen(vp, m.x, m.y);
  const color = hexToRgb(MARK_COLORS[m.kind]);
  const thickness = m.size * MARK_STROKE;
  for (const poly of MARK_PATHS[m.kind]) {
    const pts = poly.map(([u, v]) => screenToPdf(vp, cx + u * m.size, cy + v * m.size));
    for (let i = 1; i < pts.length; i++) {
      page.drawLine({
        start: { x: pts[i - 1][0], y: pts[i - 1][1] },
        end: { x: pts[i][0], y: pts[i][1] },
        thickness,
        color,
        lineCap: LineCapStyle.Round,
      });
    }
  }
}

function drawUnderline(page: PDFPage, u: Underline): void {
  page.drawLine({
    start: { x: u.x, y: u.y },
    end: { x: u.x + u.dx, y: u.y + u.dy },
    thickness: u.width,
    color: hexToRgb(u.color),
  });
}

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** "Book.pdf" → "Book - answers.pdf". */
export function exportFileName(pdfName: string): string {
  return `${pdfName.replace(/\.pdf$/i, '')} - answers.pdf`;
}
