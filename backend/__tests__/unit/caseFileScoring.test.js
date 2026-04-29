'use strict';

const { scoreChapter } = require('../../utils/caseFileScoring');

// ── Chapter fixtures ──────────────────────────────────────────────────────────

/**
 * Build a minimal chapter with the given stage shapes.
 */
function makeChapter(stages) {
  return { stages };
}

function makeResult(stageIndex, stageType, payload) {
  return { stageIndex, stageType, payload };
}

// ── Empty stageResults ────────────────────────────────────────────────────────

describe('scoreChapter — empty stageResults', () => {
  const chapter = makeChapter([
    { id: 's0', type: 'cold_open',            payload: {}, scoring: {} },
    { id: 's1', type: 'evidence_wall',         payload: {}, scoring: { validConnectionPairs: [['A','B']], signalWeights: { A: 1, B: 1 } } },
    { id: 's2', type: 'map_predictive',        payload: {}, scoring: { correctAxes: [{ fromHotspotId: 'H1', toHotspotId: 'H2', isMain: false }] } },
    { id: 's3', type: 'actor_interrogations',  payload: {}, scoring: { baseEngagementScore: 30 } },
    { id: 's4', type: 'decision_point',        payload: {}, scoring: { optionRealityScores: { OPT1: 80 }, optionSupportingEvidenceIds: { OPT1: ['A'] } } },
    { id: 's5', type: 'phase_reveal',          payload: {}, scoring: { validConnectionPairs: [['A','C']], signalWeights: {}, connectionResolutions: [] } },
    { id: 's6', type: 'map_live',              payload: {}, scoring: { subDecisionAnswers: { sd1: { correctOptionIds: ['X'] } } } },
    { id: 's7', type: 'debrief',               payload: {}, scoring: {} },
  ]);

  it('totalScore is 0 when no results submitted', () => {
    const { totalScore } = scoreChapter(chapter, []);
    expect(totalScore).toBe(0);
  });

  it('breakdown has one entry per stage', () => {
    const { breakdown } = scoreChapter(chapter, []);
    expect(breakdown).toHaveLength(chapter.stages.length);
  });

  it('every breakdown entry has score 0 and notes "Not submitted"', () => {
    const { breakdown } = scoreChapter(chapter, []);
    for (const entry of breakdown) {
      expect(entry.score).toBe(0);
      expect(entry.notes).toBe('Not submitted');
    }
  });

  it('does not include airstarsAwarded or levelXpAwarded in the result', () => {
    const result = scoreChapter(chapter, []);
    expect(result).not.toHaveProperty('airstarsAwarded');
    expect(result).not.toHaveProperty('levelXpAwarded');
  });
});

// ── evidence_wall ─────────────────────────────────────────────────────────────

