// An open book: PDF, annotation store, autosave, panes, sidebar, toolbar.

import { exportPdf } from '../export/exportFlow';
import { lookupAnswerPage, setPageMapping } from '../model/answerKey';
import { findEntity, updateOp } from '../model/history';
import { createEmptyDoc } from '../model/schema';
import { Store } from '../model/store';
import { TEXT_FONT_FAMILY } from '../model/text';
import { PdfBook } from '../pdf/book';
import { stepZoom } from '../pdf/layout';
import { Renderer } from '../pdf/renderer';
import { AutoSaver, describeError, type SaveStatus } from '../storage/autosave';
import type { RecentBook } from '../storage/handles';
import { SidecarFile } from '../storage/sidecar';
import { EditorState, type Mode } from '../tools/editor';
import { AreaTool } from '../tools/area';
import { BlankTool } from '../tools/blank';
import { CheckTool } from '../tools/check';
import { SelectTool } from '../tools/select';
import { TextTool } from '../tools/text';
import { UnderlineTool } from '../tools/underline';
import { AnnotationLayer } from './annotations';
import { AnswerKeyPanel } from './answerKeyPanel';
import { showDialog, toast } from './dialogs';
import { el } from './dom';
import { showHelp } from './help';
import { PdfPane } from './pane';
import { Sidebar } from './sidebar';
import { SplitLayout, type SplitMode } from './split';
import { Toolbar } from './toolbar';

export interface SessionHost {
  openAnother(): void;
}

export class Session {
  readonly el: HTMLElement;
  readonly store: Store;
  readonly saver: AutoSaver;
  private toolbar: Toolbar;
  private sidebar: Sidebar;
  private renderer: Renderer;
  private panes: PdfPane[] = [];
  private focusedPane: PdfPane;
  private split: SplitLayout;
  private akPanel: AnswerKeyPanel;
  /** Orientation to restore when the split is switched on again. */
  private lastOrientation: Exclude<SplitMode, 'none'> = 'horizontal';
  private saveDetail = '';
  readonly editor = new EditorState();
  private layer: AnnotationLayer;
  private textTool: TextTool;
  private areaTool: AreaTool;
  private checkTool: CheckTool;
  private blankTool: BlankTool;
  private selectTool: SelectTool;
  private underlineTool: UnderlineTool;

  static async open(handles: RecentBook, host: SessionHost): Promise<Session> {
    // Text boxes are measured on screen; make sure the real font is ready first.
    await document.fonts.load(`16px '${TEXT_FONT_FAMILY}'`).catch(() => {});
    const file = await handles.fileHandle.getFile();
    const book = await PdfBook.load(await file.arrayBuffer(), file.name);
    const sidecar = new SidecarFile(handles.dirHandle, file.name, { pageCount: book.pageCount, fingerprint: book.fingerprint });
    const res = await sidecar.load(file.name);
    let doc;
    if (res.status === 'ok') {
      doc = res.doc;
      for (const w of res.warnings) toast(w, 'warn', 8000);
    } else {
      doc = createEmptyDoc(file.name, book.pageCount, book.fingerprint);
      if (res.status === 'corrupt') {
        await showDialog({
          title: 'Annotations file could not be read',
          body:
            `“${sidecar.name}” is damaged or incompatible (${res.reason}). ` +
            `An unchanged copy was saved as “${res.backupName}” in the same folder. ` +
            `The book opens with empty annotations, and the damaged file will be replaced on the next save.`,
          buttons: [{ id: 'ok', label: 'OK', primary: true }],
        });
      }
    }
    return new Session(book, sidecar, new Store(doc), res.status === 'ok', host, handles);
  }

