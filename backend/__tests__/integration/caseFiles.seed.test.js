'use strict';

/**
 * caseFiles.seed.test.js
 *
 * Integration tests for the russia-ukraine/road-to-invasion chapter seed.
 *
 * Coverage:
 *   1. JSON parses without throwing
 *   2. Top-level required fields are present
 *   3. All 8 stages are present in the correct type order
 *   4. Cross-reference integrity: every ID referenced in scoring structures
 *      (validConnectionPairs, optionSupportingEvidenceIds, correctAxes,
 *      subDecisionAnswers correctOptionIds) maps to an actual item/hotspot/option
 *      defined elsewhere in the chapter
 *   5. seedCaseFiles() upserts case files + chapter against an in-memory MongoDB
 *   6. Re-running the seeder is idempotent (no duplicates)
 */

const fs   = require('fs');
const path = require('path');

const db              = require('../helpers/setupDb');
const GameCaseFile    = require('../../models/GameCaseFile');
const GameCaseFileChapter = require('../../models/GameCaseFileChapter');
const seedCaseFiles   = require('../../seeds/caseFiles');

// ── Paths ──────────────────────────────────────────────────────────────────────

const CHAPTER_JSON_PATH = path.join(
  __dirname,
  '../../seeds/caseFiles/russia-ukraine/road-to-invasion.json'
);

// ── Load the JSON once for structural tests ───────────────────────────────────

let chapter;

beforeAll(async () => {
  await db.connect();
  const raw = fs.readFileSync(CHAPTER_JSON_PATH, 'utf-8');
  chapter = JSON.parse(raw);
});

afterAll(async () => db.closeDatabase());

afterEach(async () => db.clearDatabase());

// ─────────────────────────────────────────────────────────────────────────────
// 1. JSON validity
// ─────────────────────────────────────────────────────────────────────────────