describe('scoreChapter — evidence_wall', () => {
  const ewStage = {
    id: 's0',
    type: 'evidence_wall',
    payload: {},
    scoring: {
      validConnectionPairs: [['A','B'], ['C','D'], ['E','F'], ['G','H']],
      signalWeights: { A: 1, B: 1, C: 1, D: 1, E: 1, F: 1, G: 1, H: 1 },
    },
  };
  const chapter = makeChapter([ewStage]);
  const maxScore = 250; // weight 0.25 × 1000

  it('perfect submission (all valid pairs, no noise) → maxScore', () => {
    const result = makeResult(0, 'evidence_wall', {
      connections: [
        { fromItemId: 'A', toItemId: 'B' },
        { fromItemId: 'C', toItemId: 'D' },
        { fromItemId: 'E', toItemId: 'F' },
        { fromItemId: 'G', toItemId: 'H' },
      ],
    });
    const { breakdown } = scoreChapter(chapter, [result]);
    expect(breakdown[0].score).toBe(maxScore);
    expect(breakdown[0].maxScore).toBe(maxScore);
  });

  it('50% hits with 50% noise → noise penalty applied, score < maxScore', () => {
    // 2 valid hits, 2 noise
    const result = makeResult(0, 'evidence_wall', {
      connections: [
        { fromItemId: 'A', toItemId: 'B' },  // valid
        { fromItemId: 'C', toItemId: 'D' },  // valid
        { fromItemId: 'X', toItemId: 'Y' },  // noise
        { fromItemId: 'P', toItemId: 'Q' },  // noise
      ],
    });
    const { breakdown } = scoreChapter(chapter, [result]);
    // raw     = 2 * (1+1)/2 * (250/4) = 125
    // penalty = 2 * 0.01 * 250 = 5
    // score   = 125 - 5 = 120 (above the 30% floor of 75, so floor doesn't apply)
    expect(breakdown[0].score).toBe(120);
    expect(breakdown[0].score).toBeLessThan(maxScore);
    expect(breakdown[0].notes).toContain('2 noise');
  });

  it('reverse-ordered pair is accepted (unordered matching)', () => {
    const result = makeResult(0, 'evidence_wall', {
      connections: [{ fromItemId: 'B', toItemId: 'A' }], // reversed — still valid
    });
    const { breakdown } = scoreChapter(chapter, [result]);
    expect(breakdown[0].score).toBeGreaterThan(0);
  });

  it('heavy noise floors at 30% of maxScore (forgiveness floor)', () => {
    const result = makeResult(0, 'evidence_wall', {
      connections: Array.from({ length: 30 }, (_, i) => ({
        fromItemId: `X${i}`, toItemId: `Y${i}`, // all noise
      })),
    });
    const { breakdown } = scoreChapter(chapter, [result]);
    // helper returns 0 (raw 0 minus 30 × 1% × 250 = 75 penalty, clamped at 0).
    // Forgiveness floor: 30% × 250 = 75.
    expect(breakdown[0].score).toBe(75);
    expect(breakdown[0].score).toBeGreaterThanOrEqual(0);
  });

  it('score is capped at maxScore', () => {
    // Only possible via explicit scoring.maxScore override — test via custom stage
    const customStage = {
      id: 's0',
      type: 'evidence_wall',
      payload: {},
      scoring: {
        maxScore: 50,
        validConnectionPairs: [['A','B']],
        signalWeights: { A: 10, B: 10 },
      },
    };
    const result = makeResult(0, 'evidence_wall', {
      connections: [{ fromItemId: 'A', toItemId: 'B' }],
    });
    const { breakdown } = scoreChapter(makeChapter([customStage]), [result]);
    expect(breakdown[0].score).toBe(50);
    expect(breakdown[0].score).toBeLessThanOrEqual(50);
  });
});

// ── map_predictive ────────────────────────────────────────────────────────────

describe('scoreChapter — map_predictive', () => {
  const stage = {
    id: 's0',
    type: 'map_predictive',
    payload: {},
    scoring: {
      correctAxes: [
        { fromHotspotId: 'H1', toHotspotId: 'H2', isMain: true  },
        { fromHotspotId: 'H3', toHotspotId: 'H4', isMain: false },
      ],
    },
  };
  const chapter  = makeChapter([stage]);
  const maxScore = 150; // 0.15 × 1000

  it('matching main-effort axis with markedAsMain:true → bonus applied', () => {
    const result = makeResult(0, 'map_predictive', {
      axes: [
        { fromHotspotId: 'H1', toHotspotId: 'H2', markedAsMain: true },
        { fromHotspotId: 'H3', toHotspotId: 'H4', markedAsMain: false },
      ],
    });
    const { breakdown } = scoreChapter(chapter, [result]);
    // perAxis = 150/2 = 75
    // H1→H2: 75 * 1.2 = 90; H3→H4: 75 × 1.0 = 75; total = 165 → capped at 150
    expect(breakdown[0].score).toBe(maxScore);
    expect(breakdown[0].notes).toContain('main-effort bonus applied');
  });

  it('matching main-effort axis without markedAsMain → no bonus', () => {
    const result = makeResult(0, 'map_predictive', {
      axes: [
        { fromHotspotId: 'H1', toHotspotId: 'H2', markedAsMain: false },
      ],
    });
    const { breakdown } = scoreChapter(chapter, [result]);
    // Only 1 of 2 correct axes matched, no bonus → 75
    expect(breakdown[0].score).toBe(75);
    expect(breakdown[0].notes).not.toContain('bonus');
  });

  it('wrong axes submitted → forgiveness floor (30% of maxScore)', () => {
    const result = makeResult(0, 'map_predictive', {
      axes: [{ fromHotspotId: 'X1', toHotspotId: 'X2', markedAsMain: false }],
    });
    const { breakdown } = scoreChapter(chapter, [result]);
    // helper returns 0 (no axis matches). Floor: 30% × 150 = 45.
    expect(breakdown[0].score).toBe(45);
  });
});

