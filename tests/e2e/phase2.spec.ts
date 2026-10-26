import type { Page } from '@playwright/test';
import { expect, PDF_NAME, readFolderFile, SIDECAR, test } from './fixtures';

async function openBook(page: Page) {
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.locator('.pane .page[data-page="1"]:not(.loading)')).toBeVisible();
}

/** Clicks page 1 at fractional position (fx, fy). */
async function clickPage(page: Page, fx: number, fy: number, opts: { modifiers?: ('Alt' | 'Shift')[] } = {}) {
  const b = (await page.locator('.pane .page[data-page="1"]').boundingBox())!;
  await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy, opts);
}

async function savedTexts(page: Page) {
  await page.locator('.pane').focus();
  await page.keyboard.press('Control+s');
  await expect(page.locator('.save-status')).toHaveText('Saved');
  const doc = JSON.parse((await readFolderFile(page, SIDECAR))!);
  return (doc.pages['1']?.texts ?? []) as { id: string; text: string; x: number; y: number; width: number | null; fontSize: number; color: string }[];
}

const boxes = (page: Page) => page.locator('.pane .page[data-page="1"] .ann-text[data-id]');

test('click to type, edit, multi-line, discard empty, persist', async ({ app: page }) => {
  await openBook(page);

  // Click creates a focused box: typing goes straight in (with German characters).
  await clickPage(page, 0.55, 0.2);
  await expect(page.locator('.ann-editor')).toBeFocused();
  await page.keyboard.type('gehe müssen Straße');
  // Click elsewhere: finishes the box and starts a new one there.
  await clickPage(page, 0.55, 0.3);
  await expect(page.locator('.ann-editor')).toBeFocused();
  // Shift+Enter = newline inside the box.
  await page.keyboard.type('Zeile 1');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('Zeile 2');
  await page.keyboard.press('Escape');
  await expect(page.locator('.ann-editor')).toHaveCount(0);
  await expect(boxes(page)).toHaveCount(2);
  await expect(boxes(page).nth(1)).toHaveText('Zeile 1\nZeile 2');
  const twoLines = (await boxes(page).nth(1).boundingBox())!;
  const oneLine = (await boxes(page).nth(0).boundingBox())!;
  expect(twoLines.height).toBeGreaterThan(oneLine.height * 1.8);

  // Clicking empty space with an empty box focused only removes that box.
  await clickPage(page, 0.3, 0.4);
  await expect(page.locator('.ann-editor')).toBeFocused();
  await clickPage(page, 0.3, 0.45);
  await expect(page.locator('.ann-editor')).toHaveCount(0);
  await expect(boxes(page)).toHaveCount(2);

  // The new box's first line is centred on the click point.
  const b = (await page.locator('.pane .page[data-page="1"]').boundingBox())!;
  const clickY = b.y + b.height * 0.2;
  expect(Math.abs(oneLine.y + oneLine.height / 2 - clickY)).toBeLessThan(3);

  // Autosave writes the JSON within ~1 s, in PDF units with defaults applied.
  await expect.poll(async () => JSON.parse((await readFolderFile(page, SIDECAR)) ?? '{}').pages?.['1']?.texts?.length, { timeout: 4000 }).toBe(2);
  let texts = await savedTexts(page);
  expect(texts.map((t) => t.text)).toEqual(['gehe müssen Straße', 'Zeile 1\nZeile 2']);
  expect(texts[0].fontSize).toBe(11);
  expect(texts[0].color).toBe('#1a4fd6');
  expect(texts[0].x).toBeGreaterThan(300);
  expect(texts[0].x).toBeLessThan(350);
  await page.screenshot({ path: 'test-results/p2-typed.png' });

  // Click into an existing box to edit it (caret at the click), then append.
  await boxes(page).nth(0).click({ position: { x: 3, y: 5 } });
  await expect(page.locator('.ann-editor')).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await page.keyboard.press('Escape');
  await expect(boxes(page).nth(0)).toHaveText('gehe müssen Straße!');

  // Reload + Resume: everything comes back.
  texts = await savedTexts(page);
  await page.reload();
  await page.getByRole('button', { name: `Resume “${PDF_NAME}”` }).click();
  await expect(boxes(page)).toHaveCount(2);
  await expect(boxes(page).nth(0)).toHaveText('gehe müssen Straße!');
});

