// Container for one or two panes, stacked (horizontal split: top/bottom) or
// side by side (vertical split), with a draggable divider.

import { el } from './dom';

export type SplitMode = 'none' | 'horizontal' | 'vertical';

const MIN_RATIO = 0.15;
const MAX_RATIO = 0.85;

export class SplitLayout {
  readonly el: HTMLDivElement;
  private divider: HTMLDivElement;
  private first: HTMLElement | null = null;
  private second: HTMLElement | null = null;
  private mode: SplitMode = 'none';
  private ratio = 0.5;

  /** `onRatio` is called when a divider drag ends. */
  constructor(private onRatio: (ratio: number) => void) {
    this.divider = el('div', { class: 'split-divider', role: 'separator', title: 'Drag to resize the panes' });
    this.el = el('div', { class: 'panes split-none' });
    this.divider.addEventListener('pointerdown', (e) => this.startDrag(e));
    this.divider.addEventListener('dblclick', () => {
      this.ratio = 0.5;
      this.apply();
      this.onRatio(this.ratio);
    });
  }

  /**
   * Places the panes. Existing nodes are never moved: re-inserting an element
   * would reset its scroll position.
   */
  setPanes(first: HTMLElement, second: HTMLElement | null): void {
    if (first.parentElement !== this.el) this.el.prepend(first);
    if (second) {
      if (this.divider.parentElement !== this.el) first.after(this.divider);
      if (second.parentElement !== this.el) this.divider.after(second);
    } else {
      this.divider.remove();
      if (this.second && this.second !== first) this.second.remove();
    }
    this.first = first;
    this.second = second;
    this.apply();
  }

  setMode(mode: SplitMode, ratio: number): void {
    this.mode = mode;
    this.ratio = clamp(ratio);
    this.apply();
  }

  private apply(): void {
    const split = this.mode !== 'none' && !!this.second;
    this.el.className = `panes split-${split ? this.mode : 'none'}`;
    if (this.first) this.first.style.flex = split ? `${this.ratio} 1 0` : '';
    if (this.second) this.second.style.flex = split ? `${1 - this.ratio} 1 0` : '';
  }

  private startDrag(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    this.divider.setPointerCapture(e.pointerId);
    this.el.classList.add('resizing');
    const onMove = (ev: PointerEvent) => {
      const r = this.el.getBoundingClientRect();
      this.ratio = clamp(this.mode === 'vertical' ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height);
      this.apply();
    };
    const onUp = () => {
      this.divider.removeEventListener('pointermove', onMove);
      this.divider.removeEventListener('pointerup', onUp);
      this.divider.removeEventListener('pointercancel', onUp);
      this.el.classList.remove('resizing');
      this.onRatio(this.ratio);
    };
    this.divider.addEventListener('pointermove', onMove);
    this.divider.addEventListener('pointerup', onUp);
    this.divider.addEventListener('pointercancel', onUp);
  }
}

function clamp(r: number): number {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, Number.isFinite(r) ? r : 0.5));
}
