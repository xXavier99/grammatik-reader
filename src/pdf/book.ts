// Loads a PDF with pdf.js (worker bundled locally) and tracks page geometry.

import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { displaySize, normalizeRotation, type PageGeom } from '../model/coords';
import type { Size } from './layout';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const assetUrl = (p: string) => new URL(`${import.meta.env.BASE_URL}pdfjs/${p}/`, document.baseURI).href;

export class PdfBook {
  readonly pageCount: number;
  /** Per-page geometry (index = page - 1). Estimated from page 1 until all are loaded. */
  readonly geoms: PageGeom[];
  private pages = new Map<number, Promise<PDFPageProxy>>();
  private geomListeners = new Set<() => void>();

  private constructor(
    readonly doc: PDFDocumentProxy,
    readonly name: string,
    first: PageGeom,
  ) {
    this.pageCount = doc.numPages;
    this.geoms = Array.from({ length: this.pageCount }, () => ({ ...first, view: [...first.view] as PageGeom['view'] }));
  }

  static async load(data: ArrayBuffer, name: string): Promise<PdfBook> {
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(data),
      cMapUrl: assetUrl('cmaps'),
      cMapPacked: true,
      standardFontDataUrl: assetUrl('standard_fonts'),
      isEvalSupported: false,
    }).promise;
    const p1 = await doc.getPage(1);
    const book = new PdfBook(doc, name, geomOf(p1));
    book.pages.set(1, Promise.resolve(p1));
    void book.loadAllGeoms();
    return book;
  }

  get fingerprint(): string | null {
    return this.doc.fingerprints[0] ?? null;
  }

  getPage(pageNo: number): Promise<PDFPageProxy> {
    let p = this.pages.get(pageNo);
    if (!p) {
      p = this.doc.getPage(pageNo);
      this.pages.set(pageNo, p);
    }
    return p;
  }

  displaySizes(): Size[] {
    return this.geoms.map(displaySize);
  }

  onGeomsChanged(fn: () => void): () => void {
    this.geomListeners.add(fn);
    return () => this.geomListeners.delete(fn);
  }

  /** Reads every page's size in the background; notifies if any differ from page 1. */
  private async loadAllGeoms(): Promise<void> {
    const BATCH = 25;
    let changed = false;
    for (let start = 2; start <= this.pageCount; start += BATCH) {
      const end = Math.min(this.pageCount, start + BATCH - 1);
      const batch: Promise<void>[] = [];
      for (let n = start; n <= end; n++) {
        batch.push(
          this.doc.getPage(n).then((page) => {
            const g = geomOf(page);
            const old = this.geoms[n - 1];
            if (g.rotation !== old.rotation || g.view.some((v, i) => v !== old.view[i])) {
              this.geoms[n - 1] = g;
              changed = true;
            }
          }),
        );
      }
      try {
        await Promise.all(batch);
      } catch {
        // A broken page keeps the estimated size; rendering will surface the error.
      }
      if (changed) {
        changed = false;
        for (const fn of this.geomListeners) fn();
      }
    }
  }

  destroy(): void {
    void this.doc.destroy();
  }
}

function geomOf(page: PDFPageProxy): PageGeom {
  const [x0, y0, x1, y1] = page.view;
  return { view: [x0, y0, x1, y1], rotation: normalizeRotation(page.rotate) };
}
