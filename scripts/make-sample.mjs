// Generates samples/Sample Workbook.pdf: a workbook-like PDF with exercise
// pages (numbered gap lines) and an answer section at the back.
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { writeFileSync, mkdirSync } from 'node:fs';

const EXERCISE_PAGES = 40;
const ANSWER_PAGES = 10;
const A4 = [595.28, 841.89];

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);

const verbs = ['gehen', 'kommen', 'sehen', 'fahren', 'lesen', 'schlafen', 'essen', 'müssen', 'dürfen', 'wissen'];

function footer(page, n) {
  page.drawText(String(n), { x: page.getWidth() / 2 - 5, y: 30, size: 10, font });
}

for (let p = 1; p <= EXERCISE_PAGES; p++) {
  // Page 7 is landscape to exercise mixed page sizes.
  const size = p === 7 ? [A4[1], A4[0]] : A4;
  const page = doc.addPage(size);
  const unit = Math.ceil(p / 2);
  const top = page.getHeight() - 60;
  page.drawText(`Lektion ${unit}: Präsens – Übung ${p}`, { x: 50, y: top, size: 18, font: bold });
  page.drawText('Ergänzen Sie die richtige Form. Schreiben Sie die Lösung auf die Linie.', {
    x: 50, y: top - 28, size: 11, font,
  });
  // Two exercise blocks with ruled answer lines at 24pt spacing.
  for (let block = 0; block < 2; block++) {
    const by = top - 70 - block * 340;
    page.drawText(`${block + 1}`, { x: 50, y: by, size: 14, font: bold });
    page.drawText(`Übung ${p}.${block + 1} – Verb: ${verbs[(p + block) % verbs.length]} (ä ö ü ß)`, {
      x: 70, y: by, size: 12, font,
    });
    for (let i = 0; i < 12; i++) {
      const ly = by - 30 - i * 24;
      page.drawText(`${i + 1}.`, { x: 60, y: ly, size: 11, font });
      page.drawText(`Ich ______ heute nach Hause.`, { x: 85, y: ly, size: 11, font });
      page.drawLine({
        start: { x: 300, y: ly - 2 }, end: { x: page.getWidth() - 50, y: ly - 2 },
        thickness: 0.5, color: rgb(0.6, 0.6, 0.6),
      });
    }
  }
  footer(page, p);
}

for (let a = 1; a <= ANSWER_PAGES; a++) {
  const page = doc.addPage(A4);
  const top = page.getHeight() - 60;
  page.drawText(`Lösungen ${a}`, { x: 50, y: top, size: 18, font: bold });
  let y = top - 40;
  for (let k = 0; k < 4; k++) {
    const ex = (a - 1) * 4 + k + 1;
    if (ex > EXERCISE_PAGES) break;
    page.drawText(`Übung ${ex}.1: 1. gehe  2. kommst  3. sieht  4. fahren  5. lest  6. schlafen`, { x: 50, y, size: 10, font });
    y -= 18;
    page.drawText(`Übung ${ex}.2: 1. esse  2. musst  3. darf  4. weiß  5. wissen  6. heißt`, { x: 50, y, size: 10, font });
    y -= 30;
  }
  footer(page, EXERCISE_PAGES + a);
}

// One rotated page at the end to exercise /Rotate handling.
const rot = doc.addPage(A4);
rot.setRotation(degrees(90));
rot.drawText('Rotated page (/Rotate 90)', { x: 50, y: 780, size: 18, font: bold });
footer(rot, EXERCISE_PAGES + ANSWER_PAGES + 1);

mkdirSync('samples', { recursive: true });
writeFileSync('samples/Sample Workbook.pdf', await doc.save());
console.log(`Wrote samples/Sample Workbook.pdf (${doc.getPageCount()} pages)`);
