/**
 * Unit tests for brief-prompt shape helpers.
 *
 * Guards against the "Ali Khamenei / No verifiable connection exists between
 * this subject and the RAF" disclaimer bug — prevents us from re-introducing
 * RAF-asset-specific framing into sections/user-content for subjects that have
 * no RAF-direct relationship (Actors, Threats, Treaties, AOR, Allies, historic).
 */

const {
  getBriefShape,
  SUBTITLE_SPEC,
  buildTopicUserGuidance,
  buildDescriptionSectionsSpec,
} = require('../../utils/briefPromptShapes');

describe('getBriefShape', () => {
  test('defaults to raf-asset when category is unspecified', () => {
    expect(getBriefShape({})).toBe('raf-asset');
    expect(getBriefShape({ category: 'News' })).toBe('raf-asset');
  });

  test('RAF-native categories resolve to raf-asset', () => {
    expect(getBriefShape({ category: 'Aircrafts',   subcategory: 'Fast Jet' })).toBe('raf-asset');
    expect(getBriefShape({ category: 'Bases',       subcategory: 'UK Active' })).toBe('raf-asset');
    expect(getBriefShape({ category: 'Squadrons',   subcategory: 'Active Front-Line' })).toBe('raf-asset');
    expect(getBriefShape({ category: 'Roles' })).toBe('raf-asset');
    expect(getBriefShape({ category: 'Training' })).toBe('raf-asset');
    expect(getBriefShape({ category: 'Tech' })).toBe('raf-asset');
    expect(getBriefShape({ category: 'Terminology' })).toBe('raf-asset');
    expect(getBriefShape({ category: 'Ranks' })).toBe('raf-asset');
    expect(getBriefShape({ category: 'Heritage' })).toBe('raf-asset');
  });

  test('Actors maps to actor shape, except Historic RAF Personnel', () => {
    expect(getBriefShape({ category: 'Actors', subcategory: 'Heads of State & Government' })).toBe('actor');
    expect(getBriefShape({ category: 'Actors', subcategory: 'Adversary Commanders' })).toBe('actor');
    expect(getBriefShape({ category: 'Actors', subcategory: 'Non-State & Proxy Leaders' })).toBe('actor');
    expect(getBriefShape({ category: 'Actors', subcategory: 'Historic RAF Personnel' })).toBe('raf-asset-historic');
  });

  test('Threats, Treaties, AOR, Allies resolve correctly', () => {
    expect(getBriefShape({ category: 'Threats' })).toBe('threat');
    expect(getBriefShape({ category: 'Treaties' })).toBe('treaty');
    expect(getBriefShape({ category: 'AOR',    subcategory: 'Middle East & CENTCOM' })).toBe('region-or-ally');
    expect(getBriefShape({ category: 'Allies', subcategory: 'NATO' })).toBe('region-or-ally');
  });

  test('historic:true flag flips RAF-native categories to raf-asset-historic', () => {
    expect(getBriefShape({ category: 'Aircrafts', historic: true })).toBe('raf-asset-historic');
    expect(getBriefShape({ category: 'Squadrons', historic: true })).toBe('raf-asset-historic');
  });

  test('historic subcategories on RAF-native categories resolve to raf-asset-historic', () => {
    expect(getBriefShape({ category: 'Missions',  subcategory: 'World War II' })).toBe('raf-asset-historic');
    expect(getBriefShape({ category: 'Missions',  subcategory: 'Post-War & Cold War' })).toBe('raf-asset-historic');
    expect(getBriefShape({ category: 'Aircrafts', subcategory: 'Historic — WWII' })).toBe('raf-asset-historic');
    expect(getBriefShape({ category: 'Squadrons', subcategory: 'Historic' })).toBe('raf-asset-historic');
    expect(getBriefShape({ category: 'Bases',     subcategory: 'UK Former' })).toBe('raf-asset-historic');
  });

  test('Modern Missions subcategories stay raf-asset', () => {
    expect(getBriefShape({ category: 'Missions', subcategory: 'NATO Standing Operations' })).toBe('raf-asset');
    expect(getBriefShape({ category: 'Missions', subcategory: 'Humanitarian & NEO' })).toBe('raf-asset');
  });
});

describe('SUBTITLE_SPEC', () => {
  test('instructs the model to identify the subject, not justify an RAF connection', () => {
    expect(SUBTITLE_SPEC).toMatch(/identity sentence/);
    expect(SUBTITLE_SPEC).toMatch(/Do NOT justify or deny any RAF connection/);
    expect(SUBTITLE_SPEC).not.toMatch(/summarising the subject/);
  });
});

