import type { Page } from '@playwright/test';
import { expect, readFolderFile, SIDECAR, test } from './fixtures';

// Sample page geometry (scripts/make-sample.mjs): A4; the first exercise's
// printed answer lines are at y = 679.89 - 24·i, i.e. rows are 24 pt apart.
const PAGE_H = 841.89;
const PAGE_W = 595.28;
const LH = 11 * 1.25; // one text line at 11 pt
const line = (i: number) => 679.89 - 24 * i;
/** Where you would put the top of the text written on line i. */
const textTop = (i: number) => line(i) + LH;

async function openBook(page: Page) {
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.locator('.pane .page[data-page="1"]:not(.loading)')).toBeVisible();
}

/** Screen point for a PDF point on page 1. */
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

async function drawArea(page: Page, firstLine: number, lastLine: number) {
  await page.locator('.pane').focus();
  await page.keyboard.press('a');
  await drag(page, await screen(page, 300, textTop(firstLine)), await screen(page, 545, line(lastLine)));
}

async function saved(page: Page) {
  await page.keyboard.press('Control+s');
  await expect(page.locator('.save-status')).toHaveText('Saved');
  return JSON.parse((await readFolderFile(page, SIDECAR))!);
}

async function setLines(page: Page, n: number) {
  await page.locator('.lines-input').fill(String(n));
  await page.locator('.lines-input').press('Enter');
}

test('drawing an area goes straight to typing; Enter follows the printed rows', async ({ app: page }) => {
  await openBook(page);
  await setLines(page, 2);
  await drawArea(page, 0, 1);

  // Released: Text mode, typing in row 1 of the new area.
  await expect(page.getByRole('button', { name: 'Text' })).toHaveClass(/active/);
  await expect(page.locator('.ann-editor')).toBeFocused();
  await page.keyboard.type('gehe');
  await page.keyboard.press('Enter');
  await page.keyboard.type('kommst');
  await page.keyboard.press('Enter');
  await page.keyboard.type('sieht'); // continues below the area, same spacing
  await page.keyboard.press('Escape');

  // Second block (no area): click on line 5 and Enter → line 6.
  const q = await screen(page, 320, line(4) + 6);
  await page.mouse.click(q.x, q.y);
  await page.keyboard.type('fahren');
  await page.keyboard.press('Enter');
  await page.keyboard.type('lest und noch ein sehr langer Satz, der weit über den Rand hinausgeht');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'test-results/p3-rows.png' });

  const doc = await saved(page);
  const area = doc.pages['1'].areas[0];
  expect(area.lines).toBe(2);
  expect(area.fontSize).toBe(11);
  expect(area.height).toBeCloseTo(LH + 24, 0);
  expect(doc.settings.lineSpacing).toBeCloseTo(24, 0);

  const texts = doc.pages['1'].texts as { text: string; y: number; x: number; areaId?: string; lineIndex?: number; width: number | null }[];
  expect(texts.map((t) => t.text.split(' ')[0])).toEqual(['gehe', 'kommst', 'sieht', 'fahren', 'lest']);
  // Row 1 starts at the area's top edge and its text sits on the printed line.
  expect(texts[0].y).toBeCloseTo(area.y, 1);
  expect(texts[0].x).toBeCloseTo(area.x + 2, 1);
  expect(texts[0].y - LH).toBeCloseTo(line(0), 0);
  expect(texts[1].y - LH).toBeCloseTo(line(1), 0);
  expect(texts[2].y - LH).toBeCloseTo(line(2), 0);
  expect(texts[0].areaId).toBe(area.id);
  expect(texts[1].lineIndex).toBe(1);
  expect(texts[2].areaId).toBeUndefined();
  // Outside the area: Enter moves exactly the remembered spacing; no wrapping.
  expect(texts[3].y - texts[4].y).toBeCloseTo(24, 1);
  expect(texts[3].x).toBe(texts[4].x);
  expect(texts[4].width).toBeNull();
  const boxes = page.locator('.ann-text[data-id]');
  expect((await boxes.nth(4).boundingBox())!.height).toBeCloseTo((await boxes.nth(0).boundingBox())!.height, 0);

  // Clicking inside the area snaps to the row's line (here: row 2).
  await page.keyboard.press('Control+z'); // undo "lest…" (one step)
  await page.keyboard.press('Control+z'); // undo "fahren"
  await page.keyboard.press('Control+z'); // undo "sieht"
  await page.keyboard.press('Control+z'); // undo "kommst"
  const r = await screen(page, 420, line(1) + 4);
  await page.mouse.click(r.x, r.y);
  await page.keyboard.type('X');
  await page.keyboard.press('Escape');
  const t2 = (await saved(page)).pages['1'].texts;
  expect(t2).toHaveLength(2);
  expect(t2[1].lineIndex).toBe(1);
  expect(t2[1].y - LH).toBeCloseTo(line(1), 0);

  // ↑ / ↓ move between existing rows.
  await page.locator('.ann-text[data-id]').nth(1).click();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.ann-editor')).toHaveValue('gehe');
  await page.keyboard.press('Escape');
});

