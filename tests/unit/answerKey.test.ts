import { describe, expect, it } from 'vitest';
import { lookupAnswerPage, normalizeMapping, setPageMapping } from '../../src/model/answerKey';

describe('answer key mapping', () => {
  it('looks up pages, returning null when unmapped', () => {
    const m = [{ fromPage: 10, toPage: 12, answerPage: 43 }];
    expect(lookupAnswerPage(m, 9)).toBeNull();
    expect(lookupAnswerPage(m, 10)).toBe(43);
    expect(lookupAnswerPage(m, 12)).toBe(43);
    expect(lookupAnswerPage(m, 13)).toBeNull();
    expect(lookupAnswerPage([], 1)).toBeNull();
  });

  it('prefers the narrowest overlapping range', () => {
    const m = [
      { fromPage: 1, toPage: 40, answerPage: 41 },
      { fromPage: 10, toPage: 12, answerPage: 43 },
    ];
    expect(lookupAnswerPage(m, 5)).toBe(41);
    expect(lookupAnswerPage(m, 11)).toBe(43);
  });

  it('builds ranges when mapping consecutive pages one by one', () => {
    let m = setPageMapping([], 10, 43);
    m = setPageMapping(m, 11, 43);
    m = setPageMapping(m, 12, 43);
    m = setPageMapping(m, 13, 44);
    expect(m).toEqual([
      { fromPage: 10, toPage: 12, answerPage: 43 },
      { fromPage: 13, toPage: 13, answerPage: 44 },
    ]);
  });

  it('remaps a page inside a range by splitting it', () => {
    const m = setPageMapping([{ fromPage: 10, toPage: 14, answerPage: 43 }], 12, 50);
    expect(m).toEqual([
      { fromPage: 10, toPage: 11, answerPage: 43 },
      { fromPage: 12, toPage: 12, answerPage: 50 },
      { fromPage: 13, toPage: 14, answerPage: 43 },
    ]);
    // Mapping it back joins the pieces again.
    expect(setPageMapping(m, 12, 43)).toEqual([{ fromPage: 10, toPage: 14, answerPage: 43 }]);
  });

  it('normalizes reversed ranges and sorts', () => {
    expect(normalizeMapping([
      { fromPage: 20, toPage: 18, answerPage: 45 },
      { fromPage: 1, toPage: 2, answerPage: 41 },
    ])).toEqual([
      { fromPage: 1, toPage: 2, answerPage: 41 },
      { fromPage: 18, toPage: 20, answerPage: 45 },
    ]);
  });
});