// ── decision_point ────────────────────────────────────────────────────────────

describe('scoreChapter — decision_point', () => {
  // Chapter: evidence_wall at index 0, decision_point at index 1
  const ewStage = {
    id: 's0',
    type: 'evidence_wall',
    payload: {},
    scoring: {
      validConnectionPairs: [['A','B'], ['C','D'], ['E','F']],
      signalWeights: { A:1, B:1, C:1, D:1, E:1, F:1 },
    },
  };
  const dpStage = {
    id: 's1',
    type: 'decision_point',
    payload: {},
    scoring: {
      optionRealityScores:          { OPT80: 80, OPT100: 100 },
      optionSupportingEvidenceIds:  { OPT80: ['A', 'C', 'E'], OPT100: ['A', 'C', 'E'] },
    },
  };
  const dpStageEmptySupport = {
    id: 's1',
    type: 'decision_point',
    payload: {},
    scoring: {
      optionRealityScores:          { OPT80: 80 },
      optionSupportingEvidenceIds:  { OPT80: [] },
    },
  };
  const maxScore = 250; // 0.25 × 1000

  it('80% reality option, 100% supporting evidence connected → score capped at maxScore', () => {
    const chapter = makeChapter([ewStage, dpStage]);
    const ewResult = makeResult(0, 'evidence_wall', {
      connections: [
        { fromItemId: 'A', toItemId: 'B' }, // A connected
        { fromItemId: 'C', toItemId: 'D' }, // C connected
        { fromItemId: 'E', toItemId: 'F' }, // E connected
      ],
    });
    const dpResult = makeResult(1, 'decision_point', {
      selectedOptionId: 'OPT80',
    });
    const { breakdown } = scoreChapter(chapter, [ewResult, dpResult]);
    // base = (80/100) * 250 = 200
    // supportingIds = ['A','C','E'], all connected → count=3, multiplier = 1 + 0.5*(3/3) = 1.5
    // score = 200 * 1.5 = 300 → capped at 250
    expect(breakdown[1].score).toBe(250);
    expect(breakdown[1].maxScore).toBe(maxScore);
  });

  it('100% reality option, 0% supporting evidence connected → multiplier 1.0', () => {
    const chapter  = makeChapter([ewStage, dpStage]);
    const ewResult = makeResult(0, 'evidence_wall', {
      connections: [], // no connections
    });
    const dpResult = makeResult(1, 'decision_point', {
      selectedOptionId: 'OPT100',
    });
    const { breakdown } = scoreChapter(chapter, [ewResult, dpResult]);
    // base = (100/100) * 250 = 250
    // 0 of 3 supporting ids connected → multiplier = 1 + 0.5*(0/3) = 1.0
    // score = 250 * 1.0 = 250 → exactly maxScore
    expect(breakdown[1].score).toBe(250);
  });

  it('empty supportingIds → multiplier is 1.0', () => {
    const chapter  = makeChapter([ewStage, dpStageEmptySupport]);
    const ewResult = makeResult(0, 'evidence_wall', {
      connections: [{ fromItemId: 'A', toItemId: 'B' }],
    });
    const dpResult = makeResult(1, 'decision_point', {
      selectedOptionId: 'OPT80',
    });
    const { breakdown } = scoreChapter(chapter, [ewResult, dpResult]);
    // base = (80/100) * 250 = 200; supportingIds empty → multiplier = 1.0
    expect(breakdown[1].score).toBe(200);
  });

  it('no prior evidence_wall result → multiplier 1.0 (treats as 0% connected)', () => {
    const chapter  = makeChapter([dpStage]); // no EW stage
    const dpResult = makeResult(0, 'decision_point', {
      selectedOptionId: 'OPT80',
    });
    const { breakdown } = scoreChapter(chapter, [dpResult]);
    // base = 200, no ewResult → connectedIds empty → multiplier = 1 + 0.5*(0/3) = 1.0
    expect(breakdown[0].score).toBe(200);
  });
});

