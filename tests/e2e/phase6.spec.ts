import type { Page } from '@playwright/test';
import { expect, PDF_NAME, readFolderBytes, readFolderFile, SIDECAR, test } from './fixtures';

const PAGE_H = 841.89;
const PAGE_W = 595.28;
const LH = 11 * 1.25;
const line = (i: number) => 679.89 - 24 * i;
const EXPORTED = 'Sample Workbook - answers.pdf';

async function openBook(page: Page) {
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.locator('.pane .page[data-page="1"]:not(.loading)')).toBeVisible();
}

async function screen(page: Page, x: number, y: number) {
  const b = (await page.locator('.pane .page[data-page="1"]').boundingBox())!;
  const s = b.width / PAGE_W;
  return { x: b.x + x * s, y: b.y + (PAGE_H - y) * s };
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

async function exportPdf(page: Page, includeChecks: boolean) {
  // Clear toasts from earlier exports so we wait for this export's own toast.
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const box = page.getByLabel('Include ✓ / ✗ marks and corrections');
  if ((await box.isChecked()) !== includeChecks) await box.click();
  await page.getByRole('button', { name: 'Export…' }).click();
  await expect(page.locator('.toast').filter({ hasText: 'Exported' }).last()).toBeVisible();
}

async function textItems(bytes: Uint8Array, pageNo: number) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
  const content = await (await doc.getPage(pageNo)).getTextContent();
  const items = (content.items as { str: string; transform: number[] }[]).map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5] }));
  await doc.destroy();
  return items;
}

test('export bakes answers, marks and corrections at the on-screen positions', async ({ app: page }) => {
  await openBook(page);

  // Answers in an area, a free two-line answer, and check marks with a correction.
  await page.locator('.lines-input').fill('2');
  await page.locator('.lines-input').press('Enter');
  await page.locator('.pane').focus();
  await page.keyboard.press('a');
  await drag(page, await screen(page, 300, line(0) + LH), await screen(page, 545, line(1)));
  await page.keyboard.type('gehe');
  await page.keyboard.press('Enter');
  await page.keyboard.type('kommst');
  await page.keyboard.press('Escape');
  const f = await screen(page, 320, line(4) + 6);
  await page.mouse.click(f.x, f.y);
  await page.keyboard.type('Straße');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('Grüße');
  await page.keyboard.press('Escape');
  await page.keyboard.press('c');
  await page.locator('.ann-text[data-id]').nth(0).click();
  const kommst = (await page.locator('.ann-text[data-id]').nth(1).boundingBox())!;
  await page.mouse.click(kommst.x + kommst.width + 20, kommst.y + kommst.height / 2, { button: 'right' });
  await page.keyboard.type('kommt');
  await page.keyboard.press('Enter');
  await page.keyboard.press('t');

  // Screenshot of the annotated region as shown in the app (for visual comparison).
  const p0 = await screen(page, 290, line(0) + 40);
  const p1 = await screen(page, 560, line(6));
  const clip = { x: p0.x, y: p0.y, width: p1.x - p0.x, height: p1.y - p0.y };
  await page.screenshot({ path: 'test-results/p6-screen.png', clip });

  // Export (default name, includes marks).
  await exportPdf(page, true);
  expect(await page.evaluate(() => (window as any).__savedAs)).toBe(EXPORTED);
  const bytes = await readFolderBytes(page, EXPORTED);

  // Original PDF untouched (byte length unchanged, still opens), sidecar separate.
  expect((await readFolderBytes(page, PDF_NAME)).length).toBe(76338);
  await page.keyboard.press('Control+s');
  const doc = JSON.parse((await readFolderFile(page, SIDECAR))!);
  const texts = doc.pages['1'].texts as { text: string; x: number; y: number; fontSize: number }[];

  const items = await textItems(bytes, 1);
  const ratio = await page.evaluate(() => {
    // Same measurement the exporter uses.
    const probe = document.createElement('span');
    probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    const host = document.createElement('div');
    host.style.cssText = "position:absolute;visibility:hidden;white-space:pre;font-family:'Annot Noto Sans';font-size:100px;line-height:1.25";
    host.append('Hg', probe);
    document.body.appendChild(host);
    const r = probe.offsetTop / 100;
    host.remove();
    return r;
  });
  expect(ratio).toBeGreaterThan(0.9);
  expect(ratio).toBeLessThan(1.15);
  for (const [str, tb, lineNo] of [
    ['gehe', texts[0], 0], ['kommst', texts[1], 0], ['Straße', texts[2], 0], ['Grüße', texts[2], 1], ['kommt', texts[3], 0],
  ] as const) {
    const it = items.find((i) => i.str === str);
    expect(it, str).toBeDefined();
    expect(it!.x).toBeCloseTo(tb.x, 1);
    expect(it!.y).toBeCloseTo(tb.y - (lineNo * 1.25 + ratio) * tb.fontSize, 1);
  }
  // Text sits on the printed line like on screen (baseline a little above it).
  const gehe = items.find((i) => i.str === 'gehe')!;
  expect(gehe.y - line(0)).toBeGreaterThan(0);
  expect(gehe.y - line(0)).toBeLessThan(4);

  // Without marks: no correction text.
  await exportPdf(page, false);
  const plain = await textItems(await readFolderBytes(page, EXPORTED), 1);
  expect(plain.some((i) => i.str === 'kommt')).toBe(false);
  expect(plain.some((i) => i.str === 'gehe')).toBe(true);

  // Re-export with marks and open the exported PDF in the app to compare visually.
  await exportPdf(page, true);
  await page.evaluate((n) => ((window as any).__openName = n), EXPORTED);
  await page.getByRole('button', { name: 'Open…' }).click();
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.locator('.file-name')).toHaveText(EXPORTED);
  await expect(page.locator('.pane .page[data-page="1"]:not(.loading)')).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/p6-exported.png', clip });
});
