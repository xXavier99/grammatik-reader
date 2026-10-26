// Sidecar JSON schema (<Book>.pdf.annotations.json).
//
// All geometry is in PDF user-space units of the *unrotated* page (origin
// bottom-left, y pointing up, as in the PDF content stream). Rendering and
// export convert from there, so nothing depends on zoom or /Rotate.

export const SCHEMA_VERSION = 1;
export const APP_ID = 'grammatik-reader';
export const MAX_AREA_LINES = 100;

export type Id = string;

/** A typed note. (x, y) is the top-left corner of the first line box. */
export interface TextBox {
  id: Id;
  kind: 'text' | 'correction';
  x: number;
  y: number;
  /** Fixed wrap width in PDF units, or null to grow with the text. */
  width: number | null;
  fontSize: number;
  color: string;
  text: string;
  /** Set when the box was snapped to a guide line of an answer area. */
  areaId?: Id;
  lineIndex?: number;
  /** For corrections: the ✗ mark this correction belongs to. */
  markId?: Id;
}

/**
 * Answer area split into `lines` rows (see model/areas.ts). (x, y) is the
 * top-left corner: the top edge is the top of the first row's text, the
 * bottom edge the bottom of the last row.
 */
export interface AnswerArea {
  id: Id;
  x: number;
  y: number;
  width: number;
  height: number;
  lines: number;
  /** Font size when drawn: fixes the first row's height (one text line). */
  fontSize: number;
}

/** ✓ or ✗; (x, y) is the centre of the glyph. */
export interface Mark {
  id: Id;
  kind: 'check' | 'cross';
  x: number;
  y: number;
  size: number;
}

export interface PageAnnotations {
  texts: TextBox[];
  areas: AnswerArea[];
  marks: Mark[];
}

/** Exercise pages fromPage..toPage (1-based, inclusive) → answer page. */
export interface AnswerMapping {
  fromPage: number;
  toPage: number;
  answerPage: number;
}

export interface PaneView {
  page: number;
  zoom: number;
  fitWidth: boolean;
}

export interface SidecarDoc {
  version: typeof SCHEMA_VERSION;
  app: typeof APP_ID;
  pdf: { name: string; pageCount: number; fingerprint: string | null };
  savedAt: string | null;
  settings: {
    defaultFontSize: number;
    defaultColor: string;
    correctionColor: string;
    markSize: number;
    /** Line count for newly drawn answer areas. */
    areaLines: number;
    /**
     * Row spacing (PDF units) used by Enter / arrow keys outside areas: taken
     * from the last answer area drawn, resized or typed in. null = one text line.
     */
    lineSpacing: number | null;
  };
  answerKey: {
    answerStartPage: number | null;
    linked: boolean;
    mapping: AnswerMapping[];
  };
  view: {
    /** Last page / zoom of the main (top) pane. */
    lastPage: number;
    zoom: number;
    fitWidth: boolean;
    split: 'none' | 'horizontal' | 'vertical';
    splitRatio: number;
    secondPane: PaneView;
    sidebarOpen: boolean;
  };
  /** Keyed by 1-based page number. Pages without annotations are omitted. */
  pages: Record<string, PageAnnotations>;
}

export function createEmptyDoc(pdfName: string, pageCount: number, fingerprint: string | null): SidecarDoc {
  return {
    version: SCHEMA_VERSION,
    app: APP_ID,
    pdf: { name: pdfName, pageCount, fingerprint },
    savedAt: null,
    settings: {
      defaultFontSize: 11,
      defaultColor: '#1a4fd6',
      correctionColor: '#d11a2a',
      markSize: 14,
      areaLines: 2,
      lineSpacing: null,
    },
    answerKey: { answerStartPage: null, linked: false, mapping: [] },
    view: {
      lastPage: 1,
      zoom: 1,
      fitWidth: true,
      split: 'none',
      splitRatio: 0.5,
      secondPane: { page: 1, zoom: 1, fitWidth: true },
      sidebarOpen: true,
    },
    pages: {},
  };
}

