/**
 * caseFileModels.test.js — unit tests for GameCaseFile, GameCaseFileChapter,
 * and GameSessionCaseFileResult Mongoose models.
 */

process.env.JWT_SECRET = 'test_secret';

const db = require('../helpers/setupDb');
const GameCaseFile = require('../../models/GameCaseFile');
const GameCaseFileChapter = require('../../models/GameCaseFileChapter');
const GameSessionCaseFileResult = require('../../models/GameSessionCaseFileResult');
const mongoose = require('mongoose');

beforeAll(async () => { await db.connect(); });
afterEach(async ()  => db.clearDatabase());
afterAll(async ()   => db.closeDatabase());

// ── GameCaseFile ──────────────────────────────────────────────────────────────

describe('GameCaseFile', () => {
  it('rejects a document without slug', async () => {
    const doc = new GameCaseFile({
      title: 'Russia / Ukraine',
      affairLabel: 'Road to Invasion',
      summary: 'A summary.',
    });
    await expect(doc.save()).rejects.toThrow(/slug/i);
  });

  it('rejects a document without title', async () => {
    const doc = new GameCaseFile({
      slug: 'russia-ukraine',
      affairLabel: 'Road to Invasion',
      summary: 'A summary.',
    });
    await expect(doc.save()).rejects.toThrow(/title/i);
  });

  it('rejects a document without affairLabel', async () => {
    const doc = new GameCaseFile({
      slug: 'russia-ukraine',
      title: 'Russia / Ukraine',
      summary: 'A summary.',
    });
    await expect(doc.save()).rejects.toThrow(/affairLabel/i);
  });

  it('rejects a document without summary', async () => {
    const doc = new GameCaseFile({
      slug: 'russia-ukraine',
      title: 'Russia / Ukraine',
      affairLabel: 'Road to Invasion',
    });
    await expect(doc.save()).rejects.toThrow(/summary/i);
  });

  it('rejects an invalid status value', async () => {
    const doc = new GameCaseFile({
      slug: 'russia-ukraine',
      title: 'Russia / Ukraine',
      affairLabel: 'Road to Invasion',
      summary: 'A summary.',
      status: 'archived', // not in enum
    });
    await expect(doc.save()).rejects.toThrow();
  });

  it('saves a valid document with defaults', async () => {
    const doc = await GameCaseFile.create({
      slug: 'russia-ukraine',
      title: 'Russia / Ukraine',
      affairLabel: 'Road to Invasion',
      summary: 'Overview of events leading to the 2022 invasion.',
    });
    expect(doc._id).toBeDefined();
    expect(doc.status).toBe('draft');
    expect(doc.tags).toEqual([]);
    expect(doc.chapterSlugs).toEqual([]);
    expect(doc.createdAt).toBeInstanceOf(Date);
  });

  it('saves optional fields: coverImageUrl, tags, chapterSlugs, status', async () => {
    const doc = await GameCaseFile.create({
      slug: 'russia-ukraine-full',
      title: 'Russia / Ukraine',
      affairLabel: 'Road to Invasion',
      summary: 'A summary.',
      coverImageUrl: 'https://example.com/cover.jpg',
      status: 'published',
      tags: ['europe', 'nato', 'conflict'],
      chapterSlugs: ['ch-1-buildup', 'ch-2-invasion'],
    });
    expect(doc.status).toBe('published');
    expect(doc.tags).toEqual(['europe', 'nato', 'conflict']);
    expect(doc.chapterSlugs).toHaveLength(2);
  });

  it('enforces unique slug', async () => {
    await GameCaseFile.create({
      slug: 'dup-slug',
      title: 'First',
      affairLabel: 'Affair',
      summary: 'Summary.',
    });
    await expect(
      GameCaseFile.create({
        slug: 'dup-slug',
        title: 'Second',
        affairLabel: 'Affair',
        summary: 'Summary.',
      })
    ).rejects.toThrow();
  });
});

// ── GameCaseFileChapter ───────────────────────────────────────────────────────

