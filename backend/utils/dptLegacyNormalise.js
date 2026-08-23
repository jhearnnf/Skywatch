// Normalising pre-split DPT runs onto the four-round Hard board.
//
// DPT shipped as one eight-round ladder. The Easier/Hard split cut it in half —
// Easier plays rounds 1–4, Hard plays rounds 5–8 — which leaves 161 recorded
// runs whose totals include four rounds that are no longer part of Hard. Left
// alone they would sit permanently above anything a real four-round run could
// score.
//
// ── What rounds 1–4 could have been worth ───────────────────────────────────
//
// Rounds 5–8 exclusively own every intercept (the Fighter arrives at round 6),
// every danger zone (they start at round 5) and every enemy collision. So the
// only score rounds 1–4 can ever have contributed is:
//
//     gates:   2 + 2 + 3 + 5 = 12  ×  100  =  1200
//     bonuses: 50 × (1 + 2 + 3 + 4)        =   500
//                                            ------
//                                             1700
//
// which is also, exactly, a perfect score on the new Easier board.
//
// ── Why it is an estimate ───────────────────────────────────────────────────
//
// It cannot be computed exactly from what was stored. A round ends on "all
// gates hit OR the timer expired", so every run reached round 8 regardless of
// how it went, and `finalRound: 8` says nothing. Nothing records which round a
// gate was hit in, the CA-A/CA-N-into-an-enemy penalty increments no counter at
// all, and the danger-zone penalty accrues per second while only entries are
// stored. Three unknowns, one equation.
//
// So this assumes a run cleared rounds 1–4. Two things make that safe enough:
//
//   • Subtracting a constant preserves the order of the legacy runs exactly.
//     The only comparison it changes is legacy-against-future, which is the
//     whole point of doing it.
//   • The assumption is strongest where it matters. Every run near the top of
//     the board hit 33 or more of the 36 gates; a player who cleared round 5
//     (6 gates in 120s) did not time out on round 4 (5 gates in 120s). The runs
//     where it is shaky are the ten with fewer than 12 gates total, which sit
//     at the bottom either way.
//
// The one guard: never charge a run for gates it demonstrably never hit. A run
// with 7 gates total cannot have earned 12 gates' worth in rounds 1–4, so the
// gate half of the subtraction is capped at what it actually hit.

// Gates available across rounds 1–4 (2 + 2 + 3 + 5).
const EARLY_GATES = 12;
const POINTS_PER_GATE = 100;
// 50 × (1 + 2 + 3 + 4) — the round-completion bonuses for rounds 1–4.
const EARLY_ROUND_BONUS = 500;

// A perfect rounds 1–4 half, and therefore the flat subtraction applied to any
// run that hit at least 12 gates (151 of the 161).
const FULL_EARLY_VALUE = EARLY_GATES * POINTS_PER_GATE + EARLY_ROUND_BONUS;

// What to take off a pre-split run's total.
function earlyRoundValue(gatesHit) {
  const gates = Math.min(Math.max(gatesHit || 0, 0), EARLY_GATES);
  return gates * POINTS_PER_GATE + EARLY_ROUND_BONUS;
}

// The four-round Hard score a pre-split run is treated as having set.
// Floored at 0 — 28 runs scored less than 1700 in total.
function normaliseLegacyDptScore({ totalScore, gatesHit }) {
  return Math.max(0, (totalScore || 0) - earlyRoundValue(gatesHit));
}

module.exports = {
  EARLY_GATES,
  EARLY_ROUND_BONUS,
  FULL_EARLY_VALUE,
  earlyRoundValue,
  normaliseLegacyDptScore,
};