test('lines input, resize, Tab between areas, delete + undo', async ({ app: page }) => {
  await openBook(page);
  await setLines(page, 2);
  await drawArea(page, 0, 1);
  await page.keyboard.press('Escape'); // leave the (empty) first-row box
  await drawArea(page, 6, 9);
  await page.keyboard.press('Escape');
  await expect(page.locator('.ann-area')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/p3-area.png' });

  // Select the second area in Area mode and give it 3 lines: rows are re-split.
  await page.keyboard.press('a');
  await page.locator('.ann-area').nth(1).click({ position: { x: 30, y: 30 } });
  await setLines(page, 3);
  await expect(page.locator('.ann-area.selected .ann-area-label')).toHaveText('3 lines');
  let doc = await saved(page);
  expect(doc.pages['1'].areas[1].lines).toBe(3);
  expect(doc.settings.lineSpacing).toBeCloseTo(36, 0); // (13.75 + 72 − 13.75) / 2
  expect(doc.settings.areaLines).toBe(3);

  // Resize the first area 12 pt taller from its bottom handle: spacing 36.
  const first = page.locator('.ann-area').first();
  await first.click({ position: { x: 30, y: 5 } });
  const sHandle = (await first.locator('.h-s').boundingBox())!;
  const s1 = await screen(page, 0, line(1));
  const s2 = await screen(page, 0, line(1) - 12);
  await drag(page, { x: sHandle.x + 5, y: sHandle.y + 5 }, { x: sHandle.x + 5, y: sHandle.y + 5 + (s2.y - s1.y) });
  doc = await saved(page);
  expect(doc.pages['1'].areas[0].height).toBeCloseTo(LH + 36, 0);
  expect(doc.settings.lineSpacing).toBeCloseTo(36, 0);

  // Tab from the first area jumps into row 1 of the next one.
  await page.keyboard.press('t');
  const p = await screen(page, 320, textTop(0) - 4);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.type('eins');
  await page.keyboard.press('Tab');
  await page.keyboard.type('zwei');
  await page.keyboard.press('Escape');
  doc = await saved(page);
  const texts = doc.pages['1'].texts;
  expect(texts.map((t: { text: string }) => t.text)).toEqual(['eins', 'zwei']);
  expect(texts[1].areaId).toBe(doc.pages['1'].areas[1].id);
  expect(texts[1].lineIndex).toBe(0);

  // Delete the selected area in Area mode; undo brings it back.
  await page.keyboard.press('a');
  await page.locator('.ann-area').nth(1).click({ position: { x: 30, y: 30 } });
  await page.keyboard.press('Delete');
  await expect(page.locator('.ann-area')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.ann-area')).toHaveCount(2);
});