test('undo / redo, delete, move, resize, style, zoom', async ({ app: page }) => {
  await openBook(page);
  await clickPage(page, 0.55, 0.2);
  await page.keyboard.type('kommst');
  await page.keyboard.press('Escape');
  await clickPage(page, 0.55, 0.25);
  await page.keyboard.type('sieht');
  await page.keyboard.press('Escape');
  await expect(boxes(page)).toHaveCount(2);

  // Undo removes the whole second box (creation + typing = one step); redo restores it.
  await page.keyboard.press('Control+z');
  await expect(boxes(page)).toHaveCount(1);
  await page.keyboard.press('Control+y');
  await expect(boxes(page)).toHaveCount(2);
  await page.getByTitle('Undo (Ctrl+Z)').click();
  await expect(boxes(page)).toHaveCount(1);
  await page.getByTitle('Redo (Ctrl+Y)').click();
  await expect(boxes(page)).toHaveCount(2);

  // Select (Esc after editing keeps it selected) + Delete, then undo.
  await boxes(page).nth(1).click();
  await page.keyboard.press('Escape');
  await expect(boxes(page).nth(1)).toHaveClass(/selected/);
  await page.keyboard.press('Delete');
  await expect(boxes(page)).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(boxes(page)).toHaveCount(2);

  // Alt+drag moves the box; one undo step puts it back.
  const first = boxes(page).nth(0);
  const before = (await first.boundingBox())!;
  await page.keyboard.down('Alt');
  await page.mouse.move(before.x + 5, before.y + 5);
  await page.mouse.down();
  await page.mouse.move(before.x + 60, before.y + 45, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  const after = (await first.boundingBox())!;
  expect(after.x - before.x).toBeCloseTo(55, 0);
  expect(after.y - before.y).toBeCloseTo(40, 0);
  await page.keyboard.press('Control+z');
  const back = (await first.boundingBox())!;
  expect(back.x).toBeCloseTo(before.x, 0);

  // Drag the grip to move too.
  await first.hover();
  const grip = (await first.locator('.ann-grip').boundingBox())!;
  await page.mouse.move(grip.x + 4, grip.y + 4);
  await page.mouse.down();
  await page.mouse.move(grip.x + 4, grip.y + 104, { steps: 5 });
  await page.mouse.up();
  expect((await first.boundingBox())!.y - before.y).toBeCloseTo(100, 0);

  // Resize handle gives the box a fixed width that wraps text.
  await expect(first).toHaveClass(/selected/);
  const handle = (await first.locator('.ann-resize').boundingBox())!;
  await page.mouse.move(handle.x + 3, handle.y + 7);
  await page.mouse.down();
  await page.mouse.move(handle.x - 20, handle.y + 7, { steps: 4 });
  await page.mouse.up();
  await expect(first).toHaveClass(/fixed-width/);

  // Toolbar font size applies to the selected box.
  await page.locator('.size-input').fill('20');
  await page.locator('.size-input').press('Enter');
  let texts = await savedTexts(page);
  expect(texts[0].fontSize).toBe(20);
  expect(texts[0].width).not.toBeNull();
  expect(texts[1].fontSize).toBe(11);

  // The size chosen for the selected box also becomes the default for new boxes.
  await page.locator('.pane').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('.size-input')).toHaveValue('20');
  // With nothing selected, the toolbar just sets the default.
  await page.locator('.size-input').fill('14');
  await page.locator('.size-input').press('Enter');
  await clickPage(page, 0.2, 0.45);
  await page.keyboard.type('neu');
  await page.keyboard.press('Escape');
  texts = await savedTexts(page);
  expect(texts[2].fontSize).toBe(14);

  // Zoom: boxes keep their position relative to the page (stored in PDF units).
  const pageEl = page.locator('.pane .page[data-page="1"]');
  const rel = async () => {
    const p = (await pageEl.boundingBox())!;
    const t = (await boxes(page).nth(1).boundingBox())!;
    return [(t.x - p.x) / p.width, (t.y - p.y) / p.height, t.height / p.height];
  };
  const r1 = await rel();
  await page.getByTitle('Zoom in (Ctrl++)').click();
  await page.getByTitle('Zoom in (Ctrl++)').click();
  await page.locator('.page-input').fill('1');
  await page.locator('.page-input').press('Enter');
  const r2 = await rel();
  for (let i = 0; i < 3; i++) expect(r2[i]).toBeCloseTo(r1[i], 2);
  await page.screenshot({ path: 'test-results/p2-zoomed.png' });
});
