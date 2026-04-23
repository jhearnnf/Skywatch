/**
 * Unit tests for validateAirframeTitle + validateBriefTitleForCategory — the
 * airframe-specific title gate that blocks generic role phrases, subcategory
 * names, and plural-suffix titles from being used for Aircrafts briefs/leads.
 *
 * The gate exists because the AI auto-seeder was slipping through entries like
 * "Maritime Patrol Aircraft", "Maritime Patrol and Reconnaissance", and
 * "Wildcat Helicopters" — all roles/umbrella names, not specific airframes.
 */

const {
  validateAirframeTitle,
  validateBriefTitleForCategory,
} = require('../../utils/airframeValidation');

describe('validateAirframeTitle', () => {
  describe('rejects generic role phrases', () => {
    test.each([
      'Maritime Patrol and Reconnaissance',
      'maritime patrol and reconnaissance',
      'Close Air Support',
      'Airborne Early Warning and Control',
      'Suppression of Enemy Air Defences',
      'Air-to-Air Refuelling',
      'Strategic Airlift',
      'Electronic Warfare',
    ])('rejects "%s"', (title) => {
      const r = validateAirframeTitle(title);
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/role or mission/i);
    });
  });

  describe('rejects titles ending in generic category words', () => {
    test.each([
      ['Maritime Patrol Aircraft', 'aircraft'],
      ['Wildcat Helicopters',      'helicopters'],
      ['Fifth Generation Fighter', 'fighter'],
      ['Heavy Bombers',            'bombers'],
      ['Unmanned Drones',          'drones'],
      ['Advanced Trainer',         'trainer'],
    ])('rejects "%s" (trailing "%s")', (title, word) => {
      const r = validateAirframeTitle(title);
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(new RegExp(`generic category word.*${word}`, 'i'));
    });
  });

  describe('rejects exact subcategory names', () => {
    test.each([
      'Fast Jet',
      'Maritime Patrol',
      'Rotary Wing',
      'Training Aircraft',
      'ISR & Surveillance',
      'Transport & Tanker',
    ])('rejects "%s"', (title) => {
      const r = validateAirframeTitle(title);
      expect(r.ok).toBe(false);
      // Could hit either the subcategory-name rule or the trailing-word rule
      expect(r.message).toMatch(/subcategory|generic category|role or mission/i);
    });
  });

  describe('accepts legitimate airframe designations', () => {
    test.each([
      'Eurofighter Typhoon FGR4',
      'F-35B Lightning II',
      'P-8A Poseidon MRA1',
      'AW159 Wildcat',
      'Chinook HC6/6A',
      'Supermarine Spitfire',
      'Avro Lancaster B.I',
      'Hawk T2',
      'RC-135W Rivet Joint',
      'AgustaWestland AW101 Merlin',
      'BAE Systems Hawk T1',
      'Armstrong Whitworth Argosy',
      'Hawker Siddeley Nimrod R1',
    ])('accepts "%s"', (title) => {
      const r = validateAirframeTitle(title);
      expect(r.ok).toBe(true);
    });
  });

  describe('input handling', () => {
    test('rejects empty string', () => {
      expect(validateAirframeTitle('').ok).toBe(false);
    });
    test('rejects whitespace-only', () => {
      expect(validateAirframeTitle('   ').ok).toBe(false);
    });
    test('rejects null/undefined', () => {
      expect(validateAirframeTitle(null).ok).toBe(false);
      expect(validateAirframeTitle(undefined).ok).toBe(false);
    });
    test('trims surrounding whitespace before checking', () => {
      expect(validateAirframeTitle('  Wildcat Helicopters  ').ok).toBe(false);
      expect(validateAirframeTitle('  P-8A Poseidon MRA1  ').ok).toBe(true);
    });
  });
});

describe('validateBriefTitleForCategory', () => {
  test('only gates Aircrafts — other categories pass through', () => {
    // Titles that would fail the airframe check are fine in other categories:
    expect(validateBriefTitleForCategory('Close Air Support', 'Terminology').ok).toBe(true);
    expect(validateBriefTitleForCategory('Fast Jet', 'Roles').ok).toBe(true);
    expect(validateBriefTitleForCategory('Maritime Patrol', 'Missions').ok).toBe(true);
  });

  test('blocks generic titles under Aircrafts', () => {
    expect(validateBriefTitleForCategory('Maritime Patrol Aircraft', 'Aircrafts').ok).toBe(false);
    expect(validateBriefTitleForCategory('Wildcat Helicopters', 'Aircrafts').ok).toBe(false);
  });

  test('allows airframe titles under Aircrafts', () => {
    expect(validateBriefTitleForCategory('Typhoon FGR4', 'Aircrafts').ok).toBe(true);
  });
});