  private constructor(
    readonly book: PdfBook,
    private sidecar: SidecarFile,
    store: Store,
    existsOnDisk: boolean,
    private host: SessionHost,
    private handles: RecentBook,
  ) {
    this.store = store;
    this.renderer = new Renderer(book);
    this.layer = new AnnotationLayer(store, this.editor);
    this.textTool = new TextTool(store, this.editor, this.layer);
    this.areaTool = new AreaTool(store, this.editor, (ctx, area) => {
      // Drawing an area flows straight into typing its first row.
      this.setMode('text');
      this.textTool.enterArea(ctx, area);
    });
    this.checkTool = new CheckTool(store, this.textTool);
    this.blankTool = new BlankTool(store, this.editor);
    this.selectTool = new SelectTool(store, this.editor);
    this.underlineTool = new UnderlineTool(store, this.editor);
    this.layer.setTool(this.textTool);

    this.toolbar = new Toolbar({
      toggleSidebar: () => this.store.setView({ sidebarOpen: !this.store.doc.view.sidebarOpen }),
      open: () => this.host.openAnother(),
      showSaveDetail: () => void this.onStatusClick(),
      setMode: (m) => this.setMode(m),
      undo: () => this.undo(),
      redo: () => this.redo(),
      setFontSize: (pt) => this.applyTextStyle({ fontSize: pt }),
      setColor: (c) => this.applyTextStyle({ color: c }),
      setLines: (n) => this.setLines(n),
      goToPage: (n) => this.focusedPane.goToPage(n),
      prevPage: () => this.focusedPane.prev(),
      nextPage: () => this.focusedPane.next(),
      zoomIn: () => this.focusedPane.setZoom(stepZoom(this.focusedPane.zoom, 1)),
      zoomOut: () => this.focusedPane.setZoom(stepZoom(this.focusedPane.zoom, -1)),
      fitWidth: () => this.focusedPane.setFitWidth(),
      help: () => void showHelp(),
      toggleSplit: () => this.setSplit(this.store.doc.view.split === 'none' ? this.lastOrientation : 'none'),
      toggleOrientation: () => this.setSplit(this.store.doc.view.split === 'vertical' ? 'horizontal' : 'vertical'),
      toggleLink: () => this.setLinked(!this.store.doc.answerKey.linked),
      mapPages: () => this.mapPages(),
      answerKey: (anchor) => this.akPanel.toggle(anchor),
      exportPdf: () => void this.exportPdf(),
    });
    this.toolbar.setFileName(book.name);

    this.sidebar = new Sidebar(book, this.renderer, (n) => this.focusedPane.goToPage(n));
    this.split = new SplitLayout((r) => this.store.setView({ splitRatio: Math.round(r * 1000) / 1000 }));
    this.akPanel = new AnswerKeyPanel({
      store,
      pageCount: book.pageCount,
      topPage: () => this.panes[0].page,
      bottomPage: () => this.panes[1]?.page ?? null,
      goBottom: (n) => this.panes[1]?.goToPage(n),
      mapCurrent: () => this.mapPages(),
      setLinked: (on) => this.setLinked(on),
    });
    this.el = el(
      'div',
      { class: 'session mode-text' },
      this.toolbar.el,
      el('main', { class: 'workspace' }, this.sidebar.el, this.split.el),
      this.akPanel.el,
    );

    const v = store.doc.view;
    const main = this.createPane('main', { page: v.lastPage, zoom: v.zoom, fitWidth: v.fitWidth });
    this.focusedPane = main;
    main.setFocused(true);
    if (v.split !== 'none') this.lastOrientation = v.split;
    const second = v.split !== 'none' ? this.createSecondPane() : null;
    this.split.setPanes(main.el, second?.el ?? null);
    this.split.setMode(v.split, v.splitRatio);

    this.saver = new AutoSaver(
      store,
      sidecar,
      {
        onStatus: (s, d) => this.onSaveStatus(s, d),
        askConflict: () => this.askConflict(),
        reloadFromDisk: (why) => this.reloadFromDisk(why),
      },
      existsOnDisk,
    );

    store.subscribe((c) => {
      if (c.kind === 'view' || c.kind === 'reset') this.applySidebarVisibility();
      if (c.kind !== 'view') this.afterContentChange(c.source);
    });
    this.editor.subscribe(() => this.syncStyleControls());
  }

  /** Call after `el` is attached to the document. */
  start(): void {
    this.applySidebarVisibility();
    this.sidebar.start();
    for (const p of this.panes) p.start();
    this.sidebar.setCurrent(this.focusedPane.page);
    this.syncToolbar();
    this.toolbar.setMode(this.editor.mode);
    this.syncStyleControls();
    this.toolbar.setUndoState(false, false);
    this.syncSplitUi();
    this.focusedPane.focus();
  }

  private createPane(name: string, state: { page: number; zoom: number; fitWidth: boolean }): PdfPane {
    const pane = new PdfPane(
      this.book,
      this.renderer,
      {
        onFocus: (p) => this.setFocused(p),
        onPageChange: (p, page) => {
          if (p === this.panes[0]) {
            this.store.setView({ lastPage: page });
            this.followLink();
          } else this.store.setView({ secondPane: { ...p.state, zoom: round(p.zoom) } });
          this.akPanel.refresh();
          if (p === this.focusedPane) {
            this.sidebar.setCurrent(page);
            this.syncToolbar();
          }
        },
        onZoomChange: (p) => {
          if (p === this.panes[0]) this.store.setView({ zoom: round(p.zoom), fitWidth: p.fitWidth });
          else this.store.setView({ secondPane: { ...p.state, zoom: round(p.zoom) } });
          if (p === this.focusedPane) this.syncToolbar();
        },
      },
      state,
      name,
    );
    this.panes.push(pane);
    this.layer.attach(pane);
    return pane;
  }

