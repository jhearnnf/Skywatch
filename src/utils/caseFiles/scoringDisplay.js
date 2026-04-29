/**
 * scoringDisplay.js
 * Pure utility functions for rendering scoring data in Case Files debrief UI.
 * No React or DOM dependencies — safe to unit-test without jsdom.
 */

/**
 * formatScore(score, maxScore)
 * Returns "250 / 500" — integers only, locale-en formatting.
 * @param {number} score
 * @param {number} maxScore
 * @returns {string}
 */
export function formatScore(score, maxScore) {
  const s = Math.round(score ?? 0).toLocaleString('en')
  const m = Math.round(maxScore ?? 0).toLocaleString('en')
  return `${s} / ${m}`
}

/**
 * formatPct(score, maxScore)
 * Returns "100%" (integer, rounded). Returns "0%" when maxScore is 0.
 * @param {number} score
 * @param {number} maxScore
 * @returns {string}
 */
export function formatPct(score, maxScore) {
  if (!maxScore) return '0%'
  return `${Math.round(((score ?? 0) / maxScore) * 100)}%`
}

/**
 * stageTypeLabel(stageType)
 * Returns a human-readable label for each of the 8 stage types.
 * @param {string} stageType
 * @returns {string}
 */
export function stageTypeLabel(stageType) {
  const LABELS = {
    cold_open:           'Briefing',
    evidence_wall:       'Evidence Wall',
    decision_point:      'Decision Point',
    phase_reveal:        'Phase Reveal',
    map_predictive:      'Map Prediction',
    map_live:            'Live Map',
    actor_interrogation: 'Actor Interrogation',
    debrief:             'Debrief',
  }
  return LABELS[stageType] ?? stageType
}

/**
 * gradeForPct(pct)
 * Returns a letter grade for a percentage (0–100 integer).
 *
 * Thresholds:
 *   95–100 → S  (exceptional)
 *   80–94  → A  (strong)
 *   60–79  → B  (solid)
 *   40–59  → C  (adequate)
 *   1–39   → D  (poor)
 *   0      → –  (no attempt / zero score)
 *
 * @param {number} pct  Integer percentage 0–100
 * @returns {'S'|'A'|'B'|'C'|'D'|'–'}
 */
export function gradeForPct(pct) {
  if (pct >= 95) return 'S'  // 95–100: exceptional
  if (pct >= 80) return 'A'  // 80–94:  strong
  if (pct >= 60) return 'B'  // 60–79:  solid
  if (pct >= 40) return 'C'  // 40–59:  adequate
  if (pct >= 1)  return 'D'  // 1–39:   poor
  return '–'                 // 0:      no attempt
}