// ── map_live ──────────────────────────────────────────────────────────────────

describe('scoreChapter — map_live', () => {
  const stage = {
    id: 's0',
    type: 'map_live',
    payload: {},
    scoring: {
      subDecisionAnswers: {
        sd1: { correctOptionIds: ['X', 'Y'] },
        sd2: { correctOptionIds: ['Z'] },
      },
    },
  };
  const chapter  = makeChapter([stage]);
  const maxScore = 200; // 0.20 × 1000

  it('exact match on all sub-decisions → maxScore', () => {
    const result = makeResult(0, 'map_live', {
      subDecisions: [
        { subDecisionId: 'sd1', selectedOptionIds: ['X', 'Y'] },
        { subDecisionId: 'sd2', selectedOptionIds: ['Z'] },
      ],
    });
    const { breakdown } = scoreChapter(chapter, [result]);
    expect(breakdown[0].score).toBe(maxScore);
    expect(breakdown[0].notes).toContain('2 of 2');
  });

  it('set-equality: order of selectedOptionIds does not matter', () => {
    const result = makeResult(0, 'map_live', {
      subDecisions: [
        { subDecisionId: 'sd1', selectedOptionIds: ['Y', 'X'] }, // reversed order
        { subDecisionId: 'sd2', selectedOptionIds: ['Z'] },
      ],
    });
    const { breakdown } = scoreChapter(chapter, [result]);
    expect(breakdown[0].score).toBe(maxScore);
  });

  it('partial match (1 of 2 correct) → half credit', () => {
    const result = makeResult(0, 'map_live', {
      subDecisions: [
        { subDecisionId: 'sd1', selectedOptionIds: ['X', 'Y'] }, // correct
        { subDecisionId: 'sd2', selectedOptionIds: ['WRONG'] },  // wrong
      ],
    });
    const { breakdown } = scoreChapter(chapter, [result]);
    // perSub = 200/2 = 100; 1 correct → score = 100
    expect(breakdown[0].score).toBe(100);
    expect(breakdown[0].notes).toContain('1 of 2');
  });

  it('multi-select: extra option makes it wrong', () => {
    const result = makeResult(0, 'map_live', {
      subDecisions: [
        { subDecisionId: 'sd1', selectedOptionIds: ['X', 'Y', 'EXTRA'] }, // extra → wrong
        { subDecisionId: 'sd2', selectedOptionIds: ['Z'] },
      ],
    });
    const { breakdown } = scoreChapter(chapter, [result]);
    // sd1 wrong (different set size), sd2 correct → 100
    expect(breakdown[0].score).toBe(100);
  });

  it('no sub-decisions submitted → forgiveness floor (30% of maxScore)', () => {
    const result = makeResult(0, 'map_live', { subDecisions: [] });
    const { breakdown } = scoreChapter(chapter, [result]);
    // helper returns 0. Floor: 30% × 200 = 60.
    expect(breakdown[0].score).toBe(60);
  });

  it('partial submission of defined sub-decisions does not inflate per-sub credit', () => {
    // 1 of 2 defined sub-decisions submitted (and correct).
    // Even-split fallback is stageMax / definedCount = 200 / 2 = 100.
    // Old (buggy) behaviour divided by submitted count → 200 / 1 = 200 (full credit).
    const result = makeResult(0, 'map_live', {
      subDecisions: [
        { subDecisionId: 'sd1', selectedOptionIds: ['X', 'Y'] },
      ],
    });
    const { breakdown } = scoreChapter(chapter, [result]);
    expect(breakdown[0].score).toBe(100);
    expect(breakdown[0].notes).toBe('1 of 2 sub-decisions correct');
  });

  it('honours explicit per-sub-decision maxScore when present', () => {
    const stageWithExplicitMax = {
      id: 's0',
      type: 'map_live',
      payload: {},
      scoring: {
        subDecisionAnswers: {
          sd1: { correctOptionIds: ['X'], maxScore: 150 },
          sd2: { correctOptionIds: ['Z'], maxScore: 50  },
        },
      },
    };
    const chapterWithExplicitMax = makeChapter([stageWithExplicitMax]);
    const result = makeResult(0, 'map_live', {
      subDecisions: [
        { subDecisionId: 'sd1', selectedOptionIds: ['X'] }, // correct → 150
        { subDecisionId: 'sd2', selectedOptionIds: ['WRONG'] }, // wrong → 0
      ],
    });
    const { breakdown } = scoreChapter(chapterWithExplicitMax, [result]);
    expect(breakdown[0].score).toBe(150);
  });
});