  // ---- split view & answer key ------------------------------------------

  private createSecondPane(): PdfPane {
    const sp = this.store.doc.view.secondPane;
    const start = this.store.doc.answerKey.answerStartPage;
    // First time: open at the answer section if it is known.
    const page = sp.page === 1 && start ? start : sp.page;
    return this.createPane('second', { ...sp, page });
  }

  setSplit(mode: SplitMode): void {
    const main = this.panes[0];
    let second: PdfPane | undefined = this.panes[1];
    if (mode === 'none') {
      if (second) {
        this.textTool.finishEditing();
        if (this.focusedPane === second) this.setFocused(main);
        this.layer.detach(second);
        second.destroy();
        this.panes.length = 1;
      }
      this.split.setPanes(main.el, null);
      this.split.setMode('none', this.store.doc.view.splitRatio);
    } else {
      this.lastOrientation = mode;
      const isNew = !second;
      if (!second) second = this.createSecondPane();
      this.split.setPanes(main.el, second.el);
      this.split.setMode(mode, this.store.doc.view.splitRatio);
      if (isNew) {
        second.start();
        this.followLink();
      }
    }
    this.store.setView({ split: mode });
    this.syncSplitUi();
    this.akPanel.refresh();
  }

  private setLinked(on: boolean): void {
    this.store.setAnswerKey({ linked: on });
    if (on) this.followLink();
  }

  /** Linked: show the mapped answer page for the top pane's page (unmapped → stay). */
  private followLink(): void {
    const second = this.panes[1];
    const ak = this.store.doc.answerKey;
    if (!second || !ak.linked) return;
    const target = lookupAnswerPage(ak.mapping, this.panes[0].page);
    if (target !== null && second.page !== target) second.goToPage(target);
  }

  /** "Map": current top page → current bottom page. */
  mapPages(): void {
    const second = this.panes[1];
    if (!second) {
      toast('Open the split view first, then show the matching answer page in the bottom pane.', 'info');
      return;
    }
    const top = this.panes[0].page;
    const ans = second.page;
    this.store.setAnswerKey({ mapping: setPageMapping(this.store.doc.answerKey.mapping, top, ans) });
    toast(`Mapped page ${top} → answers on page ${ans}.`, 'info', 2500);
  }

  private syncSplitUi(): void {
    this.toolbar.setSplit(this.store.doc.view.split, this.store.doc.answerKey.linked);
  }

  private setFocused(p: PdfPane): void {
    if (p === this.focusedPane) return;
    this.focusedPane.setFocused(false);
    this.focusedPane = p;
    p.setFocused(true);
    this.sidebar.setCurrent(p.page);
    this.syncToolbar();
  }

  get pane(): PdfPane {
    return this.focusedPane;
  }

  private syncToolbar(): void {
    const p = this.focusedPane;
    this.toolbar.setPage(p.page, p.pageCount);
    this.toolbar.setZoom(p.zoom, p.fitWidth);
  }

  private applySidebarVisibility(): void {
    this.el.classList.toggle('sidebar-hidden', !this.store.doc.view.sidebarOpen);
  }

  // ---- editing -----------------------------------------------------------

  setMode(m: Mode): void {
    this.textTool.finishEditing();
    this.editor.setMode(m);
    const tools = {
      select: this.selectTool, text: this.textTool, area: this.areaTool, blank: this.blankTool,
      underline: this.underlineTool, check: this.checkTool,
    };
    this.layer.setTool(tools[m]);
    for (const mode of Object.keys(tools)) this.el.classList.remove(`mode-${mode}`);
    this.el.classList.add(`mode-${m}`);
    this.toolbar.setMode(m);
  }

