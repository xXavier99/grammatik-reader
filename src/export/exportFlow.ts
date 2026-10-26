// "Export PDF" in the browser: options dialog, save picker, building, writing.

import fontUrl from '../assets/fonts/NotoSans-Regular.ttf?url';
import type { PageGeom } from '../model/coords';
import type { SidecarDoc } from '../model/schema';
import { LINE_HEIGHT, TEXT_FONT_FAMILY } from '../model/text';
import { describeError } from '../storage/autosave';
import { showDialog, showError, toast } from '../ui/dialogs';
import { el } from '../ui/dom';
import { buildAnnotatedPdf, exportFileName } from './exportPdf';

export interface ExportSource {
  pdfName: string;
  fileHandle: FileSystemFileHandle;
  dirHandle: FileSystemDirectoryHandle;
  doc: SidecarDoc;
  geoms: PageGeom[];
}

let lastIncludeChecks = true;

export async function exportPdf(src: ExportSource): Promise<void> {
  const box = el('input', { type: 'checkbox', id: 'export-checks' });
  box.checked = lastIncludeChecks;
  const choice = await showDialog({
    title: 'Export PDF',
    body: el(
      'div',
      {},
      el('p', {}, 'Creates a copy of the PDF with your answers written into it. The original PDF is not changed.'),
      el('label', { class: 'ak-row', for: 'export-checks' }, box, ' Include ✓ / ✗ marks and corrections'),
    ),
    buttons: [
      { id: 'cancel', label: 'Cancel' },
      { id: 'export', label: 'Export…', primary: true },
    ],
  });
  if (choice !== 'export') return;
  lastIncludeChecks = box.checked;

  // The save picker must open right after the click (user activation).
  let target: FileSystemFileHandle;
  try {
    target = await window.showSaveFilePicker({
      id: 'grammatik-export',
      suggestedName: exportFileName(src.pdfName),
      startIn: src.dirHandle,
      types: [{ description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } }],
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return;
    await showError('Export failed', describeError(e));
    return;
  }
  if (await target.isSameEntry(src.fileHandle)) {
    await showError('Export cancelled', 'That is the original PDF. Choose a different file name; the original is never overwritten.');
    return;
  }

  toast('Exporting…', 'info', 2000);
  try {
    const [original, fontBytes] = await Promise.all([
      src.fileHandle.getFile().then((f) => f.arrayBuffer()),
      fetch(fontUrl).then((r) => {
        if (!r.ok) throw new Error(`Could not load the font (${r.status}).`);
        return r.arrayBuffer();
      }),
    ]);
    const bytes = await buildAnnotatedPdf({
      original,
      doc: src.doc,
      geoms: src.geoms,
      fontBytes,
      baselineRatio: measureBaselineRatio(),
      options: { includeChecks: lastIncludeChecks },
    });
    const w = await target.createWritable();
    try {
      await w.write(bytes);
      await w.close();
    } catch (e) {
      await w.abort().catch(() => {});
      throw e;
    }
    toast(`Exported “${target.name}”.`, 'info', 6000);
  } catch (e) {
    await showError('Export failed', describeError(e));
  }
}

/**
 * Where the browser puts the text baseline inside a line box, as a fraction of
 * the font size, for the bundled font. Measured rather than computed from font
 * tables, so the export matches the screen exactly.
 */
export function measureBaselineRatio(): number {
  const size = 100;
  const probe = el('span', { style: 'display:inline-block;width:0;height:0;vertical-align:baseline' });
  const host = el(
    'div',
    {
      style:
        `position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;` +
        `font-family:'${TEXT_FONT_FAMILY}';font-size:${size}px;line-height:${LINE_HEIGHT}`,
    },
    'Hg',
    probe,
  );
  document.body.appendChild(host);
  const ratio = probe.offsetTop / size;
  host.remove();
  return ratio;
}
