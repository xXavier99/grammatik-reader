// Popover for answer-key settings: link toggle, start of the answer section,
// and the editable "exercise pages → answer page" table.

import { normalizeMapping } from '../model/answerKey';
import type { AnswerMapping } from '../model/schema';
import type { Store } from '../model/store';
import { el } from './dom';

export interface AnswerKeyHost {
  store: Store;
  pageCount: number;
  topPage(): number;
  /** Page of the bottom pane, or null when not split. */
  bottomPage(): number | null;
  goBottom(page: number): void;
  mapCurrent(): void;
  setLinked(on: boolean): void;
}

export class AnswerKeyPanel {
  readonly el: HTMLDivElement;
  private body: HTMLDivElement;
  private isOpen = false;
  private onDocDown = (e: PointerEvent) => {
    if (!this.el.contains(e.target as Node) && !(e.target as HTMLElement).closest('.answer-key-btn')) this.close();
  };
  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      this.close();
    }
  };

  constructor(private host: AnswerKeyHost) {
    this.body = el('div', { class: 'ak-body' });
    this.el = el('div', { class: 'popover answer-key', role: 'dialog', 'aria-label': 'Answer key' }, el('h3', {}, 'Answer key'), this.body);
    this.el.hidden = true;
    host.store.subscribe((c) => {
      if (this.isOpen && c.kind !== 'view' && !this.el.contains(document.activeElement)) this.render();
    });
  }

  get open(): boolean {
    return this.isOpen;
  }

  toggle(anchor: HTMLElement): void {
    if (this.isOpen) this.close();
    else this.show(anchor);
  }

  show(anchor: HTMLElement): void {
    this.isOpen = true;
    this.render();
    const r = anchor.getBoundingClientRect();
    this.el.style.top = `${r.bottom + 6}px`;
    this.el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 420))}px`;
    this.el.hidden = false;
    document.addEventListener('pointerdown', this.onDocDown, true);
    this.el.addEventListener('keydown', this.onKey);
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.hidden = true;
    document.removeEventListener('pointerdown', this.onDocDown, true);
    this.el.removeEventListener('keydown', this.onKey);
  }

  /** Re-renders (e.g. after the panes moved), unless the user is typing in it. */
  refresh(): void {
    if (this.isOpen && !this.el.contains(document.activeElement)) this.render();
  }

  private render(): void {
    const h = this.host;
    const ak = h.store.doc.answerKey;
    const top = h.topPage();
    const bottom = h.bottomPage();

    const link = el('input', { type: 'checkbox', id: 'ak-link' });
    link.checked = ak.linked;
    link.addEventListener('change', () => h.setLinked(link.checked));

    const start = this.pageInput(ak.answerStartPage, 'Answer section start page', (v) => h.store.setAnswerKey({ answerStartPage: v }));
    const goStart = button('Go', 'Show this page in the bottom pane', () => ak.answerStartPage && h.goBottom(ak.answerStartPage));
    goStart.disabled = !ak.answerStartPage || bottom === null;
    const useBottom = button('Use bottom page', 'Set to the page shown in the bottom pane', () => {
      if (bottom) h.store.setAnswerKey({ answerStartPage: bottom });
      this.render();
    });
    useBottom.disabled = bottom === null;

    const map = button(
      bottom === null ? 'Map pages (open the split view first)' : `Map top p. ${top} → bottom p. ${bottom}`,
      'Add “current top page → current bottom page” to the table (M)',
      () => {
        h.mapCurrent();
        this.render();
      },
      'primary',
    );
    map.disabled = bottom === null;

    const rows = ak.mapping.map((m, i) => this.mappingRow(m, i));
    const add = button('+ Add row', 'Add a mapping row', () => {
      const answer = bottom ?? ak.answerStartPage ?? h.pageCount;
      this.commit([...ak.mapping, { fromPage: top, toPage: top, answerPage: answer }]);
    });

    const empty = rows.length ? [] : [el('p', { class: 'muted small' }, 'No entries yet. Without an entry, the bottom pane stays where it is.')];
    this.body.replaceChildren(
      el('label', { class: 'ak-row', for: 'ak-link' }, link, ' Link: the bottom pane follows the top pane'),
      el('div', { class: 'ak-row' }, el('span', {}, 'Answers start at page'), start, goStart, useBottom),
      el('div', { class: 'ak-row' }, map),
      el(
        'table',
        { class: 'ak-table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Exercise pages'), el('th', {}, 'Answer page'), el('th', {}))),
        el('tbody', {}, ...rows),
      ),
      ...empty,
      el('div', { class: 'ak-row' }, add),
    );
  }

  private mappingRow(m: AnswerMapping, i: number): HTMLTableRowElement {
    const ak = this.host.store.doc.answerKey;
    const update = (patch: Partial<AnswerMapping>) => this.commit(ak.mapping.map((e, j) => (j === i ? { ...e, ...patch } : e)));
    const from = this.pageInput(m.fromPage, 'From page', (v) => v && update({ fromPage: v, toPage: Math.max(v, m.toPage) }));
    const to = this.pageInput(m.toPage, 'To page', (v) => v && update({ toPage: v }));
    const ans = this.pageInput(m.answerPage, 'Answer page', (v) => v && update({ answerPage: v }));
    const go = button('Go', 'Show this answer page in the bottom pane', () => this.host.goBottom(m.answerPage));
    go.disabled = this.host.bottomPage() === null;
    const del = button('×', 'Delete this row', () => this.commit(ak.mapping.filter((_, j) => j !== i)), 'icon');
    return el('tr', {}, el('td', {}, from, ' – ', to), el('td', {}, ans, go), el('td', {}, del));
  }

  private commit(mapping: AnswerMapping[]): void {
    this.host.store.setAnswerKey({ mapping: normalizeMapping(mapping) });
    this.render();
  }

  private pageInput(value: number | null, label: string, onChange: (v: number | null) => void): HTMLInputElement {
    const input = el('input', { type: 'number', min: '1', max: String(this.host.pageCount), class: 'ak-page', 'aria-label': label });
    input.value = value === null ? '' : String(value);
    input.addEventListener('change', () => {
      const v = parseInt(input.value, 10);
      onChange(Number.isFinite(v) ? Math.min(this.host.pageCount, Math.max(1, v)) : null);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
    });
    return input;
  }
}

function button(label: string, title: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = el('button', { type: 'button', title, class: cls }, label);
  b.addEventListener('click', onClick);
  return b;
}