  /** Switches to Text mode and edits the box, or types into the blank, `sel` in the focused pane. */
  private typeInto(sel: { page: number; coll: 'texts' | 'blanks'; id: string }): boolean {
    const view = [...this.focusedPane.pageViews].find((v) => v.pageNo === sel.page);
    const blank = sel.coll === 'blanks' ? findEntity(this.store.doc, sel.page, 'blanks', sel.id) : undefined;
    if (!view || (sel.coll === 'blanks' && !blank)) return false;
    this.setMode('text');
    const ctx = this.layer.ctx(this.focusedPane, view);
    if (blank) this.textTool.enterBlank(ctx, blank);
    else this.textTool.startEditing(ctx, sel.id, null);
    return true;
  }

  /** Enter: edit the selected box (Text / Select mode) or start typing in a blank (Blanks mode). */
  private enterKey(): boolean {
    const mode = this.editor.mode;
    if (mode === 'text') return this.textTool.editSelection(this.focusedPane);
    if (mode === 'select') {
      const sel = this.editor.selection;
      return sel?.coll === 'texts' ? this.typeInto({ ...sel, coll: 'texts' }) : false;
    }
    if (mode === 'blank') {
      const target = this.blankTool.blankToFill(this.focusedPane);
      return target ? this.typeInto({ page: target.page, coll: 'blanks', id: target.blank.id }) : false;
    }
    return false;
  }

  undo(): void {
    this.textTool.finishEditing();
    this.store.undo();
  }

  redo(): void {
    this.textTool.finishEditing();
    this.store.redo();
  }

  /**
   * Toolbar style change: always becomes the default for new boxes, and is
   * also applied to the selected box, if any.
   */
  private applyTextStyle(patch: { fontSize?: number; color?: string }): void {
    const colorKey = this.colorSetting();
    this.store.setSettings({
      ...(patch.fontSize ? { defaultFontSize: patch.fontSize } : {}),
      ...(patch.color ? { [colorKey]: patch.color } : {}),
    });
    const items = this.editor.selected.filter(
      (s) => (s.coll === 'texts' || (s.coll === 'underlines' && patch.color)) && findEntity(this.store.doc, s.page, s.coll, s.id),
    );
    if (items.length) {
      const key = patch.color ? `color:${items.map((s) => s.id).join(',')}` : undefined; // Colour picker drags fire many events.
      const ops = items.map((s) =>
        s.coll === 'texts'
          ? updateOp(this.store.doc, s.page, 'texts', s.id, patch)
          : updateOp(this.store.doc, s.page, 'underlines', s.id, { color: patch.color }),
      );
      this.store.change('Change style', ops, key);
    }
  }

  /** The default colour the picker edits: corrections in Check mode, underlines in Underline mode. */
  private colorSetting(): 'defaultColor' | 'correctionColor' | 'underlineColor' {
    const mode = this.editor.mode;
    return mode === 'check' ? 'correctionColor' : mode === 'underline' ? 'underlineColor' : 'defaultColor';
  }

  /** Lines input: default for new areas, also applied to the selected area. */
  private setLines(n: number): void {
    this.store.setSettings({ areaLines: n });
    this.areaTool.setLines(n);
  }

  private syncStyleControls(): void {
    const sel = this.editor.selection;
    const area = sel?.coll === 'areas' ? findEntity(this.store.doc, sel.page, 'areas', sel.id) : undefined;
    this.toolbar.setLines(area ? area.lines : this.store.doc.settings.areaLines);
    const tb = sel?.coll === 'texts' ? findEntity(this.store.doc, sel.page, 'texts', sel.id) : undefined;
    const ul = sel?.coll === 'underlines' ? findEntity(this.store.doc, sel.page, 'underlines', sel.id) : undefined;
    const s = this.store.doc.settings;
    if (tb) this.toolbar.setTextStyle(tb.fontSize, tb.color);
    else this.toolbar.setTextStyle(s.defaultFontSize, ul ? ul.color : s[this.colorSetting()]);
  }

  private afterContentChange(source?: 'undo' | 'redo'): void {
    const selected = this.editor.selected;
    const alive = selected.filter((s) => findEntity(this.store.doc, s.page, s.coll, s.id));
    if (alive.length !== selected.length) this.editor.selectMany(alive);
    this.toolbar.setUndoState(this.store.history.canUndo, this.store.history.canRedo);
    this.syncStyleControls();
    this.syncSplitUi();
    this.syncToolbar();
    if (source) this.revealLastChange(source);
  }

  /** After undo/redo, bring the affected page into view if it is off-screen. */
  private revealLastChange(source: 'undo' | 'redo'): void {
    const tx = source === 'undo' ? this.store.history.peekRedo() : this.store.history.peekUndo();
    const page = tx?.mutations[0]?.page;
    if (page && !this.focusedPane.isPageVisible(page)) this.focusedPane.goToPage(page);
  }