// ── No airstars / XP rewards (Case Files do NOT award airstars) ──────────────

describe('scoreChapter — no airstar reward', () => {
  it('result object exposes only totalScore + breakdown (no reward fields)', () => {
    const stage = {
      id: 's0',
      type: 'evidence_wall',
      payload: {},
      scoring: {
        validConnectionPairs: [['A','B']],
        signalWeights: { A: 1, B: 1 },
      },
    };
    const chapter = makeChapter([stage]);
    const result  = makeResult(0, 'evidence_wall', {
      connections: [{ fromItemId: 'A', toItemId: 'B' }],
    });
    const out = scoreChapter(chapter, [result]);
    expect(Object.keys(out).sort()).toEqual(['breakdown', 'totalScore']);
    expect(out).not.toHaveProperty('airstarsAwarded');
    expect(out).not.toHaveProperty('levelXpAwarded');
  });
});

// ── Determinism ───────────────────────────────────────────────────────────────

describe('scoreChapter — determinism', () => {
  const chapter = makeChapter([
    {
      id: 's0',
      type: 'evidence_wall',
      payload: {},
      scoring: {
        validConnectionPairs: [['A','B'], ['C','D']],
        signalWeights: { A: 1, B: 1, C: 2, D: 2 },
      },
    },
    {
      id: 's1',
      type: 'map_predictive',
      payload: {},
      scoring: {
        correctAxes: [{ fromHotspotId: 'H1', toHotspotId: 'H2', isMain: true }],
      },
    },
  ]);

  const stageResults = [
    makeResult(0, 'evidence_wall', {
      connections: [
        { fromItemId: 'A', toItemId: 'B' },
        { fromItemId: 'X', toItemId: 'Y' }, // noise
      ],
    }),
    makeResult(1, 'map_predictive', {
      axes: [{ fromHotspotId: 'H1', toHotspotId: 'H2', markedAsMain: true }],
    }),
  ];

  it('same inputs always produce same outputs (idempotent)', () => {
    const r1 = scoreChapter(chapter, stageResults);
    const r2 = scoreChapter(chapter, stageResults);
    expect(r1).toEqual(r2);
  });

  it('breakdown notes are deterministic strings', () => {
    const { breakdown: b1 } = scoreChapter(chapter, stageResults);
    const { breakdown: b2 } = scoreChapter(chapter, stageResults);
    b1.forEach((entry, i) => {
      expect(entry.notes).toBe(b2[i].notes);
    });
  });
});

// ── Unknown stage type ────────────────────────────────────────────────────────

describe('scoreChapter — unknown stage type', () => {
  it('returns 0 with notes "Unknown stage type" for an unknown type', () => {
    const chapter = makeChapter([
      { id: 's0', type: 'mystery_stage', payload: {}, scoring: {} },
    ]);
    const result = makeResult(0, 'mystery_stage', { payload: {} });
    const { breakdown } = scoreChapter(chapter, [result]);
    expect(breakdown[0].score).toBe(0);
    expect(breakdown[0].notes).toBe('Unknown stage type');
  });
});

// ── cold_open + debrief always 0 ─────────────────────────────────────────────

describe('scoreChapter — zero-weight stage types', () => {
  it('cold_open scores 0 regardless of payload', () => {
    const chapter = makeChapter([{ id: 's0', type: 'cold_open', payload: {}, scoring: {} }]);
    const result  = makeResult(0, 'cold_open', { anything: true });
    const { breakdown } = scoreChapter(chapter, [result]);
    expect(breakdown[0].score).toBe(0);
    expect(breakdown[0].maxScore).toBe(0);
  });

  it('debrief scores 0 regardless of payload', () => {
    const chapter = makeChapter([{ id: 's0', type: 'debrief', payload: {}, scoring: {} }]);
    const result  = makeResult(0, 'debrief', { anything: true });
    const { breakdown } = scoreChapter(chapter, [result]);
    expect(breakdown[0].score).toBe(0);
    expect(breakdown[0].maxScore).toBe(0);
  });
});