export class SchemaError extends Error {}

export interface MigrateResult {
  doc: SidecarDoc;
  /** Non-fatal problems: entries that were dropped or repaired. */
  warnings: string[];
}

/**
 * Validates and upgrades a parsed sidecar to the current schema.
 * Throws SchemaError if the data is unusable (not ours, or from a newer app).
 * Individual malformed annotations are dropped with a warning rather than
 * failing the whole file.
 */
export function migrate(raw: unknown, pdfName: string, pageCount: number, fingerprint: string | null): MigrateResult {
  if (!isObj(raw)) throw new SchemaError('Annotations file is not a JSON object.');
  const version = raw.version;
  if (typeof version !== 'number') throw new SchemaError('Annotations file has no "version" field.');
  if (version > SCHEMA_VERSION) {
    throw new SchemaError(
      `Annotations file was written by a newer version of the app (schema v${version}; this app supports v${SCHEMA_VERSION}).`,
    );
  }
  // Future migrations go here: `if (version === 1) raw = v1ToV2(raw)` etc.
  if (version !== 1) throw new SchemaError(`Unsupported schema version ${version}.`);

  const warnings: string[] = [];
  const base = createEmptyDoc(pdfName, pageCount, fingerprint);
  const doc: SidecarDoc = base;

  const pdf = isObj(raw.pdf) ? raw.pdf : {};
  doc.pdf.fingerprint = fingerprint;
  if (typeof pdf.fingerprint === 'string' && fingerprint && pdf.fingerprint !== fingerprint) {
    warnings.push('The annotations were saved for a different version of this PDF; positions may not line up.');
  }
  doc.savedAt = typeof raw.savedAt === 'string' ? raw.savedAt : null;

  const s = isObj(raw.settings) ? raw.settings : {};
  doc.settings.defaultFontSize = num(s.defaultFontSize, base.settings.defaultFontSize, 4, 96);
  doc.settings.defaultColor = color(s.defaultColor, base.settings.defaultColor);
  doc.settings.correctionColor = color(s.correctionColor, base.settings.correctionColor);
  doc.settings.markSize = num(s.markSize, base.settings.markSize, 4, 96);
  doc.settings.areaLines = Math.round(num(s.areaLines, base.settings.areaLines, 1, MAX_AREA_LINES));
  doc.settings.lineSpacing = isNum(s.lineSpacing) && s.lineSpacing > 0 ? Math.min(500, s.lineSpacing) : null;

  const ak = isObj(raw.answerKey) ? raw.answerKey : {};
  doc.answerKey.answerStartPage =
    typeof ak.answerStartPage === 'number' ? clampPage(ak.answerStartPage, pageCount) : null;
  doc.answerKey.linked = ak.linked === true;
  if (Array.isArray(ak.mapping)) {
    for (const m of ak.mapping) {
      if (isObj(m) && isNum(m.fromPage) && isNum(m.toPage) && isNum(m.answerPage)) {
        const fromPage = clampPage(m.fromPage, pageCount);
        const toPage = clampPage(m.toPage, pageCount);
        doc.answerKey.mapping.push({
          fromPage: Math.min(fromPage, toPage),
          toPage: Math.max(fromPage, toPage),
          answerPage: clampPage(m.answerPage, pageCount),
        });
      } else {
        warnings.push('Dropped an invalid answer-key mapping entry.');
      }
    }
  }

  const v = isObj(raw.view) ? raw.view : {};
  doc.view.lastPage = isNum(v.lastPage) ? clampPage(v.lastPage, pageCount) : 1;
  doc.view.zoom = num(v.zoom, 1, 0.1, 10);
  doc.view.fitWidth = typeof v.fitWidth === 'boolean' ? v.fitWidth : base.view.fitWidth;
  doc.view.split = v.split === 'horizontal' || v.split === 'vertical' ? v.split : 'none';
  doc.view.splitRatio = num(v.splitRatio, 0.5, 0.1, 0.9);
  doc.view.sidebarOpen = typeof v.sidebarOpen === 'boolean' ? v.sidebarOpen : true;
  const sp = isObj(v.secondPane) ? v.secondPane : {};
  doc.view.secondPane = {
    page: isNum(sp.page) ? clampPage(sp.page, pageCount) : 1,
    zoom: num(sp.zoom, 1, 0.1, 10),
    fitWidth: typeof sp.fitWidth === 'boolean' ? sp.fitWidth : true,
  };

  const pages = isObj(raw.pages) ? raw.pages : {};
  for (const [key, value] of Object.entries(pages)) {
    const pageNo = Number(key);
    if (!Number.isInteger(pageNo) || pageNo < 1 || pageNo > pageCount) {
      warnings.push(`Dropped annotations for page "${key}", which does not exist in this PDF.`);
      continue;
    }
    if (!isObj(value)) continue;
    const pa: PageAnnotations = { texts: [], areas: [], marks: [] };
    for (const t of arr(value.texts)) {
      const tb = parseText(t);
      if (tb) pa.texts.push(tb);
      else warnings.push(`Dropped an invalid text box on page ${pageNo}.`);
    }
    for (const a of arr(value.areas)) {
      const area = parseArea(a);
      if (area) pa.areas.push(area);
      else warnings.push(`Dropped an invalid answer area on page ${pageNo}.`);
    }
    for (const m of arr(value.marks)) {
      const mark = parseMark(m);
      if (mark) pa.marks.push(mark);
      else warnings.push(`Dropped an invalid mark on page ${pageNo}.`);
    }
    if (pa.texts.length || pa.areas.length || pa.marks.length) doc.pages[String(pageNo)] = pa;
  }

  return { doc, warnings };
}