  /** Session-level keys. Returns true if handled. */
  handleKey(e: KeyboardEvent): boolean {
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (ctrl && !e.altKey && ((k === 'z' && e.shiftKey) || k === 'y')) {
      this.redo();
      return true;
    }
    if (ctrl && !e.altKey && k === 'z') {
      this.undo();
      return true;
    }
    if (ctrl || e.altKey) return false;
    switch (e.key) {
      case 'Delete':
      case 'Backspace':
        switch (this.editor.mode) {
          case 'area': return this.areaTool.deleteSelection();
          case 'blank': return this.blankTool.deleteSelection();
          case 'select':
          case 'underline': return this.selectTool.deleteSelection();
          default: return this.textTool.deleteSelection();
        }
      case 'Enter':
        return this.enterKey();
      case 'Escape':
        if (!this.editor.selected.length) return false;
        this.editor.select(null);
        return true;
      case 'v':
      case 'V':
        this.setMode('select');
        return true;
      case 'b':
      case 'B':
        this.setMode('blank');
        return true;
      case 'u':
      case 'U':
        this.setMode('underline');
        return true;
      case 't':
      case 'T':
        this.setMode('text');
        return true;
      case 'a':
      case 'A':
        this.setMode('area');
        return true;
      case 'c':
      case 'C':
        this.setMode('check');
        return true;
      case 'm':
      case 'M':
        this.mapPages();
        return true;
      case 'F6': {
        const other = this.panes.find((p) => p !== this.focusedPane);
        if (!other) return false;
        this.setFocused(other);
        other.focus();
        return true;
      }
    }
    return false;
  }

  // ---- export ------------------------------------------------------------

  async exportPdf(): Promise<void> {
    this.textTool.finishEditing();
    await exportPdf({
      pdfName: this.book.name,
      fileHandle: this.handles.fileHandle,
      dirHandle: this.handles.dirHandle,
      doc: this.store.doc,
      geoms: this.book.geoms,
    });
  }

  // ---- saving ------------------------------------------------------------

  async saveNow(): Promise<void> {
    await this.saver.save({ manual: true });
  }

  private onSaveStatus(s: SaveStatus, detail?: string): void {
    this.saveDetail = detail ?? '';
    this.toolbar.setSaveStatus(s, detail);
    if (s === 'error') toast(`Could not save annotations: ${detail}`, 'error');
  }

  private async onStatusClick(): Promise<void> {
    if (this.saveDetail) toast(this.saveDetail, 'info');
    await this.saveNow();
  }

  private async askConflict(): Promise<'reload' | 'overwrite' | 'cancel'> {
    const choice = await showDialog({
      title: 'Annotations changed on another computer',
      body:
        `“${this.sidecar.name}” was modified on disk since it was loaded (probably by your other computer through Google Drive), ` +
        `and you also have unsaved changes here. Reload discards your unsaved changes; Overwrite replaces the other version with yours.`,
      buttons: [
        { id: 'cancel', label: 'Decide later' },
        { id: 'reload', label: 'Reload from disk' },
        { id: 'overwrite', label: 'Overwrite with mine', danger: true },
      ],
    });
    return (choice as 'reload' | 'overwrite' | null) ?? 'cancel';
  }

  private async reloadFromDisk(why: 'external' | 'user'): Promise<void> {
    try {
      const res = await this.sidecar.load(this.book.name);
      if (res.status !== 'ok') {
        toast(
          res.status === 'corrupt'
            ? `The annotations file on disk could not be read (${res.reason}); a copy was saved as “${res.backupName}”. Keeping your version.`
            : 'The annotations file has disappeared; it will be recreated on the next save.',
          'warn',
          10000,
        );
        return;
      }
      // Keep where we are looking; take everything else from disk.
      res.doc.view = { ...res.doc.view, ...this.store.doc.view };
      this.store.replace(res.doc);
      if (why === 'external') toast('Annotations were updated from your other computer.', 'info');
    } catch (e) {
      toast(`Could not reload annotations: ${describeError(e)}`, 'error');
    }
  }

  destroy(): void {
    this.akPanel.close();
    this.textTool.finishEditing();
    this.layer.destroy();
    this.saver.dispose();
    for (const p of this.panes) p.destroy();
    this.sidebar.destroy();
    this.renderer.clear();
    this.book.destroy();
    this.el.remove();
  }
}

function round(z: number): number {
  return Math.round(z * 1000) / 1000;
}
