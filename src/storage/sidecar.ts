// Reads and writes <Book>.pdf.annotations.json next to the PDF, detecting
// changes made by another machine (Google Drive sync) before overwriting.

import { migrate, SchemaError, type SidecarDoc } from '../model/schema';

export interface FileStamp {
  lastModified: number;
  size: number;
}

export type LoadResult =
  | { status: 'missing' }
  | { status: 'ok'; doc: SidecarDoc; warnings: string[] }
  /** Unreadable/invalid: the original was copied to `backupName`. */
  | { status: 'corrupt'; reason: string; backupName: string };

export type SaveResult = { status: 'saved' } | { status: 'conflict'; disk: FileStamp };

export class SidecarFile {
  readonly name: string;
  readonly backupName: string;
  /** Stamp of the file as last loaded or written by us; null = no file yet. */
  private baseline: FileStamp | null = null;

  constructor(
    private dir: FileSystemDirectoryHandle,
    pdfName: string,
    private pdfInfo: { pageCount: number; fingerprint: string | null },
  ) {
    this.name = `${pdfName}.annotations.json`;
    this.backupName = `${pdfName}.annotations.json.bak`;
  }

  private async diskFile(): Promise<File | null> {
    try {
      const fh = await this.dir.getFileHandle(this.name);
      return await fh.getFile();
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  async load(pdfName: string): Promise<LoadResult> {
    const file = await this.diskFile();
    if (!file) {
      this.baseline = null;
      return { status: 'missing' };
    }
    const text = await file.text();
    this.baseline = stampOf(file);
    try {
      const { doc, warnings } = migrate(JSON.parse(text), pdfName, this.pdfInfo.pageCount, this.pdfInfo.fingerprint);
      return { status: 'ok', doc, warnings };
    } catch (e) {
      if (!(e instanceof SyntaxError) && !(e instanceof SchemaError)) throw e;
      await this.writeRaw(this.backupName, text);
      return { status: 'corrupt', reason: e.message, backupName: this.backupName };
    }
  }

  /** True when the file on disk differs from what we loaded/last wrote. */
  async changedOnDisk(): Promise<FileStamp | null> {
    const file = await this.diskFile();
    const disk = file ? stampOf(file) : null;
    if (!disk) return null; // Deleted externally: nothing to protect, just recreate.
    if (this.baseline && disk.lastModified === this.baseline.lastModified && disk.size === this.baseline.size) {
      return null;
    }
    return disk;
  }

  async save(doc: SidecarDoc, opts: { force?: boolean } = {}): Promise<SaveResult> {
    if (!opts.force) {
      const disk = await this.changedOnDisk();
      if (disk) return { status: 'conflict', disk };
    }
    doc.savedAt = new Date().toISOString();
    await this.writeRaw(this.name, JSON.stringify(doc, null, 1));
    const file = await this.diskFile();
    this.baseline = file ? stampOf(file) : null;
    return { status: 'saved' };
  }

  private async writeRaw(name: string, text: string): Promise<void> {
    const fh = await this.dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    try {
      await w.write(text);
      await w.close();
    } catch (e) {
      await w.abort().catch(() => {});
      throw e;
    }
  }
}

function stampOf(f: File): FileStamp {
  return { lastModified: f.lastModified, size: f.size };
}

export function isNotFound(e: unknown): boolean {
  return e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError');
}