function parseText(t: unknown): TextBox | null {
  if (!isObj(t) || typeof t.id !== 'string' || !isNum(t.x) || !isNum(t.y) || typeof t.text !== 'string') return null;
  const tb: TextBox = {
    id: t.id,
    kind: t.kind === 'correction' ? 'correction' : 'text',
    x: t.x,
    y: t.y,
    width: isNum(t.width) && t.width > 0 ? t.width : null,
    fontSize: num(t.fontSize, 11, 4, 96),
    color: color(t.color, '#000000'),
    text: t.text,
  };
  if (typeof t.areaId === 'string') tb.areaId = t.areaId;
  if (isNum(t.lineIndex)) tb.lineIndex = Math.max(0, Math.round(t.lineIndex));
  if (typeof t.markId === 'string') tb.markId = t.markId;
  return tb;
}

function parseArea(a: unknown): AnswerArea | null {
  if (!isObj(a) || typeof a.id !== 'string') return null;
  if (!isNum(a.x) || !isNum(a.y) || !isNum(a.width) || !isNum(a.height)) return null;
  if (a.width <= 0 || a.height <= 0) return null;
  return {
    id: a.id,
    x: a.x,
    y: a.y,
    width: a.width,
    height: a.height,
    lines: Math.round(num(a.lines, 1, 1, MAX_AREA_LINES)),
    fontSize: num(a.fontSize, 11, 4, 96),
  };
}

function parseMark(m: unknown): Mark | null {
  if (!isObj(m) || typeof m.id !== 'string' || !isNum(m.x) || !isNum(m.y)) return null;
  if (m.kind !== 'check' && m.kind !== 'cross') return null;
  return { id: m.id, kind: m.kind, x: m.x, y: m.y, size: num(m.size, 14, 4, 96) };
}

type Obj = Record<string, unknown>;
function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function num(v: unknown, fallback: number, min: number, max: number): number {
  return isNum(v) ? Math.min(max, Math.max(min, v)) : fallback;
}
function color(v: unknown, fallback: string): string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : fallback;
}
function clampPage(p: number, pageCount: number): number {
  return Math.min(Math.max(1, Math.round(p)), Math.max(1, pageCount));
}
