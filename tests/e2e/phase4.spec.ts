import type { Page } from '@playwright/test';
import { expect, PDF_NAME, readFolderFile, SIDECAR, test } from './fixtures';

async function openBook(page: Page) {
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.locator('.pane .page[data-page="1"]:not(.loading)')).toBeVisible();
}

const top = (page: Page) => page.locator('.pane[data-pane="main"]');
const bottom = (page: Page) => page.locator('.pane[data-pane="second"]');

/** Focus a pane (like clicking it) and go to a page via the toolbar. */
async function go(page: Page, pane: 'main' | 'second', n: number) {
  await page.locator(`.pane[data-pane="${pane}"]`).focus();
  await page.locator('.page-input').fill(String(n));
  await page.locator('.page-input').press('Enter');
  await expect(page.locator(`.pane[data-pane="${pane}"] .pane-badge`)).toHaveText(`p. ${n}`);
}

async function saved(page: Page) {
  await page.locator('.pane').first().focus();
  await page.keyboard.press('Control+s');
  await expect(page.locator('.save-status')).toHaveText('Saved');
  return JSON.parse((await readFolderFile(page, SIDECAR))!);
}

test('split view, answer-key mapping and linking', async ({ app: page }) => {
  await openBook(page);
  await expect(bottom(page)).toHaveCount(0);

  // Split: two stacked panes, independent pages.
  await page.getByRole('button', { name: 'Split' }).click();
  await expect(bottom(page)).toBeVisible();
  const t = (await top(page).boundingBox())!;
  const b = (await bottom(page).boundingBox())!;
  expect(b.y).toBeGreaterThan(t.y + t.height - 1);
  await expect(bottom(page).locator('.page:not(.loading)').first()).toBeVisible();

  // Answer section start (Key… panel) and "Go" in the bottom pane.
  await page.getByRole('button', { name: 'Key…' }).click();
  const start = page.getByLabel('Answer section start page');
  await start.fill('41');
  await start.press('Enter');
  await page.locator('.answer-key').getByRole('button', { name: 'Go' }).first().click();
  await expect(bottom(page).locator('.pane-badge')).toHaveText('p. 41');
  await page.keyboard.press('Escape');
  await expect(page.locator('.answer-key')).toBeHidden();

  // Map pages 3 and 4 → 41 with the M shortcut; page 5 → 42 via the button.
  await go(page, 'main', 3);
  await page.keyboard.press('m');
  await go(page, 'main', 4);
  await page.keyboard.press('m');
  await go(page, 'second', 42);
  await go(page, 'main', 5);
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  let doc = await saved(page);
  expect(doc.answerKey.answerStartPage).toBe(41);
  expect(doc.answerKey.mapping).toEqual([
    { fromPage: 3, toPage: 4, answerPage: 41 },
    { fromPage: 5, toPage: 5, answerPage: 42 },
  ]);

  // Link on: top page changes drive the bottom pane; unmapped pages leave it alone.
  await page.getByRole('button', { name: 'Link' }).click();
  await expect(page.getByRole('button', { name: 'Link' })).toHaveClass(/active/);
  await go(page, 'main', 3);
  await expect(bottom(page).locator('.pane-badge')).toHaveText('p. 41');
  await go(page, 'main', 5);
  await expect(bottom(page).locator('.pane-badge')).toHaveText('p. 42');
  await go(page, 'second', 47);
  await go(page, 'main', 10); // unmapped
  await expect(bottom(page).locator('.pane-badge')).toHaveText('p. 47');
  await go(page, 'main', 4);
  await expect(bottom(page).locator('.pane-badge')).toHaveText('p. 41');

  // The mapping table is editable: change the answer page of row 2 to 43.
  await page.getByRole('button', { name: 'Key…' }).click();
  const answerInputs = page.locator('.answer-key').getByLabel('Answer page');
  await expect(answerInputs).toHaveCount(2);
  await answerInputs.nth(1).fill('43');
  await answerInputs.nth(1).press('Enter');
  await page.keyboard.press('Escape');
  await go(page, 'main', 5);
  await expect(bottom(page).locator('.pane-badge')).toHaveText('p. 43');

  // Both panes are interactive and share the same annotations.
  await go(page, 'second', 5);
  const bp = (await bottom(page).locator('.page[data-page="5"]').boundingBox())!;
  await page.mouse.click(bp.x + bp.width * 0.6, bp.y + 40);
  await page.keyboard.type('unten');
  await page.keyboard.press('Escape');
  await expect(top(page).locator('.page[data-page="5"] .ann-text[data-id]')).toHaveText('unten');
  await page.screenshot({ path: 'test-results/p4-split.png' });

  // Divider drag changes the ratio; orientation toggles to side-by-side.
  const div = (await page.locator('.split-divider').boundingBox())!;
  await page.mouse.move(div.x + div.width / 2, div.y + 3);
  await page.mouse.down();
  await page.mouse.move(div.x + div.width / 2, div.y - 150, { steps: 5 });
  await page.mouse.up();
  await page.getByTitle(/Stacked top\/bottom/).click();
  const t2 = (await top(page).boundingBox())!;
  const b2 = (await bottom(page).boundingBox())!;
  expect(b2.x).toBeGreaterThan(t2.x + t2.width - 1);
  await page.screenshot({ path: 'test-results/p4-vertical.png' });

  doc = await saved(page);
  expect(doc.view.split).toBe('vertical');
  expect(doc.view.splitRatio).toBeLessThan(0.45);
  expect(doc.view.secondPane.page).toBe(5);
  expect(doc.answerKey.linked).toBe(true);

  // Reload + Resume restores the split and both panes' pages.
  await page.reload();
  await page.getByRole('button', { name: `Resume “${PDF_NAME}”` }).click();
  await expect(bottom(page).locator('.pane-badge')).toHaveText('p. 5');
  await expect(page.locator('.panes')).toHaveClass(/split-vertical/);

  // Split off: back to one pane; F6 does nothing harmful.
  await page.getByRole('button', { name: 'Split' }).click();
  await expect(bottom(page)).toHaveCount(0);
  await page.keyboard.press('F6');
  await expect(top(page)).toBeVisible();
});
