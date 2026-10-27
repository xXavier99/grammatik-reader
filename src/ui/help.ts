// "?" overlay listing keyboard shortcuts.

import { showDialog } from './dialogs';
import { el } from './dom';

const SHORTCUTS: [string, string][] = [
  ['Click on the page', 'New text box (Text mode)'],
  ['Click on a text box', 'Edit it'],
  ['Enter (in a box)', 'Next row (same spacing as the last answer area)'],
  ['Shift + Enter (in a box)', 'New line inside the box'],
  ['↑ / ↓ (in a box)', 'Previous / next row'],
  ['Tab / Shift + Tab (in a box)', 'Next / previous blank, or answer area, on the page'],
  ['Click on or near a blank', 'Type into it (Text mode)'],
  ['Area mode: drag', 'Draw an answer area split into “Lines” rows'],
  ['Area mode: drag area / edge', 'Move / resize the selected area'],
  ['Blanks mode: click', 'Add the next blank (numbered in click order)'],
  ['Blanks mode: drag / Delete', 'Move / remove the selected blank'],
  ['Blanks mode: Enter', 'Type into the selected (or first empty) blank'],
  ['Cover mode: drag', 'White rectangle hiding the page below (text, marks and lines go on top)'],
  ['Cover mode: drag a cover / edge, Delete', 'Move / resize / delete the selected cover'],
  ['Underline mode: drag over text', 'Underline it (line along the bottom of the drag)'],
  ['Underline mode: click a line / Delete', 'Select it / delete it'],
  ['Line mode: drag', 'Straight line from start to end (Shift: snap to 45°)'],
  ['Select mode: click / Shift + click', 'Select an item / add it to the selection'],
  ['Select mode: drag on empty space', 'Select everything in the rectangle'],
  ['Select mode: drag a selected item', 'Move the selection'],
  ['Select mode: Delete', 'Delete the selection'],
  ['Select mode: Enter', 'Edit the selected text box'],
  ['Esc', 'Finish editing / deselect'],
  ['Delete / Backspace', 'Delete the selected box'],
  ['Enter (box selected)', 'Edit the selected box'],
  ['Alt + drag, or drag the grip', 'Move a text box'],
  ['Drag the right handle', 'Set box width (double-click: automatic)'],
  ['Ctrl + Z / Ctrl + Y', 'Undo / redo (inside a box: text undo)'],
  ['V / T / A / W / U / L / B / C', 'Select / Text / Area / Cover / Underline / Line / Blanks / Check mode'],
  ['Check: left click', '✓ next to the answer (again: remove)'],
  ['Check: right click', '✗ + type the correction (Enter: done)'],
  ['Check: click / drag a mark', 'Remove / move it (with its correction)'],
  ['Check: right-click a ✓', 'Turn it into ✗ + correction'],
  ['M', 'Map top page → bottom page (answer key)'],
  ['Click a pane / F6', 'Focus it: page, zoom and keys act on the focused pane'],
  ['Drag the divider', 'Resize panes (double-click: 50/50)'],
  ['PageDown / → / ↓', 'Next page (focused pane)'],
  ['PageUp / ← / ↑', 'Previous page'],
  ['Home / End', 'First / last page'],
  ['Ctrl + wheel', 'Zoom at the mouse pointer'],
  ['Ctrl + + / Ctrl + −', 'Zoom in / out'],
  ['Ctrl + 0', 'Fit width'],
  ['Ctrl + S', 'Save now'],
  ['?', 'This help'],
];

let open = false;

export async function showHelp(): Promise<void> {
  if (open) return;
  open = true;
  const rows = SHORTCUTS.map(([k, d]) => el('tr', {}, el('td', {}, el('kbd', {}, k)), el('td', {}, d)));
  await showDialog({
    title: 'Keyboard shortcuts',
    body: el('table', { class: 'shortcuts' }, ...rows),
    buttons: [{ id: 'ok', label: 'Close', primary: true }],
    className: 'help',
  });
  open = false;
}
