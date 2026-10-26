// Application shell: start screen (Open / Resume), global keyboard handling,
// and the lifecycle of the open book.

import { stepZoom } from '../pdf/layout';
import { describeError } from '../storage/autosave';
import type { RecentBook } from '../storage/handles';
import { fsAccessSupported, getRecentBook, OpenError, pickBook, resumeBook } from '../storage/opener';
import { showError } from './dialogs';
import { el, isTyping } from './dom';
import { showHelp } from './help';
import { Session } from './session';

export class App {
  private session: Session | null = null;
  private busy = false;

  constructor(private root: HTMLElement) {
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('focus', () => void this.session?.saver.checkExternalChange());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.session?.saver.save();
    });
    window.addEventListener('beforeunload', (e) => {
      const s = this.session?.saver;
      if (s?.contentDirty) {
        void s.save();
        e.preventDefault();
      }
    });
  }

  async start(): Promise<void> {
    await this.showStart();
  }

  private async showStart(): Promise<void> {
    this.root.replaceChildren();
    const recent = fsAccessSupported() ? await getRecentBook() : null;

    const openBtn = el('button', { type: 'button', class: recent ? '' : 'primary' }, 'Open PDF…');
    openBtn.addEventListener('click', () => void this.run(() => pickBook()));
    const actions = el('div', { class: 'start-actions' });
    if (recent) {
      const resume = el('button', { type: 'button', class: 'primary' }, `Resume “${recent.fileName}”`);
      resume.addEventListener('click', () => void this.run(() => resumeBook(recent)));
      actions.append(resume);
    }
    actions.append(openBtn);

    const unsupported = !fsAccessSupported()
      ? el('p', { class: 'warning' }, 'This browser does not support the File System Access API. Please use desktop Chrome or Edge.')
      : null;
    this.root.append(
      el(
        'div',
        { class: 'start' },
        el('h1', {}, 'Grammatik Reader'),
        el('p', { class: 'muted' }, 'Type answers on your workbook PDF. Your work is saved next to the PDF; the PDF itself is never changed.'),
        unsupported ?? actions,
        recent ? el('p', { class: 'muted small' }, `Folder: ${recent.dirHandle.name}`) : null,
      ),
    );
    if (unsupported) return;
    (actions.querySelector('button.primary') as HTMLButtonElement | null)?.focus();
  }

  /** Runs an open/resume flow and loads the result. */
  private async run(choose: () => Promise<RecentBook | null>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const handles = await choose();
      if (handles) await this.load(handles);
    } catch (e) {
      await showError('Could not open the book', e instanceof OpenError ? e.message : describeError(e));
    } finally {
      this.busy = false;
    }
  }

  private async load(handles: RecentBook): Promise<void> {
    if (this.session) {
      await this.session.saver.save();
      this.session.destroy();
      this.session = null;
    }
    const loading = el('div', { class: 'loading-screen' }, `Loading “${handles.fileName}”…`);
    this.root.replaceChildren(loading);
    try {
      const session = await Session.open(handles, { openAnother: () => void this.run(() => pickBook()) });
      this.session = session;
      this.root.replaceChildren(session.el);
      session.start();
      document.title = `${handles.fileName} – Grammatik Reader`;
    } catch (e) {
      await this.showStart();
      throw e;
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (document.querySelector('dialog[open]')) return;
    const s = this.session;
    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void s?.saveNow();
      return;
    }
    if (!s) return;
    // In a text field, Ctrl+Z / Ctrl+Y use the field's own (per-character) undo.
    if (!isTyping(e.target) && s.handleKey(e)) {
      e.preventDefault();
      return;
    }
    if (ctrl && (e.key === '+' || e.key === '=')) {
      e.preventDefault();
      s.pane.setZoom(stepZoom(s.pane.zoom, 1));
      return;
    }
    if (ctrl && e.key === '-') {
      e.preventDefault();
      s.pane.setZoom(stepZoom(s.pane.zoom, -1));
      return;
    }
    if (ctrl && e.key === '0') {
      e.preventDefault();
      s.pane.setFitWidth();
      return;
    }
    if (isTyping(e.target) || ctrl || e.altKey) return;

    switch (e.key) {
      case 'PageDown':
      case 'ArrowRight':
      case 'ArrowDown':
        s.pane.next();
        break;
      case 'PageUp':
      case 'ArrowLeft':
      case 'ArrowUp':
        s.pane.prev();
        break;
      case 'Home':
        s.pane.goToPage(1);
        break;
      case 'End':
        s.pane.goToPage(s.pane.pageCount);
        break;
      case '?':
        void showHelp();
        break;
      default:
        return;
    }
    e.preventDefault();
  }
}
