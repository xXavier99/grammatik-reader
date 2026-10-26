import type { Page } from '@playwright/test';
import { expect, readFolderFile, SIDECAR, test } from './fixtures';

async function openBook(page: Page) {
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.locator('.pane .page[data-page="1"]:not(.loading)')).toBeVisible();
}

/** Clicks page 1 at fractional position (fx, fy). */
async function clickPage(page: Page, fx: number, fy: number, opts: { modifiers?: ('Shift')[] } = {}) {
  const b = (await page.locator('.pane .page[data-page="1"]').boundingBox())!;
  await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy, opts);
}

async function dragPage(page: Page, from: [number, number], to: [number, number]) {
  const b = (await page.locator('.pane .page[data-page="1"]').boundingBox())!;
  await page.mouse.move(b.x + b.width * from[0], b.y + b.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * to[0], b.y + b.height * to[1], { steps: 8 });
  await page.mouse.up();
}

async function saved(page: Page) {
  await page.locator('.pane').focus();
  await page.keyboard.press('Control+s');
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const doc = JSON.parse((await readFolderFile(page, SIDECAR))!);
  return doc.pages['1'] as {
    texts: { id: string; text: string; x: number; y: number; blankId?: string }[];
    blanks: { id: string; x: number; y: number }[];
  };
}

const p1 = '.pane .page[data-page="1"]';
const boxes = (page: Page) => page.locator(`${p1} .ann-text[data-id]`);
const visibleBlanks = (page: Page) => page.locator(`${p1} .ann-blank:not(.filled)`);

test('blanks: place in order, Tab through them, magnet click', async ({ app: page }) => {
  await openBook(page);

  // Blanks mode: three blanks, out of reading order on purpose.
  await page.keyboard.press('b');
  await clickPage(page, 0.6, 0.2);
  await clickPage(page, 0.2, 0.2);
  await clickPage(page, 0.4, 0.3);
  await expect(visibleBlanks(page)).toHaveText(['1', '2', '3']);

  // Enter starts typing in blank 1; Tab follows the click order.
  await page.keyboard.press('Enter');
  await expect(page.locator('.ann-editor')).toBeFocused();
  await page.keyboard.type('eins');
  await page.keyboard.press('Tab');
  await page.keyboard.type('zwei');
  await page.keyboard.press('Tab');
  await page.keyboard.type('drei');
  // Past the last blank, Tab stays put.
  await page.keyboard.press('Tab');
  await page.keyboard.type('!');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.type('2');
  await page.keyboard.press('Escape');
  await expect(visibleBlanks(page)).toHaveCount(0);

  let pg = await saved(page);
  expect(pg.blanks).toHaveLength(3);
  const byBlank = (i: number) => pg.texts.find((t) => t.blankId === pg.blanks[i].id);
  expect(byBlank(0)?.text).toBe('eins');
  expect(byBlank(1)?.text).toBe('zwei2');
  expect(byBlank(2)?.text).toBe('drei!');
  // Text starts exactly at the blank.
  expect(byBlank(0)!.x).toBeCloseTo(pg.blanks[0].x, 1);

  // Text mode: a click slightly off an empty blank lands in it.
  await page.keyboard.press('b');
  await clickPage(page, 0.75, 0.3);
  await page.keyboard.press('t');
  const blank4 = (await visibleBlanks(page).first().boundingBox())!;
  await page.mouse.click(blank4.x - 8, blank4.y + blank4.height + 6);
  await page.keyboard.type('vier');
  await page.keyboard.press('Escape');
  pg = await saved(page);
  const vier = pg.texts.find((t) => t.text === 'vier')!;
  expect(vier.blankId).toBe(pg.blanks[3].id);
  expect(vier.x).toBeCloseTo(pg.blanks[3].x, 1);

  // Blanks mode: select and delete a blank; the text typed into it stays.
  await page.keyboard.press('b');
  await page.locator(`${p1} .ann-blank`).nth(3).click();
  await page.keyboard.press('Delete');
  pg = await saved(page);
  expect(pg.blanks).toHaveLength(3);
  expect(pg.texts.find((t) => t.text === 'vier')?.blankId).toBeUndefined();
});

test('select mode: rectangle select, move, delete, undo', async ({ app: page }) => {
  await openBook(page);
  for (const [fy, text] of [[0.2, 'eins'], [0.25, 'zwei'], [0.5, 'drei']] as const) {
    await clickPage(page, 0.3, fy);
    await page.keyboard.type(text);
    await page.keyboard.press('Escape');
  }
  await expect(boxes(page)).toHaveCount(3);

  await page.keyboard.press('v');
  // Rectangle over the first two boxes.
  await dragPage(page, [0.25, 0.17], [0.5, 0.28]);
  await expect(page.locator(`${p1} .ann-text.selected`)).toHaveText(['eins', 'zwei']);

  // Dragging one moves both.
  const before = await saved(page);
  const first = (await page.locator(`${p1} .ann-text.selected`).first().boundingBox())!;
  await page.mouse.move(first.x + 4, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + 64, first.y + first.height / 2, { steps: 6 });
  await page.mouse.up();
  const after = await saved(page);
  for (const name of ['eins', 'zwei']) {
    const dx = after.texts.find((t) => t.text === name)!.x - before.texts.find((t) => t.text === name)!.x;
    expect(dx).toBeGreaterThan(10);
  }
  expect(after.texts.find((t) => t.text === 'drei')!.x).toBe(before.texts.find((t) => t.text === 'drei')!.x);

  // Shift+click adds the third; Delete removes all; one undo brings them back.
  await page.locator(`${p1} .ann-text[data-id]`, { hasText: 'drei' }).click({ modifiers: ['Shift'] });
  await expect(page.locator(`${p1} .ann-text.selected`)).toHaveCount(3);
  await page.keyboard.press('Delete');
  await expect(boxes(page)).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(boxes(page)).toHaveCount(3);

  // Click selects just one; Enter edits it in Text mode.
  await page.locator(`${p1} .ann-text[data-id]`, { hasText: 'drei' }).click();
  await expect(page.locator(`${p1} .ann-text.selected`)).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.locator('.ann-editor')).toBeFocused();
  await page.keyboard.type('?');
  await page.keyboard.press('Escape');
  await expect(boxes(page).filter({ hasText: 'drei?' })).toHaveCount(1);
});