describe('road-to-invasion.json — parse + required fields', () => {
  it('parses as valid JSON without throwing', () => {
    expect(() =>
      JSON.parse(fs.readFileSync(CHAPTER_JSON_PATH, 'utf-8'))
    ).not.toThrow();
  });

  it('has all required chapter-level fields (minus caseSlug — added by seeder)', () => {
    expect(typeof chapter.chapterSlug).toBe('string');
    expect(chapter.chapterSlug.length).toBeGreaterThan(0);
    expect(typeof chapter.chapterNumber).toBe('number');
    expect(chapter.chapterNumber).toBeGreaterThanOrEqual(1);
    expect(typeof chapter.title).toBe('string');
    expect(typeof chapter.dateRangeLabel).toBe('string');
    expect(typeof chapter.summary).toBe('string');
    expect(Array.isArray(chapter.stages)).toBe(true);
  });

  it('has estimatedMinutes as a positive integer', () => {
    expect(typeof chapter.estimatedMinutes).toBe('number');
    expect(chapter.estimatedMinutes).toBeGreaterThan(0);
  });

  it('status is "published"', () => {
    expect(chapter.status).toBe('published');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Stage count and order
// ─────────────────────────────────────────────────────────────────────────────

describe('road-to-invasion.json — stage count and type order', () => {
  const EXPECTED_TYPES = [
    'cold_open',
    'evidence_wall',
    'map_predictive',
    'actor_interrogations',
    'decision_point',
    'phase_reveal',
    'map_live',
    'debrief',
  ];

  it('has exactly 8 stages', () => {
    expect(chapter.stages).toHaveLength(8);
  });

  EXPECTED_TYPES.forEach((expectedType, i) => {
    it(`stage[${i}] has type "${expectedType}"`, () => {
      expect(chapter.stages[i].type).toBe(expectedType);
    });
  });

  it('every stage has a non-empty id and a payload object', () => {
    chapter.stages.forEach((stage, i) => {
      expect(typeof stage.id).toBe('string');
      expect(stage.id.length).toBeGreaterThan(0);
      expect(typeof stage.payload).toBe('object');
      expect(stage.payload).not.toBeNull();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Cross-reference integrity
// ─────────────────────────────────────────────────────────────────────────────

describe('road-to-invasion.json — cross-reference integrity', () => {
  // Helper: collect all evidence item IDs from evidence_wall and phase_reveal
  function allEvidenceIds() {
    const ids = new Set();
    for (const stage of chapter.stages) {
      if (stage.type === 'evidence_wall') {
        (stage.payload.items || []).forEach(item => ids.add(item.id));
      }
      if (stage.type === 'phase_reveal') {
        (stage.payload.newItems || []).forEach(item => ids.add(item.id));
      }
    }
    return ids;
  }

  // Helper: collect all hotspot IDs from map_predictive and map_live
  function allHotspotIds() {
    const ids = new Set();
    for (const stage of chapter.stages) {
      if (stage.type === 'map_predictive' || stage.type === 'map_live') {
        (stage.payload.hotspots || []).forEach(hs => ids.add(hs.id));
      }
    }
    return ids;
  }

  // Helper: collect all option IDs from decision_point
  function allDecisionOptionIds() {
    const ids = new Set();
    for (const stage of chapter.stages) {
      if (stage.type === 'decision_point') {
        (stage.payload.options || []).forEach(opt => ids.add(opt.id));
      }
    }
    return ids;
  }

  // Helper: collect all sub-decision option IDs from map_live
  function allSubDecisionOptionIds() {
    const ids = new Set();
    for (const stage of chapter.stages) {
      if (stage.type === 'map_live') {
        for (const phase of stage.payload.phases || []) {
          if (phase.subDecision) {
            (phase.subDecision.options || []).forEach(opt => ids.add(opt.id));
          }
        }
      }
    }
    return ids;
  }

  it('every ID in evidence_wall signalWeights exists in evidence_wall items', () => {
    const evidenceWall = chapter.stages.find(s => s.type === 'evidence_wall');
    expect(evidenceWall).toBeDefined();
    const itemIds = new Set(evidenceWall.payload.items.map(i => i.id));
    const weights = evidenceWall.scoring.signalWeights || {};
    Object.keys(weights).forEach(id => {
      expect(itemIds).toContain(id);
    });
  });

  it('every pair in evidence_wall validConnectionPairs references existing evidence item IDs', () => {
    const evidenceWall = chapter.stages.find(s => s.type === 'evidence_wall');
    const itemIds = new Set(evidenceWall.payload.items.map(i => i.id));
    const pairs = evidenceWall.scoring.validConnectionPairs || [];
    pairs.forEach(([a, b]) => {
      expect(itemIds).toContain(a);
      expect(itemIds).toContain(b);
    });
  });

  it('every ID in decision_point optionSupportingEvidenceIds exists across evidence items', () => {
    const dp = chapter.stages.find(s => s.type === 'decision_point');
    expect(dp).toBeDefined();
    const evidenceIds = allEvidenceIds();
    const supportMap = dp.scoring.optionSupportingEvidenceIds || {};
    Object.values(supportMap).flat().forEach(id => {
      expect(evidenceIds).toContain(id);
    });
  });

  it('every option key in optionRealityScores exists as a decision_point option', () => {
    const dp = chapter.stages.find(s => s.type === 'decision_point');
    const optionIds = new Set((dp.payload.options || []).map(o => o.id));
    const scores = dp.scoring.optionRealityScores || {};
    Object.keys(scores).forEach(id => {
      expect(optionIds).toContain(id);
    });
  });

  it('every correctAxes hotspot ID exists in the map_predictive hotspots', () => {
    const mp = chapter.stages.find(s => s.type === 'map_predictive');
    expect(mp).toBeDefined();
    const hotspotIds = new Set(mp.payload.hotspots.map(h => h.id));
    (mp.scoring.correctAxes || []).forEach(axis => {
      expect(hotspotIds).toContain(axis.fromHotspotId);
      expect(hotspotIds).toContain(axis.toHotspotId);
    });
  });

  it('every subDecisionAnswers key in map_live corresponds to a sub-decision id', () => {
    const ml = chapter.stages.find(s => s.type === 'map_live');
    expect(ml).toBeDefined();
    const subDecisionIds = new Set(
      (ml.payload.phases || [])
        .filter(p => p.subDecision)
        .map(p => p.subDecision.id)
    );
    const answers = ml.scoring.subDecisionAnswers || {};
    Object.keys(answers).forEach(id => {
      expect(subDecisionIds).toContain(id);
    });
  });

  it('every correctOptionId in map_live subDecisionAnswers exists as a sub-decision option', () => {
    const ml = chapter.stages.find(s => s.type === 'map_live');
    const subOptIds = allSubDecisionOptionIds();
    const answers = ml.scoring.subDecisionAnswers || {};
    Object.values(answers).forEach(({ correctOptionIds }) => {
      correctOptionIds.forEach(id => {
        expect(subOptIds).toContain(id);
      });
    });
  });

  it('cold_open startingItems IDs are all present in the evidence_wall items', () => {
    const co = chapter.stages.find(s => s.type === 'cold_open');
    const evidenceWall = chapter.stages.find(s => s.type === 'evidence_wall');
    const ewItemIds = new Set(evidenceWall.payload.items.map(i => i.id));
    (co.payload.startingItems || []).forEach(item => {
      expect(ewItemIds).toContain(item.id);
    });
  });

  it('phase_reveal connectionResolutions reference only known evidence IDs', () => {
    const pr = chapter.stages.find(s => s.type === 'phase_reveal');
    expect(pr).toBeDefined();
    const allIds = allEvidenceIds();
    (pr.payload.connectionResolutions || []).forEach(({ pairItemIds }) => {
      pairItemIds.forEach(id => {
        expect(allIds).toContain(id);
      });
    });
  });

  it('map_live unit hotspot IDs all exist in map_live hotspots', () => {
    const ml = chapter.stages.find(s => s.type === 'map_live');
    const hotspotIds = new Set(ml.payload.hotspots.map(h => h.id));
    (ml.payload.phases || []).forEach(phase => {
      (phase.units || []).forEach(unit => {
        expect(hotspotIds).toContain(unit.fromHotspotId);
        expect(hotspotIds).toContain(unit.toHotspotId);
      });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3b. Plain-language scaffolding fields (helps knowledge-light readers)
// ─────────────────────────────────────────────────────────────────────────────

describe('road-to-invasion.json — plain-language scaffolding', () => {
  it('cold_open includes a backgroundPrimer with at least 2 entries', () => {
    const co = chapter.stages.find(s => s.type === 'cold_open');
    expect(Array.isArray(co.payload.backgroundPrimer)).toBe(true);
    expect(co.payload.backgroundPrimer.length).toBeGreaterThanOrEqual(2);
    co.payload.backgroundPrimer.forEach(row => {
      expect(typeof row.label).toBe('string');
      expect(typeof row.text).toBe('string');
      expect(row.text.length).toBeGreaterThan(0);
    });
  });

  it('every evidence_wall item has a category and a whyItMatters line', () => {
    const ew = chapter.stages.find(s => s.type === 'evidence_wall');
    ew.payload.items.forEach(item => {
      expect(typeof item.category).toBe('string');
      expect(item.category.length).toBeGreaterThan(0);
      expect(typeof item.whyItMatters).toBe('string');
      expect(item.whyItMatters.length).toBeGreaterThan(0);
    });
  });

  it('every map_predictive hotspot has a plain-English tooltip', () => {
    const mp = chapter.stages.find(s => s.type === 'map_predictive');
    mp.payload.hotspots.forEach(hs => {
      expect(typeof hs.tooltip).toBe('string');
      expect(hs.tooltip.length).toBeGreaterThan(0);
    });
  });

  it('every actor has knowsAbout tags and at least one suggestedQuestion', () => {
    const ai = chapter.stages.find(s => s.type === 'actor_interrogations');
    ai.payload.actors.forEach(actor => {
      expect(Array.isArray(actor.knowsAbout)).toBe(true);
      expect(actor.knowsAbout.length).toBeGreaterThan(0);
      expect(Array.isArray(actor.suggestedQuestions)).toBe(true);
      expect(actor.suggestedQuestions.length).toBeGreaterThan(0);
    });
  });

  it('decision_point has a signalsRecap with takeaways from earlier stages', () => {
    const dp = chapter.stages.find(s => s.type === 'decision_point');
    expect(Array.isArray(dp.payload.signalsRecap)).toBe(true);
    expect(dp.payload.signalsRecap.length).toBeGreaterThanOrEqual(2);
    dp.payload.signalsRecap.forEach(row => {
      expect(typeof row.takeaway).toBe('string');
      expect(row.takeaway.length).toBeGreaterThan(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Seeder — upsert behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe('seedCaseFiles() — database upsert', () => {
  it('creates the russia-ukraine case file with correct fields', async () => {
    await seedCaseFiles();

    const cf = await GameCaseFile.findOne({ slug: 'russia-ukraine' }).lean();
    expect(cf).not.toBeNull();
    expect(cf.title).toBe('Russia / Ukraine');
    expect(cf.affairLabel).toBe('Eastern Europe · Active Conflict');
    expect(cf.status).toBe('published');
    expect(cf.tags).toEqual(expect.arrayContaining(['Russia', 'Ukraine', 'NATO', 'OSINT']));
    expect(cf.chapterSlugs).toContain('road-to-invasion');
  });

  it('creates the israel-iran case file as locked with no chapterSlugs', async () => {
    await seedCaseFiles();

    const cf = await GameCaseFile.findOne({ slug: 'israel-iran' }).lean();
    expect(cf).not.toBeNull();
    expect(cf.title).toBe('Israel / Iran');
    expect(cf.status).toBe('locked');
    expect(cf.chapterSlugs).toHaveLength(0);
  });

  it('creates the road-to-invasion chapter with caseSlug attached', async () => {
    await seedCaseFiles();

    const ch = await GameCaseFileChapter.findOne({
      caseSlug:    'russia-ukraine',
      chapterSlug: 'road-to-invasion',
    }).lean();

    expect(ch).not.toBeNull();
    expect(ch.chapterNumber).toBe(1);
    expect(ch.title).toBe('Road to Invasion');
    expect(ch.status).toBe('published');
    expect(ch.stages).toHaveLength(8);
  });

  it('all 8 stages are stored with correct types in the correct order', async () => {
    await seedCaseFiles();

    const ch = await GameCaseFileChapter.findOne({
      caseSlug:    'russia-ukraine',
      chapterSlug: 'road-to-invasion',
    }).lean();

    const expectedTypes = [
      'cold_open',
      'evidence_wall',
      'map_predictive',
      'actor_interrogations',
      'decision_point',
      'phase_reveal',
      'map_live',
      'debrief',
    ];

    ch.stages.forEach((stage, i) => {
      expect(stage.type).toBe(expectedTypes[i]);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Idempotency
// ─────────────────────────────────────────────────────────────────────────────

describe('seedCaseFiles() — idempotency', () => {
  it('running the seeder twice does not create duplicate case files', async () => {
    await seedCaseFiles();
    await seedCaseFiles();

    const count = await GameCaseFile.countDocuments();
    expect(count).toBe(2); // russia-ukraine + israel-iran
  });

  it('running the seeder twice does not create duplicate chapters', async () => {
    await seedCaseFiles();
    await seedCaseFiles();

    const count = await GameCaseFileChapter.countDocuments({
      caseSlug:    'russia-ukraine',
      chapterSlug: 'road-to-invasion',
    });
    expect(count).toBe(1);
  });
});