// Minimal valid stage payloads for each of the 8 stage types
const stageFixtures = {
  cold_open: {
    id: 'stage_co_1',
    type: 'cold_open',
    payload: {
      dateLabel: 'Sept 2021',
      directorBriefing: 'Analyse intelligence...',
      startingItems: [{ id: 'item_1', title: 'SIGINT Report', oneLineHint: 'Watch troop movements' }],
    },
  },
  evidence_wall: {
    id: 'stage_ew_1',
    type: 'evidence_wall',
    payload: {
      phaseLabel: 'Phase 1',
      items: [
        { id: 'ev_1', title: 'Satellite Image', type: 'satellite', description: 'Troop build-up near border.' },
      ],
    },
    scoring: { signalWeights: { ev_1: 0.9 }, validConnectionPairs: [], maxScore: 100 },
  },
  map_predictive: {
    id: 'stage_mp_1',
    type: 'map_predictive',
    payload: {
      mapBounds: { south: 44.0, west: 22.0, north: 52.5, east: 40.0 },
      hotspots: [{ id: 'hs_kyiv', label: 'Kyiv', lat: 50.45, lng: 30.52, kind: 'capital' }],
      tokenCount: 5,
      prompt: 'Place invasion axes on the map.',
    },
    scoring: { correctAxes: [{ fromHotspotId: 'hs_border', toHotspotId: 'hs_kyiv', isMain: true }], maxScore: 80 },
  },
  actor_interrogations: {
    id: 'stage_ai_1',
    type: 'actor_interrogations',
    payload: {
      actors: [
        { id: 'actor_putin', name: 'Vladimir Putin', role: 'President', faction: 'Russia', systemPromptKey: 'putin_2021' },
      ],
      relationships: [],
      maxQuestionsPerActor: 3,
      contextDateLabel: 'Nov 2021',
    },
    scoring: { baseEngagementScore: 10, signalKeywords: ['troops', 'nato'], maxScore: 50 },
  },
  decision_point: {
    id: 'stage_dp_1',
    type: 'decision_point',
    payload: {
      prompt: 'What will Russia do next?',
      contextDateLabel: 'Jan 2022',
      options: [
        { id: 'opt_a', text: 'Full-scale invasion', hint: 'Consider troop numbers.' },
        { id: 'opt_b', text: 'Limited incursion' },
      ],
    },
    scoring: { optionRealityScores: { opt_a: 90, opt_b: 40 }, maxScore: 100 },
  },
  phase_reveal: {
    id: 'stage_pr_1',
    type: 'phase_reveal',
    payload: {
      newPhaseLabel: 'Phase 2 — Escalation',
      newItems: [],
      connectionResolutions: [],
    },
    scoring: { maxScore: 60 },
  },
  map_live: {
    id: 'stage_ml_1',
    type: 'map_live',
    payload: {
      mapBounds: { south: 44.0, west: 22.0, north: 52.5, east: 40.0 },
      hotspots: [{ id: 'hs_kyiv', label: 'Kyiv', lat: 50.45, lng: 30.52, kind: 'capital' }],
      phases: [
        {
          id: 'phase_1',
          timeLabel: 'Day 1',
          units: [
            { side: 'ru', kind: 'armour', fromHotspotId: 'hs_border', toHotspotId: 'hs_kyiv', animationMs: 2000 },
          ],
          subDecision: null,
        },
      ],
    },
    scoring: { subDecisionAnswers: {} },
  },
  debrief: {
    id: 'stage_db_1',
    type: 'debrief',
    payload: {
      annotatedReplayBeats: [
        { refStageIndex: 0, headline: 'Cold Open', body: 'You received intelligence...', takeaway: 'Context matters.' },
      ],
      teaserNextChapter: null,
    },
  },
};

function validChapter(overrides = {}) {
  return {
    caseSlug: 'russia-ukraine',
    chapterSlug: 'ch-1-buildup',
    chapterNumber: 1,
    title: 'The Buildup',
    dateRangeLabel: 'Sept 2021 – Feb 24 2022',
    summary: 'Chapter summary.',
    stages: [stageFixtures.cold_open],
    ...overrides,
  };
}