// ── Forgiveness floor ─────────────────────────────────────────────────────────

describe('scoreChapter — forgiveness floor', () => {
  it('attempted stage with helper score 0 → floors at 30% of maxScore', () => {
    const stage = {
      id: 's0',
      type: 'evidence_wall',
      payload: {},
      scoring: {
        validConnectionPairs: [['A','B']],
        signalWeights: { A: 1, B: 1 },
      },
    };
    // Submit a single noise connection — helper would return 0 (raw 0, penalty
    // clamped). Floor must lift this to 30% × 250 = 75.
    const result = makeResult(0, 'evidence_wall', {
      connections: [{ fromItemId: 'X', toItemId: 'Y' }],
    });
    const { breakdown } = scoreChapter(makeChapter([stage]), [result]);
    expect(breakdown[0].score).toBe(75);
  });

  it('not-submitted stages do NOT receive the floor (stay at 0)', () => {
    const stage = {
      id: 's0',
      type: 'evidence_wall',
      payload: {},
      scoring: {
        validConnectionPairs: [['A','B']],
        signalWeights: { A: 1, B: 1 },
      },
    };
    const { breakdown } = scoreChapter(makeChapter([stage]), []);
    expect(breakdown[0].score).toBe(0);
    expect(breakdown[0].notes).toBe('Not submitted');
  });

  it('cold_open / debrief stay at 0 even when attempted (maxScore is 0)', () => {
    const chapter = makeChapter([
      { id: 's0', type: 'cold_open', payload: {}, scoring: {} },
      { id: 's1', type: 'debrief',   payload: {}, scoring: {} },
    ]);
    const results = [
      makeResult(0, 'cold_open', { completed: true }),
      makeResult(1, 'debrief',   { completed: true }),
    ];
    const { breakdown } = scoreChapter(chapter, results);
    expect(breakdown[0].score).toBe(0);
    expect(breakdown[1].score).toBe(0);
  });

  it('floor never raises a score above maxScore', () => {
    const stage = {
      id: 's0',
      type: 'evidence_wall',
      payload: {},
      scoring: {
        maxScore: 10,
        validConnectionPairs: [['A','B']],
        signalWeights: { A: 1, B: 1 },
      },
    };
    const result = makeResult(0, 'evidence_wall', {
      connections: [{ fromItemId: 'A', toItemId: 'B' }], // perfect, helper → 10
    });
    const { breakdown } = scoreChapter(makeChapter([stage]), [result]);
    // Floor would be 30% × 10 = 3, helper returned 10 (capped at maxScore). Stay at 10.
    expect(breakdown[0].score).toBe(10);
    expect(breakdown[0].score).toBeLessThanOrEqual(10);
  });
});

// ── Mixed chapter (integration) ───────────────────────────────────────────────

describe('scoreChapter — mixed chapter integration', () => {
  it('totals correctly across multiple stage types with missing results', () => {
    const chapter = makeChapter([
      { id: 's0', type: 'cold_open',    payload: {}, scoring: {} },
      {
        id: 's1',
        type: 'evidence_wall',
        payload: {},
        scoring: {
          validConnectionPairs: [['A','B']],
          signalWeights: { A: 1, B: 1 },
        },
      },
      { id: 's2', type: 'map_live', payload: {}, scoring: {
        subDecisionAnswers: { sd1: { correctOptionIds: ['X'] } },
      }},
    ]);

    // Only submit evidence_wall result; cold_open and map_live are missing
    const ewResult = makeResult(1, 'evidence_wall', {
      connections: [{ fromItemId: 'A', toItemId: 'B' }],
    });

    const { breakdown, totalScore } = scoreChapter(chapter, [ewResult]);

    expect(breakdown[0].score).toBe(0);  // cold_open — Not submitted (cold_open = 0 anyway)
    expect(breakdown[1].score).toBe(250);
    expect(breakdown[2].score).toBe(0);  // map_live — Not submitted; floor does NOT apply
    expect(breakdown[2].notes).toBe('Not submitted');
    expect(totalScore).toBe(250);
  });
});
