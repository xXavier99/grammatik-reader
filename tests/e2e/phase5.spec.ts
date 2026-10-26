import type { Page } from '@playwright/test';
import { expect, readFolderFile, SIDECAR, test } from './fixtures';

const PAGE_H = 841.89;
const PAGE_W = 595.28;
const line = (i: number) => 679.89 - 24 * i;

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

async function saved(page: Page) {
  await page.locator('.pane').first().focus();
  await page.keyboard.press('Control+s');
  await expect(page.locator('.save-status')).toHaveText('Saved');
  return JSON.parse((await readFolderFile(page, SIDECAR))!);
}

const marks = (page: Page) => page.locator('.pane .page[data-page="1"] .ann-mark');
const answers = (page: Page) => page.locator('.pane .page[data-page="1"] .ann-text[data-id]:not(.correction)');
const corrections = (page: Page) => page.locator('.pane .page[data-page="1"] .ann-text.correction');

test('check mode: ✓ next to answers, ✗ with corrections, move, remove, undo', async ({ app: page }) => {
  await openBook(page);
  await page.evaluate(() => {
    (window as any).__blockedMenus = 0;
    window.addEventListener('contextmenu', (e) => e.defaultPrevented && (window as any).__blockedMenus++);
  });

  // Two answers on printed lines 1 and 2.
  for (const [i, word] of [[0, 'gehe'], [1, 'kommst']] as const) {
    const p = await screen(page, 320, line(i) + 6);
    await page.mouse.click(p.x, p.y);
    await page.keyboard.type(word);
    await page.keyboard.press('Escape');
  }
  await expect(answers(page)).toHaveCount(2);

  await page.keyboard.press('c');
  await expect(page.getByRole('button', { name: 'Check' })).toHaveClass(/active/);

  // Left click on the answer → ✓ right of it, vertically on its line.
  await answers(page).nth(0).click();
  await expect(marks(page)).toHaveCount(1);
  const a0 = (await answers(page).nth(0).boundingBox())!;
  const m0 = (await marks(page).nth(0).boundingBox())!;
  expect(m0.x).toBeGreaterThan(a0.x + a0.width);
  expect(Math.abs(m0.y + m0.height / 2 - (a0.y + a0.height / 2))).toBeLessThan(4);
  // Clicking it again toggles it off; once more puts it back.
  await answers(page).nth(0).click();
  await expect(marks(page)).toHaveCount(0);
  await answers(page).nth(0).click();
  await expect(marks(page)).toHaveCount(1);

  // A click a little to the right of answer 2 ("next to" it) also checks answer 2.
  const a1 = (await answers(page).nth(1).boundingBox())!;
  await page.mouse.click(a1.x + a1.width + 20, a1.y + a1.height / 2);
  await expect(marks(page)).toHaveCount(2);

  // Right click on empty space: ✗ + correction editor, no browser menu.
  const r = await screen(page, 320, line(3) + 6);
  await page.mouse.click(r.x, r.y, { button: 'right' });
  await expect(page.locator('.ann-mark.cross')).toHaveCount(1);
  await expect(page.locator('.ann-editor')).toBeFocused();
  await page.keyboard.type('kommt');
  await page.keyboard.press('Enter');
  await expect(corrections(page)).toHaveText('kommt');
  expect(await page.evaluate(() => (window as any).__blockedMenus)).toBeGreaterThan(0);
  const cm = (await page.locator('.ann-mark.cross').boundingBox())!;
  const cc = (await corrections(page).boundingBox())!;
  expect(cc.x).toBeGreaterThan(cm.x + cm.width / 2);
  await page.screenshot({ path: 'test-results/p5-check.png' });

  // ✗ + correction is one undo step; redo brings both back.
  await page.keyboard.press('Control+z');
  await expect(page.locator('.ann-mark.cross')).toHaveCount(0);
  await expect(corrections(page)).toHaveCount(0);
  await page.keyboard.press('Control+y');
  await expect(page.locator('.ann-mark.cross')).toHaveCount(1);
  await expect(corrections(page)).toHaveText('kommt');

  // Right click a ✓ → it becomes ✗ and asks for the correction.
  const check1 = page.locator('.ann-mark.check').nth(1);
  await check1.click({ button: 'right' });
  await expect(page.locator('.ann-mark.cross')).toHaveCount(2);
  await page.keyboard.type('kommen');
  await page.keyboard.press('Escape');
  await expect(corrections(page)).toHaveCount(2);

  // Dragging a ✗ moves its correction along.
  const cross = page.locator('.ann-mark.cross').first();
  const before = (await cross.boundingBox())!;
  const corrBefore = (await corrections(page).first().boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 30, before.y + before.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  const after = (await cross.boundingBox())!;
  const corrAfter = (await corrections(page).first().boundingBox())!;
  expect(after.x - before.x).toBeCloseTo(30, 0);
  expect(corrAfter.y - corrBefore.y).toBeCloseTo(40, 0);

  // Clicking a mark (no drag) removes it with its correction; undo restores both.
  await page.locator('.ann-mark.cross').first().click();
  await expect(page.locator('.ann-mark.cross')).toHaveCount(1);
  await expect(corrections(page)).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.ann-mark.cross')).toHaveCount(2);
  await expect(corrections(page)).toHaveCount(2);

  // A ✗ whose correction is left empty keeps the ✗ but no empty box.
  const r2 = await screen(page, 450, line(6) + 6);
  await page.mouse.click(r2.x, r2.y, { button: 'right' });
  await page.keyboard.press('Escape');
  await expect(page.locator('.ann-mark.cross')).toHaveCount(3);
  await expect(corrections(page)).toHaveCount(2);

  // Clicking a correction edits it (not a new mark).
  await corrections(page).first().click();
  await expect(page.locator('.ann-editor')).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await page.keyboard.press('Enter');

  // Persisted: marks and corrections linked to their ✗.
  const doc = await saved(page);
  const pg = doc.pages['1'];
  expect(pg.marks.filter((m: { kind: string }) => m.kind === 'check')).toHaveLength(1);
  expect(pg.marks.filter((m: { kind: string }) => m.kind === 'cross')).toHaveLength(3);
  const corr = pg.texts.filter((t: { kind: string }) => t.kind === 'correction');
  const texts = corr.map((t: { text: string }) => t.text.replace('!', '')).sort();
  expect(texts).toEqual(['kommen', 'kommt']);
  expect(corr.filter((t: { text: string }) => t.text.endsWith('!'))).toHaveLength(1);
  for (const c of corr) {
    expect(pg.marks.some((m: { id: string }) => m.id === c.markId)).toBe(true);
    expect(c.color).toBe('#d11a2a');
  }
});

test('check mode colour picker sets the correction colour', async ({ app: page }) => {
  await openBook(page);
  await page.keyboard.press('c');
  await page.locator('.color-input').evaluate((i: HTMLInputElement) => {
    i.value = '#0055ff';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const r = await screen(page, 320, line(2));
  await page.mouse.click(r.x, r.y, { button: 'right' });
  await page.keyboard.type('blau');
  await page.keyboard.press('Enter');
  const doc = await saved(page);
  expect(doc.settings.correctionColor).toBe('#0055ff');
  expect(doc.settings.defaultColor).toBe('#1a4fd6');
  expect(doc.pages['1'].texts[0].color).toBe('#0055ff');
});
