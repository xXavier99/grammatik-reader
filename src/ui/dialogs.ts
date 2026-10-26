// Modal dialogs (native <dialog>) and toast notifications.

import { el } from './dom';

export interface DialogButton {
  id: string;
  label: string;
  primary?: boolean;
  danger?: boolean;
}

export interface DialogOptions {
  title: string;
  body: string | Node;
  buttons: DialogButton[];
  /** Extra class for styling (e.g. 'help'). */
  className?: string;
}

/** Shows a modal; resolves to the clicked button id, or null on Esc. */
export function showDialog(opts: DialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const body = typeof opts.body === 'string' ? el('p', {}, opts.body) : opts.body;
    const buttons = opts.buttons.map((b) => {
      const btn = el('button', { type: 'button', class: [b.primary ? 'primary' : '', b.danger ? 'danger' : ''].join(' ').trim() }, b.label);
      btn.addEventListener('click', () => close(b.id));
      return btn;
    });
    const dlg = el(
      'dialog',
      { class: `modal ${opts.className ?? ''}`.trim() },
      el('h2', {}, opts.title),
      el('div', { class: 'modal-body' }, body),
      el('div', { class: 'modal-buttons' }, ...buttons),
    );
    let result: string | null = null;
    const close = (id: string | null) => {
      result = id;
      dlg.close();
    };
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });
    document.body.appendChild(dlg);
    dlg.showModal();
    (buttons.find((_, i) => opts.buttons[i].primary) ?? buttons[0])?.focus();
  });
}

export function showError(title: string, message: string): Promise<string | null> {
  return showDialog({ title, body: message, buttons: [{ id: 'ok', label: 'OK', primary: true }] });
}

let toastHost: HTMLElement | null = null;

export type ToastKind = 'info' | 'warn' | 'error';

/** Non-blocking notice. Errors stay until clicked; others fade out. */
export function toast(message: string, kind: ToastKind = 'info', ms = kind === 'error' ? 0 : 4500): void {
  if (!toastHost) {
    toastHost = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastHost);
  }
  const t = el('div', { class: `toast ${kind}`, title: 'Click to dismiss' }, message);
  const remove = () => t.remove();
  t.addEventListener('click', remove);
  toastHost.appendChild(t);
  if (ms > 0) setTimeout(remove, ms);
}
