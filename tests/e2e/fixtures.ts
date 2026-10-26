// Test harness: replaces the native file/folder pickers with handles from the
// browser's Origin Private File System, so the real File System Access code
// paths (read, createWritable, resolve, permissions) run without dialogs.

import { test as base, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

export const PDF_NAME = 'Sample Workbook.pdf';
export const SIDECAR = `${PDF_NAME}.annotations.json`;
const pdfBytes = readFileSync(`samples/${PDF_NAME}`);

async function installStubs(page: Page) {
  await page.route('**/__test__/sample.pdf', (route) =>
    route.fulfill({ body: pdfBytes, contentType: 'application/pdf' }),
  );
  await page.addInitScript((pdfName: string) => {
    const folder = async () => {
      const root = await navigator.storage.getDirectory();
      const drive = await root.getDirectoryHandle('GoogleDrive', { create: true });
      return drive.getDirectoryHandle('Deutsch', { create: true });
    };
    const w = window as unknown as Record<string, unknown>;
    w.__testFolder = folder;
    w.showOpenFilePicker = async () => {
      const dir = await folder();
      return [await dir.getFileHandle(pdfName)];
    };
    // Return the parent ("GoogleDrive") to exercise the "ancestor folder" path.
    w.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory();
      return root.getDirectoryHandle('GoogleDrive');
    };
  }, PDF_NAME);
}

/** Puts a fresh copy of the sample PDF (and nothing else) in the test folder. */
export async function resetFolder(page: Page) {
  await page.evaluate(async (pdfName) => {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry('GoogleDrive', { recursive: true }).catch(() => {});
    const dir = await (window as any).__testFolder();
    const bytes = await (await fetch('__test__/sample.pdf')).arrayBuffer();
    const w = await (await dir.getFileHandle(pdfName, { create: true })).createWritable();
    await w.write(bytes);
    await w.close();
  }, PDF_NAME);
}

export async function readFolderFile(page: Page, name: string): Promise<string | null> {
  return page.evaluate(async (n) => {
    const dir = await (window as any).__testFolder();
    try {
      return await (await (await dir.getFileHandle(n)).getFile()).text();
    } catch {
      return null;
    }
  }, name);
}

export async function writeFolderFile(page: Page, name: string, text: string) {
  await page.evaluate(
    async ([n, t]) => {
      const dir = await (window as any).__testFolder();
      const w = await (await dir.getFileHandle(n, { create: true })).createWritable();
      await w.write(t);
      await w.close();
    },
    [name, text],
  );
}

export const test = base.extend<{ app: Page }>({
  app: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await installStubs(page);
    await page.goto('./');
    await resetFolder(page);
    await page.reload();
    await use(page);
    expect(errors, 'no console errors').toEqual([]);
  },
});

export { expect };