describe('buildDescriptionSectionsSpec', () => {
  test('raf-asset (default) retains the original RAF-training framing', () => {
    const { array } = buildDescriptionSectionsSpec({ strict: true, shape: 'raf-asset' });
    expect(array).toMatch(/training phases, roles, or bases/);
    expect(array).toMatch(/RAF significance/);
  });

  test('actor shape drops RAF-training/bases/significance framing entirely', () => {
    const { array } = buildDescriptionSectionsSpec({ strict: true, shape: 'actor' });
    expect(array).not.toMatch(/RAF bases/);
    expect(array).not.toMatch(/training phases/);
    expect(array).not.toMatch(/RAF significance/);
    expect(array).not.toMatch(/modern RAF/);
    // but sections 2-4 should still give the model something concrete
    expect(array).toMatch(/chain of command|appointment date|Position held/);
    expect(array).toMatch(/forces, organisation, or region/i);
  });

  test('threat shape focuses on capability + UK/NATO counter-response', () => {
    const { array } = buildDescriptionSectionsSpec({ strict: true, shape: 'threat' });
    expect(array).not.toMatch(/training phases/);
    expect(array).not.toMatch(/modern RAF/);
    expect(array).toMatch(/employment doctrine/);
    expect(array).toMatch(/counter-response|counter or mitigate/);
  });

  test('treaty shape focuses on obligations + UK implications', () => {
    const { array } = buildDescriptionSectionsSpec({ strict: true, shape: 'treaty' });
    expect(array).not.toMatch(/training phases/);
    expect(array).toMatch(/Signatories/);
    expect(array).toMatch(/UK implications|RAF posture|basing|overflight/);
  });

  test('region-or-ally shape focuses on composition + UK footprint', () => {
    const { array } = buildDescriptionSectionsSpec({ strict: true, shape: 'region-or-ally' });
    expect(array).not.toMatch(/training phases/);
    expect(array).toMatch(/Composition, membership, or geography/);
    expect(array).toMatch(/UK \/ RAF operational footprint/);
  });

  test('raf-asset-historic shape frames in era, not modern-day', () => {
    const { array } = buildDescriptionSectionsSpec({ strict: true, shape: 'raf-asset-historic' });
    expect(array).not.toMatch(/modern RAF/);
    expect(array).toMatch(/service era|during its active period|RAF history/);
  });

  test('strict mode emits EXACTLY 4 rule; non-strict emits 2-4 rule', () => {
    const strict    = buildDescriptionSectionsSpec({ strict: true,  shape: 'raf-asset' });
    const nonStrict = buildDescriptionSectionsSpec({ strict: false, shape: 'raf-asset' });
    expect(strict.countRule).toMatch(/EXACTLY 4 objects/);
    expect(nonStrict.countRule).toMatch(/2–4 objects/);
  });

  test('every shape asks for heading + body on each section', () => {
    for (const shape of ['raf-asset', 'raf-asset-historic', 'actor', 'threat', 'treaty', 'region-or-ally']) {
      const { array, countRule } = buildDescriptionSectionsSpec({ strict: true, shape });
      expect(array).toMatch(/"heading"/);
      expect(array).toMatch(/"body"/);
      // Section 4 must be explicitly headingless (empty heading string)
      expect(array).toMatch(/"heading":\s*""/);
      expect(countRule).toMatch(/empty string for section 4/);
    }
  });

  test('section 4 still carries the blind-identity rule on every shape', () => {
    for (const shape of ['raf-asset', 'raf-asset-historic', 'actor', 'threat', 'treaty', 'region-or-ally']) {
      const { array } = buildDescriptionSectionsSpec({ strict: true, shape });
      expect(array).toMatch(/do NOT mention the subject's name/);
    }
  });
});

describe('buildTopicUserGuidance', () => {
  test('raf-asset keeps the RAF training-pathways language', () => {
    expect(buildTopicUserGuidance('raf-asset')).toMatch(/training pathways/);
    expect(buildTopicUserGuidance('raf-asset')).toMatch(/modern-day RAF significance/);
  });

  test('actor guidance prevents forcing a direct RAF connection', () => {
    const guidance = buildTopicUserGuidance('actor');
    expect(guidance).toMatch(/Do not force a direct RAF connection/);
    expect(guidance).toMatch(/position held|chain of command/i);
    expect(guidance).not.toMatch(/training pathways/);
  });

  test('threat guidance targets capability + counter-response', () => {
    const guidance = buildTopicUserGuidance('threat');
    expect(guidance).toMatch(/threat assessment/);
    expect(guidance).toMatch(/UK \/ NATO counter-response/);
    expect(guidance).not.toMatch(/training pathways/);
  });

  test('treaty guidance asks for signatories + UK implications', () => {
    const guidance = buildTopicUserGuidance('treaty');
    expect(guidance).toMatch(/signatories/i);
    expect(guidance).toMatch(/UK implications/);
    expect(guidance).not.toMatch(/training pathways/);
  });

  test('region-or-ally guidance asks for composition + UK footprint', () => {
    const guidance = buildTopicUserGuidance('region-or-ally');
    expect(guidance).toMatch(/region or alliance/);
    expect(guidance).toMatch(/UK \/ RAF operational footprint/);
    expect(guidance).not.toMatch(/training pathways/);
  });

  test('raf-asset-historic frames in era, not modern-day', () => {
    const guidance = buildTopicUserGuidance('raf-asset-historic');
    expect(guidance).toMatch(/RAF history|service era|active period/);
    // guidance may reference "not as modern-day" as a negative instruction; only
    // fail if it asks the model to cover modern-day context as a positive goal.
    expect(guidance).not.toMatch(/modern-day RAF significance/);
  });

  test('unknown shape falls back to raf-asset guidance', () => {
    expect(buildTopicUserGuidance('bogus-shape')).toBe(buildTopicUserGuidance('raf-asset'));
  });
});
