const { SUBCATEGORIES } = require('../constants/categories');

// Trailing words that indicate a generic category rather than a specific
// airframe. Real model designations end in a mark (e.g. "FGR4"), a numeric
// variant (e.g. "T2"), or a proper name (e.g. "Spitfire") — never in a bare
// category noun.
const GENERIC_TRAILING_WORDS = new Set([
  'aircraft', 'aircrafts',
  'helicopter', 'helicopters',
  'jet', 'jets',
  'fighter', 'fighters',
  'bomber', 'bombers',
  'drone', 'drones',
  'airframe', 'airframes',
  'trainer', 'trainers',
  'rpa', 'rpas',
  'uav', 'uavs',
]);

// Pure role/mission phrases that should never be used as a brief title in the
// Aircrafts category — these describe a *capability*, not an airframe.
const GENERIC_ROLE_PHRASES = new Set([
  'maritime patrol and reconnaissance',
  'maritime patrol & reconnaissance',
  'close air support',
  'airborne early warning',
  'airborne early warning and control',
  'suppression of enemy air defences',
  'suppression of enemy air defenses',
  'destruction of enemy air defences',
  'destruction of enemy air defenses',
  'defensive counter air',
  'offensive counter air',
  'combat search and rescue',
  'air-to-air refuelling',
  'air to air refuelling',
  'air-to-air refueling',
  'strategic airlift',
  'tactical airlift',
  'electronic warfare',
  'signals intelligence',
  'isr and surveillance',
  'isr & surveillance',
]);

/**
 * Validate that a title intended for an Aircrafts-category brief or lead looks
 * like a specific airframe (e.g. "P-8A Poseidon MRA1") and not a generic
 * role/category phrase ("Maritime Patrol Aircraft", "Fast Jet", "Wildcat
 * Helicopters", "Maritime Patrol and Reconnaissance").
 *
 * Returns { ok: true } on pass, { ok: false, message: string } on fail.
 *
 * Only call when category === 'Aircrafts' — other categories allow concept
 * titles (e.g. Terminology, Roles).
 */
function validateAirframeTitle(title) {
  if (!title || typeof title !== 'string') {
    return { ok: false, message: 'Title is required' };
  }
  const trimmed = title.trim();
  if (!trimmed) {
    return { ok: false, message: 'Title is required' };
  }
  const lower = trimmed.toLowerCase();

  // 1. Exact match against an Aircrafts subcategory name
  const aircraftSubs = (SUBCATEGORIES.Aircrafts ?? []).map(s => s.toLowerCase());
  if (aircraftSubs.includes(lower)) {
    return {
      ok: false,
      message: `"${trimmed}" is a subcategory name, not a specific airframe. Use a model designation (e.g. "Eurofighter Typhoon FGR4", "P-8A Poseidon MRA1").`,
    };
  }

  // 2. Pure role/mission phrase
  if (GENERIC_ROLE_PHRASES.has(lower)) {
    return {
      ok: false,
      message: `"${trimmed}" describes a role or mission, not a specific airframe. Use a model designation instead.`,
    };
  }

  // 3. Trailing generic category word (e.g. "Maritime Patrol Aircraft",
  //    "Wildcat Helicopters", "Multi-Role Fighter")
  const words = lower.split(/\s+/);
  const lastWord = words[words.length - 1];
  if (GENERIC_TRAILING_WORDS.has(lastWord)) {
    return {
      ok: false,
      message: `"${trimmed}" ends in a generic category word ("${lastWord}"). Use a specific model designation (e.g. "AW159 Wildcat", "P-8A Poseidon MRA1").`,
    };
  }

  return { ok: true };
}

/**
 * Convenience wrapper — only validates when category is Aircrafts.
 * Other categories are always { ok: true }.
 */
function validateBriefTitleForCategory(title, category) {
  if (category !== 'Aircrafts') return { ok: true };
  return validateAirframeTitle(title);
}

module.exports = {
  validateAirframeTitle,
  validateBriefTitleForCategory,
  // Exported for tests
  GENERIC_TRAILING_WORDS,
  GENERIC_ROLE_PHRASES,
};