describe('GameCaseFileChapter', () => {
  it('rejects without caseSlug', async () => {
    const data = validChapter({ caseSlug: undefined });
    await expect(GameCaseFileChapter.create(data)).rejects.toThrow(/caseSlug/i);
  });

  it('rejects without chapterSlug', async () => {
    const data = validChapter({ chapterSlug: undefined });
    await expect(GameCaseFileChapter.create(data)).rejects.toThrow(/chapterSlug/i);
  });

  it('rejects without title', async () => {
    const data = validChapter({ title: undefined });
    await expect(GameCaseFileChapter.create(data)).rejects.toThrow(/title/i);
  });

  it('rejects without dateRangeLabel', async () => {
    const data = validChapter({ dateRangeLabel: undefined });
    await expect(GameCaseFileChapter.create(data)).rejects.toThrow(/dateRangeLabel/i);
  });

  it('rejects without summary', async () => {
    const data = validChapter({ summary: undefined });
    await expect(GameCaseFileChapter.create(data)).rejects.toThrow(/summary/i);
  });

  it('rejects chapterNumber below min (< 1)', async () => {
    const data = validChapter({ chapterNumber: 0 });
    await expect(GameCaseFileChapter.create(data)).rejects.toThrow();
  });

  it('rejects a stage with an invalid type', async () => {
    const data = validChapter({
      stages: [{ id: 'stage_bad', type: 'unknown_type', payload: {} }],
    });
    await expect(GameCaseFileChapter.create(data)).rejects.toThrow();
  });

  it('enforces compound unique index on (caseSlug, chapterSlug)', async () => {
    await GameCaseFileChapter.create(validChapter());
    await expect(GameCaseFileChapter.create(validChapter())).rejects.toThrow();
  });

  it('allows same chapterSlug for different caseSlugs', async () => {
    await GameCaseFileChapter.create(validChapter({ caseSlug: 'case-a' }));
    const doc = await GameCaseFileChapter.create(validChapter({ caseSlug: 'case-b' }));
    expect(doc._id).toBeDefined();
  });

  it('saves with defaults (estimatedMinutes, status)', async () => {
    const doc = await GameCaseFileChapter.create(validChapter());
    expect(doc.estimatedMinutes).toBe(35);
    expect(doc.status).toBe('draft');
    expect(doc.createdAt).toBeInstanceOf(Date);
  });

  // One test per stage type — verifies the enum accepts the type value
  const stageTypes = Object.keys(stageFixtures);

  stageTypes.forEach((stageType) => {
    it(`accepts a stage of type "${stageType}"`, async () => {
      const doc = await GameCaseFileChapter.create(
        validChapter({
          chapterSlug: `ch-${stageType}`,
          stages: [stageFixtures[stageType]],
        })
      );
      expect(doc.stages).toHaveLength(1);
      expect(doc.stages[0].type).toBe(stageType);
    });
  });

  it('accepts a chapter with all 8 stage types embedded', async () => {
    const allStages = stageTypes.map((t) => stageFixtures[t]);
    const doc = await GameCaseFileChapter.create(
      validChapter({ chapterSlug: 'ch-all-stages', stages: allStages })
    );
    expect(doc.stages).toHaveLength(8);
  });
});

// ── GameSessionCaseFileResult ─────────────────────────────────────────────────

