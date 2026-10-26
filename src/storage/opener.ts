// Picking a PDF plus write access to its folder, and resuming the last book.

import { showDialog } from '../ui/dialogs';
import { ensureFolderPermission, getRecentBook, setRecentBook, type RecentBook } from './handles';
import { isNotFound } from './sidecar';

export class OpenError extends Error {}

export function fsAccessSupported(): boolean {
  return typeof window.showOpenFilePicker === 'function' && typeof window.showDirectoryPicker === 'function';
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

/**
 * Lets the user choose a PDF, then the folder containing it (needed to create
 * the sidecar next to it). Returns null if the user cancelled.
 */
export async function pickBook(): Promise<RecentBook | null> {
  let fileHandle: FileSystemFileHandle;
  try {
    [fileHandle] = await window.showOpenFilePicker({
      id: 'grammatik-pdf',
      types: [{ description: 'PDF documents', accept: { 'application/pdf': ['.pdf'] } }],
      excludeAcceptAllOption: true,
    });
  } catch (e) {
    if (isAbort(e)) return null;
    throw e;
  }

  const go = await showDialog({
    title: 'Allow saving next to the PDF',
    body:
      `Your answers are stored in “${fileHandle.name}.annotations.json” in the same folder as the PDF ` +
      `(the PDF itself is never modified). In the next dialog, select the folder that contains ` +
      `“${fileHandle.name}” and allow the app to edit files there.`,
    buttons: [
      { id: 'cancel', label: 'Cancel' },
      { id: 'ok', label: 'Choose folder…', primary: true },
    ],
  });
  if (go !== 'ok') return null;

  let picked: FileSystemDirectoryHandle;
  try {
    picked = await window.showDirectoryPicker({ id: 'grammatik-folder', mode: 'readwrite', startIn: fileHandle });
  } catch (e) {
    if (isAbort(e)) return null;
    throw e;
  }

  // The chosen folder may be the PDF's folder or any ancestor of it.
  const path = await picked.resolve(fileHandle);
  if (!path) {
    throw new OpenError(
      `The folder “${picked.name}” does not contain “${fileHandle.name}”. Open the PDF again and choose the folder it is in.`,
    );
  }
  let dirHandle = picked;
  for (const part of path.slice(0, -1)) dirHandle = await dirHandle.getDirectoryHandle(part);

  const book: RecentBook = { fileName: fileHandle.name, fileHandle, dirHandle, openedAt: Date.now() };
  await setRecentBook(book).catch(() => {});
  return book;
}

export { getRecentBook };

/** Re-grants permission (needs a user gesture) and re-locates the PDF in its folder. */
export async function resumeBook(recent: RecentBook): Promise<RecentBook> {
  if (!(await ensureFolderPermission(recent.dirHandle))) {
    throw new OpenError('Permission to the folder was not granted. Click “Resume” again and choose “Allow”, or open the PDF again.');
  }
  try {
    const fileHandle = await recent.dirHandle.getFileHandle(recent.fileName);
    const book = { ...recent, fileHandle, openedAt: Date.now() };
    await setRecentBook(book).catch(() => {});
    return book;
  } catch (e) {
    if (isNotFound(e)) {
      throw new OpenError(
        `“${recent.fileName}” is no longer in the folder “${recent.dirHandle.name}”. It may have been moved or renamed. Use “Open PDF…” to pick it again.`,
      );
    }
    throw e;
  }
}
