// Remembers the last opened PDF (file + folder handles) in IndexedDB so the
// next session only needs a "Resume" click to re-grant permission.

const DB_NAME = 'grammatik-reader';
const STORE = 'handles';
const RECENT_KEY = 'recent';

export interface RecentBook {
  fileName: string;
  fileHandle: FileSystemFileHandle;
  dirHandle: FileSystemDirectoryHandle;
  openedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function getRecentBook(): Promise<RecentBook | null> {
  try {
    return (await tx<RecentBook | undefined>('readonly', (s) => s.get(RECENT_KEY))) ?? null;
  } catch {
    return null;
  }
}

export function setRecentBook(book: RecentBook): Promise<unknown> {
  return tx('readwrite', (s) => s.put(book, RECENT_KEY));
}

export function clearRecentBook(): Promise<unknown> {
  return tx('readwrite', (s) => s.delete(RECENT_KEY));
}

/** Asks for read/write access to the folder. Must run inside a user gesture. */
export async function ensureFolderPermission(dir: FileSystemDirectoryHandle): Promise<boolean> {
  const opts: FileSystemHandlePermissionDescriptor = { mode: 'readwrite' };
  if ((await dir.queryPermission(opts)) === 'granted') return true;
  return (await dir.requestPermission(opts)) === 'granted';
}