describe('GameSessionCaseFileResult', () => {
  let userId;

  beforeEach(() => {
    userId = new mongoose.Types.ObjectId();
  });

  function validSession(overrides = {}) {
    return {
      userId,
      caseSlug: 'russia-ukraine',
      chapterSlug: 'ch-1-buildup',
      ...overrides,
    };
  }

  it('rejects without userId', async () => {
    await expect(
      GameSessionCaseFileResult.create({ caseSlug: 'x', chapterSlug: 'y' })
    ).rejects.toThrow(/userId/i);
  });

  it('creates with correct defaults', async () => {
    const doc = await GameSessionCaseFileResult.create(validSession());
    expect(doc.currentStageIndex).toBe(0);
    expect(doc.abandoned).toBe(false);
    expect(doc.completedAt).toBeNull();
    expect(doc.scoring).toBeNull();
    expect(doc.stageResults).toEqual([]);
    expect(doc.startedAt).toBeInstanceOf(Date);
    expect(doc.createdAt).toBeInstanceOf(Date);
  });

  it('stores stageResults with mixed payload', async () => {
    const doc = await GameSessionCaseFileResult.create(
      validSession({
        stageResults: [
          {
            stageIndex: 0,
            stageType: 'cold_open',
            submittedAt: new Date(),
            payload: { acknowledged: true },
          },
          {
            stageIndex: 1,
            stageType: 'evidence_wall',
            submittedAt: new Date(),
            payload: { selectedConnectionPairs: [['ev_1', 'ev_2']], highlightedIds: ['ev_1'] },
          },
        ],
      })
    );
    expect(doc.stageResults).toHaveLength(2);
    expect(doc.stageResults[0].stageType).toBe('cold_open');
  });

  it('stores scoring when completedAt is set', async () => {
    const now = new Date();
    const doc = await GameSessionCaseFileResult.create(
      validSession({
        completedAt: now,
        currentStageIndex: 8,
        scoring: {
          totalScore: 420,
          breakdown: [
            { stageIndex: 0, stageType: 'cold_open', score: 0, maxScore: 0, notes: 'N/A' },
            { stageIndex: 1, stageType: 'evidence_wall', score: 80, maxScore: 100, notes: 'Good' },
          ],
          airstarsAwarded: 42,
          levelXpAwarded: 100,
        },
      })
    );
    expect(doc.completedAt).toEqual(now);
    expect(doc.scoring.totalScore).toBe(420);
    expect(doc.scoring.breakdown).toHaveLength(2);
    expect(doc.scoring.airstarsAwarded).toBe(42);
  });

  it('completedAt is nullable (null by default, can be set later)', async () => {
    const doc = await GameSessionCaseFileResult.create(validSession());
    expect(doc.completedAt).toBeNull();

    doc.completedAt = new Date();
    await doc.save();

    const reloaded = await GameSessionCaseFileResult.findById(doc._id);
    expect(reloaded.completedAt).toBeInstanceOf(Date);
  });

  it('can mark a session as abandoned', async () => {
    const doc = await GameSessionCaseFileResult.create(validSession({ abandoned: true }));
    expect(doc.abandoned).toBe(true);
  });

  it('rejects currentStageIndex below min (< 0)', async () => {
    await expect(
      GameSessionCaseFileResult.create(validSession({ currentStageIndex: -1 }))
    ).rejects.toThrow();
  });

  it('allows multiple sessions for the same user × chapter (no unique constraint)', async () => {
    await GameSessionCaseFileResult.create(validSession());
    const second = await GameSessionCaseFileResult.create(validSession());
    expect(second._id).toBeDefined();
  });

  // ── interrogationTranscripts field ────────────────────────────────────────
  it('interrogationTranscripts defaults to empty array', async () => {
    const doc = await GameSessionCaseFileResult.create(validSession());
    expect(Array.isArray(doc.interrogationTranscripts)).toBe(true);
    expect(doc.interrogationTranscripts).toHaveLength(0);
  });

  it('interrogationTranscripts accepts a valid entry', async () => {
    const doc = await GameSessionCaseFileResult.create(
      validSession({
        interrogationTranscripts: [
          {
            stageIndex: 2,
            actorId:    'actor_lavrov',
            q:          'What are Russia\'s red lines?',
            a:          'I would simply remind you...',
            askedAt:    new Date('2022-01-01'),
          },
        ],
      })
    );
    expect(doc.interrogationTranscripts).toHaveLength(1);
    expect(doc.interrogationTranscripts[0].stageIndex).toBe(2);
    expect(doc.interrogationTranscripts[0].actorId).toBe('actor_lavrov');
    expect(doc.interrogationTranscripts[0].q).toBeDefined();
    expect(doc.interrogationTranscripts[0].a).toBeDefined();
    expect(doc.interrogationTranscripts[0].askedAt).toBeInstanceOf(Date);
  });

  it('interrogationTranscripts can hold multiple entries across stages and actors', async () => {
    const doc = await GameSessionCaseFileResult.create(
      validSession({
        interrogationTranscripts: [
          { stageIndex: 2, actorId: 'actor_lavrov', q: 'Q1', a: 'A1' },
          { stageIndex: 2, actorId: 'actor_putin',  q: 'Q2', a: 'A2' },
          { stageIndex: 4, actorId: 'actor_lavrov', q: 'Q3', a: 'A3' },
        ],
      })
    );
    expect(doc.interrogationTranscripts).toHaveLength(3);
    // Filtering by stageIndex works correctly
    const stage2 = doc.interrogationTranscripts.filter(t => t.stageIndex === 2);
    expect(stage2).toHaveLength(2);
  });

  it('interrogationTranscripts entries default askedAt to current time', async () => {
    const before = new Date();
    const doc = await GameSessionCaseFileResult.create(
      validSession({
        interrogationTranscripts: [
          { stageIndex: 0, actorId: 'actor_x', q: 'Question?', a: 'Answer.' },
        ],
      })
    );
    const after = new Date();
    const ts = doc.interrogationTranscripts[0].askedAt;
    expect(ts.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(ts.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });
});
