/**
 * caseFileChapterSchema.test.js — validates that backend/schemas/caseFileChapter.schema.json
 * is well-formed JSON Schema (draft 2020-12) and structurally accepts/rejects
 * fixture data for representative stage types.
 *
 * ajv is not installed, so we use JSON.parse + structural assertions rather than
 * a full validator.  We exercise the schema's $defs directly as objects so the
 * tests are meaningful even without a runtime validator.
 */

const fs   = require('fs');
const path = require('path');

const SCHEMA_PATH = path.join(__dirname, '../../schemas/caseFileChapter.schema.json');

let schema;

beforeAll(() => {
  const raw = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  schema = JSON.parse(raw);
});

// ── Top-level schema structure ────────────────────────────────────────────────

describe('caseFileChapter.schema.json — meta structure', () => {
  it('parses as valid JSON without throwing', () => {
    expect(() => JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8'))).not.toThrow();
  });

  it('declares $schema as draft 2020-12', () => {
    expect(schema['$schema']).toBe('https://json-schema.org/draft/2020-12/schema');
  });

  it('has a $id string', () => {
    expect(typeof schema['$id']).toBe('string');
    expect(schema['$id'].length).toBeGreaterThan(0);
  });

  it('requires the mandatory chapter fields', () => {
    const required = schema.required;
    expect(required).toContain('caseSlug');
    expect(required).toContain('chapterSlug');
    expect(required).toContain('chapterNumber');
    expect(required).toContain('title');
    expect(required).toContain('dateRangeLabel');
    expect(required).toContain('summary');
    expect(required).toContain('stages');
  });

  it('defines a stages property as an array of stage items', () => {
    const stagesProp = schema.properties.stages;
    expect(stagesProp.type).toBe('array');
    expect(stagesProp.items).toBeDefined();
    // items must $ref to the stage def
    expect(stagesProp.items['$ref']).toMatch(/stage/);
  });

  it('has $defs for all 8 stage types', () => {
    const defs = schema['$defs'];
    expect(defs).toBeDefined();
    const expectedDefs = [
      'stageColdOpen',
      'stageEvidenceWall',
      'stageMapPredictive',
      'stageActorInterrogations',
      'stageDecisionPoint',
      'stagePhaseReveal',
      'stageMapLive',
      'stageDebrief',
    ];
    expectedDefs.forEach((name) => {
      expect(defs[name]).toBeDefined();
    });
  });

  it('stage $def discriminates on `type` via const', () => {
    const defs = schema['$defs'];
    const typeToDefKey = {
      cold_open:             'stageColdOpen',
      evidence_wall:         'stageEvidenceWall',
      map_predictive:        'stageMapPredictive',
      actor_interrogations:  'stageActorInterrogations',
      decision_point:        'stageDecisionPoint',
      phase_reveal:          'stagePhaseReveal',
      map_live:              'stageMapLive',
      debrief:               'stageDebrief',
    };
    Object.entries(typeToDefKey).forEach(([typeValue, defKey]) => {
      const def = defs[defKey];
      expect(def.properties.type.const).toBe(typeValue);
    });
  });
});

// ── Helper: structural validator ──────────────────────────────────────────────
// Checks that a fixture satisfies the $def's required fields structurally.

function validateAgainstDef(defKey, fixture) {
  const def = schema['$defs'][defKey];
  const required = def.required || [];
  const missing = required.filter((k) => !(k in fixture));
  return {
    valid: missing.length === 0,
    missing,
  };
}

function validatePayloadRequired(defKey, payloadFixture) {
  const payloadSchema = schema['$defs'][defKey].properties.payload;
  const required = payloadSchema.required || [];
  const missing = required.filter((k) => !(k in payloadFixture));
  return {
    valid: missing.length === 0,
    missing,
  };
}

// ── evidence_wall ─────────────────────────────────────────────────────────────

describe('stageEvidenceWall structural validation', () => {
  const validFixture = {
    type: 'evidence_wall',
    payload: {
      phaseLabel: 'Phase 1 — Build-up',
      items: [
        {
          id: 'ev_1',
          title: 'Satellite Image',
          type: 'satellite',
          description: 'Large armoured formation near Belgorod.',
          imageUrl: 'https://example.com/sat1.jpg',
          sourceUrl: 'https://planet.com',
        },
      ],
    },
    scoring: {
      signalWeights: { ev_1: 0.9 },
      validConnectionPairs: [['ev_1', 'ev_2']],
      maxScore: 100,
    },
  };

  it('accepts a valid evidence_wall stage fixture (required fields present)', () => {
    const { valid, missing } = validateAgainstDef('stageEvidenceWall', validFixture);
    expect(missing).toEqual([]);
    expect(valid).toBe(true);
  });

  it('accepts minimal payload with only items (phaseLabel is optional)', () => {
    const minimal = { items: [{ id: 'x', title: 'T', type: 'photo', description: 'D' }] };
    const { valid } = validatePayloadRequired('stageEvidenceWall', minimal);
    expect(valid).toBe(true);
  });

  it('rejects payload missing required items field', () => {
    const { valid, missing } = validatePayloadRequired('stageEvidenceWall', {
      phaseLabel: 'Phase 1',
      // items intentionally absent
    });
    expect(valid).toBe(false);
    expect(missing).toContain('items');
  });

  it('stageEvidenceWall def requires type and payload at stage level', () => {
    // Missing 'payload'
    const { valid, missing } = validateAgainstDef('stageEvidenceWall', { type: 'evidence_wall' });
    expect(valid).toBe(false);
    expect(missing).toContain('payload');
  });

  it('evidenceItem $def requires id, title, type, description', () => {
    const itemDef = schema['$defs']['evidenceItem'];
    expect(itemDef.required).toEqual(expect.arrayContaining(['id', 'title', 'type', 'description']));
  });

  it('evidenceItem type enum covers all 6 evidence types', () => {
    const itemDef = schema['$defs']['evidenceItem'];
    const typeEnum = itemDef.properties.type.enum;
    expect(typeEnum).toEqual(
      expect.arrayContaining(['satellite', 'transcript', 'photo', 'document', 'osint', 'map_overlay'])
    );
  });

  it('scoring signalWeights additionalProperties specifies number type', () => {
    const scoringProps = schema['$defs']['stageEvidenceWall'].properties.scoring.properties;
    const apSchema = scoringProps.signalWeights.additionalProperties;
    expect(apSchema.type).toBe('number');
    expect(apSchema.minimum).toBe(0);
    expect(apSchema.maximum).toBe(1);
  });
});

// ── decision_point ────────────────────────────────────────────────────────────

describe('stageDecisionPoint structural validation', () => {
  const validFixture = {
    type: 'decision_point',
    payload: {
      prompt: 'What will Russia do next?',
      contextDateLabel: 'Jan 2022',
      options: [
        { id: 'opt_a', text: 'Full-scale invasion', hint: 'Consider troop numbers.' },
        { id: 'opt_b', text: 'Limited incursion' },
      ],
    },
    scoring: {
      optionRealityScores: { opt_a: 90, opt_b: 40 },
      optionSupportingEvidenceIds: { opt_a: ['ev_1'] },
      maxScore: 100,
    },
  };

  it('accepts a valid decision_point stage fixture', () => {
    const { valid } = validateAgainstDef('stageDecisionPoint', validFixture);
    expect(valid).toBe(true);
  });

  it('accepts minimal payload with only prompt and options', () => {
    const minimal = { prompt: 'Q?', options: [{ id: 'o1', text: 'Option A' }] };
    const { valid } = validatePayloadRequired('stageDecisionPoint', minimal);
    expect(valid).toBe(true);
  });

  it('rejects payload missing prompt', () => {
    const { valid, missing } = validatePayloadRequired('stageDecisionPoint', {
      options: [{ id: 'o1', text: 'Option A' }],
    });
    expect(valid).toBe(false);
    expect(missing).toContain('prompt');
  });

  it('rejects payload missing options', () => {
    const { valid, missing } = validatePayloadRequired('stageDecisionPoint', {
      prompt: 'Q?',
    });
    expect(valid).toBe(false);
    expect(missing).toContain('options');
  });

  it('options items require id and text', () => {
    const optionSchema = schema['$defs']['stageDecisionPoint'].properties.payload.properties.options.items;
    expect(optionSchema.required).toContain('id');
    expect(optionSchema.required).toContain('text');
  });

  it('optionRealityScores values have 0–100 range constraint', () => {
    const scoringProps = schema['$defs']['stageDecisionPoint'].properties.scoring.properties;
    const apSchema = scoringProps.optionRealityScores.additionalProperties;
    expect(apSchema.minimum).toBe(0);
    expect(apSchema.maximum).toBe(100);
  });
});

// ── Additional spot-checks for other stage types ──────────────────────────────

describe('remaining stage $defs — spot structural checks', () => {
  it('stageColdOpen payload requires dateLabel, directorBriefing, startingItems', () => {
    const payloadSchema = schema['$defs']['stageColdOpen'].properties.payload;
    expect(payloadSchema.required).toEqual(
      expect.arrayContaining(['dateLabel', 'directorBriefing', 'startingItems'])
    );
  });

  it('stageMapPredictive payload requires mapBounds, hotspots, tokenCount, prompt', () => {
    const payloadSchema = schema['$defs']['stageMapPredictive'].properties.payload;
    expect(payloadSchema.required).toEqual(
      expect.arrayContaining(['mapBounds', 'hotspots', 'tokenCount', 'prompt'])
    );
  });

  it('stageActorInterrogations payload requires actors', () => {
    const payloadSchema = schema['$defs']['stageActorInterrogations'].properties.payload;
    expect(payloadSchema.required).toContain('actors');
  });

  it('stagePhaseReveal payload requires newPhaseLabel', () => {
    const payloadSchema = schema['$defs']['stagePhaseReveal'].properties.payload;
    expect(payloadSchema.required).toContain('newPhaseLabel');
  });

  it('stageMapLive payload requires mapBounds, hotspots, phases', () => {
    const payloadSchema = schema['$defs']['stageMapLive'].properties.payload;
    expect(payloadSchema.required).toEqual(
      expect.arrayContaining(['mapBounds', 'hotspots', 'phases'])
    );
  });

  it('stageDebrief payload requires annotatedReplayBeats', () => {
    const payloadSchema = schema['$defs']['stageDebrief'].properties.payload;
    expect(payloadSchema.required).toContain('annotatedReplayBeats');
  });

  it('mapBounds $def requires south, west, north, east', () => {
    const mapBoundsDef = schema['$defs']['mapBounds'];
    expect(mapBoundsDef.required).toEqual(
      expect.arrayContaining(['south', 'west', 'north', 'east'])
    );
  });

  it('hotspot $def kind enum covers all 5 location types', () => {
    const hotspotDef = schema['$defs']['hotspot'];
    const kindEnum = hotspotDef.properties.kind.enum;
    expect(kindEnum).toEqual(
      expect.arrayContaining(['staging', 'capital', 'logistics', 'naval', 'border'])
    );
  });

  it('map_live phase unit side enum is ["ru","ua"]', () => {
    const phasesSchema = schema['$defs']['stageMapLive'].properties.payload.properties.phases;
    const unitSchema = phasesSchema.items.properties.units.items;
    expect(unitSchema.properties.side.enum).toEqual(['ru', 'ua']);
  });

  it('evidenceItem schema declares optional category + whyItMatters', () => {
    const itemDef = schema['$defs']['evidenceItem'];
    expect(itemDef.properties).toHaveProperty('category');
    expect(itemDef.properties).toHaveProperty('whyItMatters');
    expect(itemDef.properties.category.type).toBe('string');
    expect(itemDef.properties.whyItMatters.type).toBe('string');
    // Neither is in `required` — must remain optional.
    expect(itemDef.required).not.toContain('category');
    expect(itemDef.required).not.toContain('whyItMatters');
  });

  it('hotspot schema declares optional tooltip', () => {
    const hsDef = schema['$defs']['hotspot'];
    expect(hsDef.properties).toHaveProperty('tooltip');
    expect(hsDef.properties.tooltip.type).toBe('string');
    expect(hsDef.required).not.toContain('tooltip');
  });

  it('actor item schema declares optional knowsAbout + suggestedQuestions', () => {
    const actorSchema =
      schema['$defs']['stageActorInterrogations'].properties.payload.properties.actors.items;
    expect(actorSchema.properties).toHaveProperty('knowsAbout');
    expect(actorSchema.properties).toHaveProperty('suggestedQuestions');
    expect(actorSchema.properties.knowsAbout.type).toBe('array');
    expect(actorSchema.properties.suggestedQuestions.type).toBe('array');
    expect(actorSchema.required).not.toContain('knowsAbout');
    expect(actorSchema.required).not.toContain('suggestedQuestions');
  });

  it('cold_open payload allows optional backgroundPrimer array of {label, text}', () => {
    const payloadSchema = schema['$defs']['stageColdOpen'].properties.payload;
    expect(payloadSchema.properties).toHaveProperty('backgroundPrimer');
    expect(payloadSchema.properties.backgroundPrimer.type).toBe('array');
    expect(payloadSchema.required).not.toContain('backgroundPrimer');
    const itemSchema = payloadSchema.properties.backgroundPrimer.items;
    expect(itemSchema.required).toEqual(expect.arrayContaining(['label', 'text']));
  });

  it('decision_point payload allows optional signalsRecap array of {takeaway}', () => {
    const payloadSchema = schema['$defs']['stageDecisionPoint'].properties.payload;
    expect(payloadSchema.properties).toHaveProperty('signalsRecap');
    expect(payloadSchema.properties.signalsRecap.type).toBe('array');
    expect(payloadSchema.required).not.toContain('signalsRecap');
    const itemSchema = payloadSchema.properties.signalsRecap.items;
    expect(itemSchema.required).toContain('takeaway');
  });

  it('stageDebrief teaserNextChapter allows null or {title, blurb}', () => {
    const teaserSchema =
      schema['$defs']['stageDebrief'].properties.payload.properties.teaserNextChapter;
    // oneOf: null or object
    expect(teaserSchema.oneOf).toHaveLength(2);
    const types = teaserSchema.oneOf.map((s) => s.type);
    expect(types).toContain('null');
    const objSchema = teaserSchema.oneOf.find((s) => s.type === 'object');
    expect(objSchema.required).toEqual(expect.arrayContaining(['title', 'blurb']));
  });
});
