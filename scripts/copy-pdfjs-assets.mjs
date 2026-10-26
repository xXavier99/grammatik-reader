// Copies pdf.js character maps and standard fonts into public/ so they are
// served locally (no CDN). Needed for PDFs with non-embedded fonts.
import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('public/pdfjs', { recursive: true });
for (const dir of ['cmaps', 'standard_fonts']) {
  cpSync(`node_modules/pdfjs-dist/${dir}`, `public/pdfjs/${dir}`, { recursive: true });
}
