// Debounced autosave with external-change (other machine) detection.

import type { Store } from '../model/store';
import type { SidecarFile } from './sidecar';

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict';

export interface AutoSaveHooks {
  onStatus(status: SaveStatus, detail?: string): void;
  /** File changed on disk while we have unsaved edits: ask the user. */
  askConflict(): Promise<'reload' | 'overwrite' | 'cancel'>;
  /** Replace the in-memory document with the one on disk. */
  reloadFromDisk(reason: 'external' | 'user'): Promise<void>;
}

const CONTENT_DELAY = 1000;
const VIEW_DELAY = 10000;

export class AutoSaver {
  private savedContentRev: number;
  private savedViewRev: number;
  private timer: number | undefined;
  private running: Promise<void> | null = null;
  private status: SaveStatus = 'saved';
  /** Set while a conflict is unresolved: autosave is paused. */
  private conflict = false;
  private unsubscribe: () => void;

  constructor(
    private store: Store,
    private file: SidecarFile,
    private hooks: AutoSaveHooks,
    /** False when no sidecar exists yet and nothing has been edited. */
    existsOnDisk: boolean,
  ) {
    this.savedContentRev = existsOnDisk ? store.contentRev : -1;
    this.savedViewRev = store.viewRev;
    this.unsubscribe = store.subscribe((c) => {
      if (c.kind === 'reset') this.markClean();
      else this.schedule();
    });
    this.setStatus(this.contentDirty ? 'unsaved' : 'saved');
    // Create the sidecar right away, which also surfaces permission problems early.
    if (!existsOnDisk) this.schedule();
  }

  dispose(): void {
    this.unsubscribe();
    clearTimeout(this.timer);
  }

  get contentDirty(): boolean {
    return this.store.contentRev !== this.savedContentRev;
  }

  get viewDirty(): boolean {
    return this.store.viewRev !== this.savedViewRev;
  }

  markClean(): void {
    this.savedContentRev = this.store.contentRev;
    this.savedViewRev = this.store.viewRev;
    this.conflict = false;
    clearTimeout(this.timer);
    this.setStatus('saved');
  }

  private setStatus(s: SaveStatus, detail?: string): void {
    this.status = s;
    this.hooks.onStatus(s, detail);
  }

  private schedule(): void {
    if (this.conflict) return;
    if (this.contentDirty && this.status !== 'saving') this.setStatus('unsaved');
    clearTimeout(this.timer);
    const delay = this.contentDirty ? CONTENT_DELAY : this.viewDirty ? VIEW_DELAY : -1;
    if (delay >= 0) this.timer = window.setTimeout(() => void this.save(), delay);
  }

  /** Save now (Ctrl+S, tab hidden). Resolves when done. */
  async save(opts: { force?: boolean; manual?: boolean } = {}): Promise<void> {
    clearTimeout(this.timer);
    if (this.running) {
      await this.running;
      if (!this.contentDirty && !this.viewDirty && !opts.force) return;
    }
    if (this.conflict && !opts.force && !opts.manual) return;
    if (!this.contentDirty && !this.viewDirty && !opts.force && !opts.manual) return;
    this.running = this.doSave(opts.force ?? false).finally(() => (this.running = null));
    return this.running;
  }

  private async doSave(force: boolean): Promise<void> {
    const contentRev = this.store.contentRev;
    const viewRev = this.store.viewRev;
    const hadContent = this.contentDirty;
    this.setStatus('saving');
    try {
      const res = await this.file.save(this.store.doc, { force });
      if (res.status === 'conflict') {
        await this.handleConflict(hadContent);
        return;
      }
      this.savedContentRev = contentRev;
      this.savedViewRev = viewRev;
      this.conflict = false;
      this.setStatus(this.contentDirty ? 'unsaved' : 'saved');
      if (this.contentDirty || this.viewDirty) this.schedule();
    } catch (e) {
      this.setStatus('error', describeError(e));
    }
  }

  private async handleConflict(hasLocalEdits: boolean): Promise<void> {
    if (!hasLocalEdits) {
      // Only our page/zoom changed: take the other machine's version silently.
      await this.hooks.reloadFromDisk('external');
      return;
    }
    this.conflict = true;
    this.setStatus('conflict');
    const choice = await this.hooks.askConflict();
    if (choice === 'reload') await this.hooks.reloadFromDisk('user');
    else if (choice === 'overwrite') {
      this.conflict = false;
      await this.doSave(true);
    }
    // 'cancel': stay paused; the next manual save asks again.
  }

  /** Called when the window regains focus: pick up edits from the other machine. */
  async checkExternalChange(): Promise<void> {
    if (this.running || this.conflict) return;
    let changed;
    try {
      changed = await this.file.changedOnDisk();
    } catch {
      return;
    }
    if (!changed) return;
    await this.handleConflict(this.contentDirty);
  }
}

export function describeError(e: unknown): string {
  if (e instanceof DOMException) {
    switch (e.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Permission to the folder was denied. Click "Resume" or reopen the PDF to grant access again.';
      case 'NotFoundError':
        return 'The folder or file was not found. It may have been moved, renamed or deleted.';
      case 'NoModificationAllowedError':
      case 'InvalidStateError':
        return 'The file is locked or was changed by another program. Try again in a moment.';
      case 'QuotaExceededError':
        return 'The disk is full.';
    }
    return `${e.name}: ${e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}
