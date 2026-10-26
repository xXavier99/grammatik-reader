// Exercise page → answer page mapping (pure).
//
// The mapping is a list of ranges "exercise pages from–to → answer page".
// Ranges may be edited by hand, so they can overlap; the narrowest range
// covering a page wins.

import type { AnswerMapping } from './schema';

/** Answer page for an exercise page, or null when unmapped. */
export function lookupAnswerPage(mapping: AnswerMapping[], page: number): number | null {
  let best: AnswerMapping | null = null;
  for (const m of mapping) {
    if (page < m.fromPage || page > m.toPage) continue;
    if (!best || m.toPage - m.fromPage < best.toPage - best.fromPage) best = m;
  }
  return best ? best.answerPage : null;
}

/** Sorts by first page and merges adjacent/overlapping ranges with the same answer page. */
export function normalizeMapping(mapping: AnswerMapping[]): AnswerMapping[] {
  const sorted = mapping
    .map((m) => ({ fromPage: Math.min(m.fromPage, m.toPage), toPage: Math.max(m.fromPage, m.toPage), answerPage: m.answerPage }))
    .sort((a, b) => a.fromPage - b.fromPage || a.toPage - b.toPage);
  const out: AnswerMapping[] = [];
  for (const m of sorted) {
    const last = out[out.length - 1];
    if (last && last.answerPage === m.answerPage && m.fromPage <= last.toPage + 1) {
      last.toPage = Math.max(last.toPage, m.toPage);
    } else out.push({ ...m });
  }
  return out;
}

/**
 * Maps a single exercise page to an answer page (the "map current pages"
 * shortcut): the page is carved out of any range that covered it, then
 * neighbours pointing to the same answer page are merged, so mapping pages
 * 10, 11, 12 → 43 one by one yields a single "10–12 → 43" row.
 */
export function setPageMapping(mapping: AnswerMapping[], page: number, answerPage: number): AnswerMapping[] {
  const out: AnswerMapping[] = [];
  for (const m of mapping) {
    if (page < m.fromPage || page > m.toPage) {
      out.push({ ...m });
      continue;
    }
    if (m.fromPage < page) out.push({ ...m, toPage: page - 1 });
    if (m.toPage > page) out.push({ ...m, fromPage: page + 1 });
  }
  out.push({ fromPage: page, toPage: page, answerPage });
  return normalizeMapping(out);
}
