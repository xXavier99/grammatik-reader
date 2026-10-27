import { expect, readFolderFile, SIDECAR, test, writeFolderFile, PDF_NAME } from './fixtures';
import type { Page } from '@playwright/test';

async function openBook(page: Page) {
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.locator('.page-count')).toHaveText('/ 51');
}

async function firstVisibleRendered(page: Page) {
  await expect(page.locator('.pane .page:not(.loading)').first()).toBeVisible();
}

test('open, render, navigate, zoom, persist, resume', async ({ app: page }) => {
  await expect(page.getByRole('heading', { name: 'Grammatik Reader' })).toBeVisible();
  await openBook(page);
  await firstVisibleRendered(page);
  // Fit width: the page lies fully inside the pane (even though page 7 is landscape).
  await page.waitForTimeout(500);
  const pane0 = (await page.locator('.pane').boundingBox())!;
  const page1 = (await page.locator('.pane .page[data-page="1"]').boundingBox())!;
  expect(page1.x).toBeGreaterThanOrEqual(pane0.x);
  expect(page1.x + page1.width).toBeLessThanOrEqual(pane0.x + pane0.width);
  // Every mounted thumbnail eventually gets a bitmap.
  await expect
    .poll(() => page.locator('.thumb canvas').evaluateAll((cs) => cs.filter((c) => (c as HTMLCanvasElement).width === 0).length))
    .toBe(0);
  await page.screenshot({ path: 'test-results/p1-opened.png' });

  // Sidecar is created next to the PDF (in the PDF's folder, not the picked ancestor).
  await expect.poll(() => readFolderFile(page, SIDECAR)).not.toBeNull();
  const created = JSON.parse((await readFolderFile(page, SIDECAR))!);
  expect(created.version).toBe(1);
  expect(created.pdf.pageCount).toBe(51);

  // Virtualization: only a handful of page elements exist for a 51-page book.
  expect(await page.locator('.pane .page').count()).toBeLessThan(8);
  // Thumbnails render and are virtualized too.
  await expect(page.locator('.thumb canvas').first()).toBeVisible();
  expect(await page.locator('.thumb').count()).toBeLessThan(25);

  // Keyboard navigation.
  await page.locator('.pane').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('End');
  await expect(page.locator('.page-input')).toHaveValue('51');
  await page.keyboard.press('Home');
  await expect(page.locator('.page-input')).toHaveValue('1');
  await page.keyboard.press('PageDown');
  await expect(page.locator('.page-input')).toHaveValue('2');

  // Page input.
  await page.locator('.page-input').fill('20');
  await page.locator('.page-input').press('Enter');
  await expect(page.locator('.page-input')).toHaveValue('20');
  await expect(page.locator('.pane .page[data-page="20"]:not(.loading)')).toBeVisible();

  // Thumbnail click navigates.
  await page.locator('.thumbs-scroll').evaluate((e) => (e.scrollTop = 0));
  await page.locator('.thumb[data-page="3"]').click();
  await expect(page.locator('.page-input')).toHaveValue('3');

  // Zoom buttons and Ctrl+wheel.
  const zoomLabel = page.locator('.zoom-label');
  const before = await zoomLabel.textContent();
  await page.getByTitle('Zoom in (Ctrl++)').click();
  await expect(zoomLabel).not.toHaveText(before!);
  const box = (await page.locator('.pane').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  await page.waitForTimeout(400);
  const zoomed = parseInt((await zoomLabel.textContent())!, 10);
  expect(zoomed).toBeGreaterThan(parseInt(before!, 10));
  await expect(page.locator('.page-input')).toHaveValue('3');
  // Sharp rendering: canvas bitmap matches CSS size × devicePixelRatio after settling.
  await page.waitForTimeout(600);
  const sharp = await page.locator('.pane .page[data-page="3"] canvas').evaluate((c: HTMLCanvasElement) => {
    const r = c.getBoundingClientRect();
    return Math.abs(c.width - r.width * devicePixelRatio) <= 2;
  });
  expect(sharp).toBe(true);
  await page.screenshot({ path: 'test-results/p1-zoomed.png' });

  // Landscape page 7 renders with its own size.
  await page.locator('.page-input').fill('7');
  await page.locator('.page-input').press('Enter');
  const p7 = (await page.locator('.pane .page[data-page="7"]').boundingBox())!;
  const p6 = (await page.locator('.pane .page[data-page="6"]').boundingBox())!;
  expect(p7.width).toBeGreaterThan(p6.width);
  expect(p7.height).toBeLessThan(p6.height);

  // Ctrl+S saves view state immediately.
  await page.keyboard.press('Control+s');
  await expect(page.locator('.save-status')).toHaveText('Saved');
  await expect.poll(async () => JSON.parse((await readFolderFile(page, SIDECAR))!).view.lastPage).toBe(7);
  const saved = JSON.parse((await readFolderFile(page, SIDECAR))!);
  expect(saved.view.fitWidth).toBe(false);
  expect(saved.view.zoom).toBeCloseTo(zoomed / 100, 1);

  // Reload: one "Resume" click restores the book, page and zoom.
  await page.reload();
  await page.getByRole('button', { name: `Resume “${PDF_NAME}”` }).click();
  await expect(page.locator('.page-input')).toHaveValue('7');
  await expect(zoomLabel).toHaveText(`${zoomed}%`);
  await expect(page.locator('.thumb.current')).toHaveAttribute('data-page', '7');
  await page.screenshot({ path: 'test-results/p1-resumed.png' });
});

test('corrupt sidecar is backed up and reported', async ({ app: page }) => {
  await writeFolderFile(page, SIDECAR, '{ this is not json');
  await openBook(page).catch(() => {});
  await expect(page.getByRole('heading', { name: 'Annotations file could not be read' })).toBeVisible();
  await page.screenshot({ path: 'test-results/p1-corrupt.png' });
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.page-count')).toHaveText('/ 51');
  expect(await readFolderFile(page, `${SIDECAR}.bak`)).toBe('{ this is not json');
  // The damaged file is replaced by a valid one.
  await expect.poll(async () => (await readFolderFile(page, SIDECAR))?.startsWith('{\n "version": 1')).toBe(true);
});

test('changes from the other machine are picked up on focus', async ({ app: page }) => {
  await openBook(page);
  await expect.poll(() => readFolderFile(page, SIDECAR)).not.toBeNull();
  const doc = JSON.parse((await readFolderFile(page, SIDECAR))!);
  doc.settings.defaultFontSize = 15;
  await page.waitForTimeout(50); // ensure a different lastModified
  await writeFolderFile(page, SIDECAR, JSON.stringify(doc));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.toast')).toContainText('updated from your other computer');
});

test('missing PDF on resume is reported clearly', async ({ app: page }) => {
  await openBook(page);
  await page.evaluate(async (n) => {
    const dir = await (window as any).__testFolder();
    await dir.removeEntry(n);
  }, PDF_NAME);
  await page.reload();
  await page.getByRole('button', { name: `Resume “${PDF_NAME}”` }).click();
  await expect(page.getByText('is no longer in the folder')).toBeVisible();
});

test('dark theme follows the system', async ({ app: page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByRole('button', { name: 'Open PDF…' }).click();
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.locator('.pane .page:not(.loading)').first()).toBeVisible();
  const bg = await page.locator('.toolbar').evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(bg).toBe('rgb(34, 37, 43)');
  await page.screenshot({ path: 'test-results/p1-dark.png' });
});

test('jumping far with the scrollbar renders the destination, not the pages flown past', async ({ app: page }) => {
  await openBook(page);
  await firstVisibleRendered(page);
  const scroller = page.locator('.pane .pane-scroll');
  // Simulate a scrollbar drag: a few large steps, one per frame.
  for (const f of [0.2, 0.4, 0.6, 0.8]) {
    await scroller.evaluate((e, f) => (e.scrollTop = e.scrollHeight * f), f);
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  await expect(page.locator('.page-input')).toHaveValue(/^4\d$/);
  const target = await page.locator('.page-input').inputValue();
  await expect(page.locator(`.pane .page[data-page="${target}"]:not(.loading)`)).toBeVisible();
  // Pages ahead are prefetched: scrolling on shows them without waiting for a render.
  await page.waitForTimeout(1000);
  await scroller.evaluate((e) => (e.scrollTop += e.clientHeight * 2));
  const next = await page.locator('.page-input').inputValue();
  await expect(page.locator(`.pane .page[data-page="${next}"]:not(.loading)`)).toBeVisible({ timeout: 300 });
});
