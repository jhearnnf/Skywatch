'use strict';

const { sanitizeChapter, sanitizeChapterForList } = require('../../utils/caseFileSanitize');

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeFullChapter() {
  return {
    slug:             'op-sandstorm-ch1',
    chapterSlug:      'op-sandstorm',
    chapterNumber:    1,
    title:            'Operation Sandstorm — Chapter 1',
    dateRangeLabel:   '14–21 Apr 2026',
    summary:          'A brief summary of the chapter.',
    estimatedMinutes: 25,
    status:           'published',
    // top-level scoring field — forward-proofing defensive strip
    scoring: { masterKey: 'secret-top-level' },
    stages: [
      {
        id:      's0',
        type:    'cold_open',
        payload: { intro: 'text' },
        scoring: { secret: 'cold_open_key' },
      },
      {
        id:      's1',
        type:    'evidence_wall',
        payload: { items: ['A', 'B', 'C'] },
        scoring: {
          validConnectionPairs: [['A','B']],
          signalWeights:        { A: 1, B: 1 },
          masterKeys:           ['top-secret'],
        },
      },
      {
        id:      's2',
        type:    'decision_point',
        payload: { options: ['OPT1', 'OPT2'] },
        scoring: { optionRealityScores: { OPT1: 80 } },
      },
    ],
  };
}

// ── sanitizeChapter ───────────────────────────────────────────────────────────

describe('sanitizeChapter', () => {
  it('does not mutate the original chapter', () => {
    const original = makeFullChapter();
    const clone    = JSON.parse(JSON.stringify(original)); // deep snapshot
    sanitizeChapter(original);
    expect(original).toEqual(clone);
  });

  it('removes scoring from every stage', () => {
    const result = sanitizeChapter(makeFullChapter());
    for (const stage of result.stages) {
      expect(stage).not.toHaveProperty('scoring');
    }
  });

  it('removes top-level scoring field (defensive forward-proofing)', () => {
    const result = sanitizeChapter(makeFullChapter());
    expect(result).not.toHaveProperty('scoring');
  });

  it('preserves all other stage fields', () => {
    const chapter = makeFullChapter();
    const result  = sanitizeChapter(chapter);
    const stage1  = result.stages[1]; // evidence_wall
    expect(stage1.id).toBe('s1');
    expect(stage1.type).toBe('evidence_wall');
    expect(stage1.payload).toEqual({ items: ['A', 'B', 'C'] });
  });

  it('preserves all other chapter-level fields', () => {
    const chapter = makeFullChapter();
    const result  = sanitizeChapter(chapter);
    expect(result.slug).toBe(chapter.slug);
    expect(result.chapterSlug).toBe(chapter.chapterSlug);
    expect(result.chapterNumber).toBe(chapter.chapterNumber);
    expect(result.title).toBe(chapter.title);
    expect(result.dateRangeLabel).toBe(chapter.dateRangeLabel);
    expect(result.summary).toBe(chapter.summary);
    expect(result.estimatedMinutes).toBe(chapter.estimatedMinutes);
    expect(result.status).toBe(chapter.status);
  });

  it('returns a new object (not the same reference)', () => {
    const chapter = makeFullChapter();
    const result  = sanitizeChapter(chapter);
    expect(result).not.toBe(chapter);
  });

  it('stage objects are new references (not mutating original stage objects)', () => {
    const chapter = makeFullChapter();
    const result  = sanitizeChapter(chapter);
    result.stages.forEach((stage, i) => {
      expect(stage).not.toBe(chapter.stages[i]);
    });
  });

  it('handles chapter with no stages gracefully', () => {
    const chapter = { slug: 'test', stages: [] };
    const result  = sanitizeChapter(chapter);
    expect(result.stages).toEqual([]);
    expect(result.slug).toBe('test');
  });

  it('handles null/undefined chapter without throwing', () => {
    expect(sanitizeChapter(null)).toBeNull();
    expect(sanitizeChapter(undefined)).toBeUndefined();
  });
});

// ── sanitizeChapterForList ────────────────────────────────────────────────────

describe('sanitizeChapterForList', () => {
  it('returns only the listed fields', () => {
    const chapter = makeFullChapter();
    const result  = sanitizeChapterForList(chapter);
    const allowedKeys = new Set([
      'slug', 'chapterSlug', 'chapterNumber', 'title',
      'dateRangeLabel', 'summary', 'estimatedMinutes', 'status', 'stageCount',
    ]);
    for (const key of Object.keys(result)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
  });

  it('stageCount equals the number of stages in the original', () => {
    const chapter = makeFullChapter();
    const result  = sanitizeChapterForList(chapter);
    expect(result.stageCount).toBe(chapter.stages.length);
  });

  it('omits stages array, scoring, and any extra fields', () => {
    const result = sanitizeChapterForList(makeFullChapter());
    expect(result).not.toHaveProperty('stages');
    expect(result).not.toHaveProperty('scoring');
  });

  it('maps all listed fields correctly', () => {
    const chapter = makeFullChapter();
    const result  = sanitizeChapterForList(chapter);
    expect(result.slug).toBe(chapter.slug);
    expect(result.chapterSlug).toBe(chapter.chapterSlug);
    expect(result.chapterNumber).toBe(chapter.chapterNumber);
    expect(result.title).toBe(chapter.title);
    expect(result.dateRangeLabel).toBe(chapter.dateRangeLabel);
    expect(result.summary).toBe(chapter.summary);
    expect(result.estimatedMinutes).toBe(chapter.estimatedMinutes);
    expect(result.status).toBe(chapter.status);
    expect(result.stageCount).toBe(3);
  });

  it('does not mutate the original chapter', () => {
    const chapter = makeFullChapter();
    const clone   = JSON.parse(JSON.stringify(chapter));
    sanitizeChapterForList(chapter);
    expect(chapter).toEqual(clone);
  });

  it('handles null/undefined chapter without throwing', () => {
    expect(sanitizeChapterForList(null)).toBeNull();
    expect(sanitizeChapterForList(undefined)).toBeUndefined();
  });

  it('uses chapter.stageCount as fallback when stages is not an array', () => {
    const chapter = {
      slug: 'test', chapterSlug: 'ch', chapterNumber: 1, title: 'T',
      dateRangeLabel: '1–2 Jan', summary: 'S', estimatedMinutes: 10,
      status: 'draft', stageCount: 7,
      // no .stages array
    };
    const result = sanitizeChapterForList(chapter);
    expect(result.stageCount).toBe(7);
  });
});
