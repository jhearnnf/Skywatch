// Raw SkyWatch score → stanine (1-9).
//
// A stanine is the 1-9 scale the real OASC sheet reports every test on: a normal curve cut into
// nine bands, mean 5, standard deviation 2. Bands 1 and 9 hold the outer 4% each, 2 and 8 the next
// 7%, 3 and 7 the next 12%, 4 and 6 the next 17%, and 5 the middle 20%. That is why a stanine of 5
// is "average" and why the step from 7 to 8 represents far more improvement than 4 to 5.
//
// We can't compute a true normalised stanine: that needs the RAF's own applicant distribution, and
// SkyWatch's players are a self-selected group of people who practise. What we can do is anchor a
// straight line through two points we DO have real numbers for — see cbatBatteries.json's
// stanineAnchors — and read a stanine off it:
//
//   median → 5   (the middle of the field)
//   strong → 8   (a clearly good run)
//
// so one stanine step = (strong - median) / 3, and, with the cohort shift described below,
//
//   stanine = clamp(round(cohortShift(5 + (score - median) / step)), 1, 9)
//
// The line is deliberately simple and deliberately visible in the data file. It is a calibrated
// estimate, anchored on SkyWatch's own norms and nudged toward OASC's by a single measured pair,
// and the report page says so in as many words — it is NOT a prediction of what OASC would award.

// THE LINE HAS TO STAY INSIDE THE GAME'S CEILING. A game marked out of a fixed total carries a
// `max` alongside its anchors, because a straight line fitted to two measured points knows nothing
// about where the scale stops. ANT is the case that caught it: the measured anchors (53, 77) sit on
// a board marked out of 80, so the line put the stanine-9 threshold at 81 and the report spent its
// time telling players to average a score the game cannot award. A real OASC sheet awards 9s on
// every test, so "this test tops out at 8" is never the right answer.
//
// Where a `max` exists AND the plain line overshoots it, the top band is compressed: `strong` still
// reads 8, `max` reads exactly 9, and the segment between them is straight. Nothing at or below
// `strong` moves, and a game whose line already lands inside its ceiling is left completely alone -
// this is a guard against the overshoot, not a second scale. It applies in both directions at once,
// which is the point: clamping only the "aim for this" number would have the report name a target
// that still scored an 8 when you hit it.

// THE LINE IS THEN SHIFTED UP BY `cohortShift`. The two anchors describe where a score sits among
// SkyWatch players; the report is asked where it would sit on an OASC sheet, and those are not the
// same field. Everyone here chose to practise, and several of our games are harder than the tests
// they stand in for, so the same person reads lower here than on the day — measured at 1.5 to 2.9
// stanines on the one candidate we have a real sheet's worth of numbers for. cohortShift carries
// half of that, and cbatBatteries.json's `_cohortShiftComment` carries the evidence and the reason
// it is deliberately only half.
//
// It belongs here rather than in the anchors because the anchors are MEASURED — scripts/
// calibrateStanineAnchors.js overwrites them wholesale — and a correction hidden inside a median
// would be silently deleted by the next honest re-run. Keep the two apart.
//
// THE SHIFT TAPERS ABOVE THE MEDIAN, and it has to. A flat shift saturates the top of the scale:
// test stanines are rounded before they are averaged, so any flat shift of half a stanine or more
// rounds the `strong` anchor itself up to 9, every test a strong player has reads 9, and the
// report hands them 180 out of 180 with nothing left to aim at on any game. That is both a claim
// we must never make and the exact moment the page stops being useful. A flat shift below half a
// stanine is the opposite failure — it rounds away to nothing and moves nobody.
//
// So the shift is applied whole at and below the median, where the evidence sits (our one measured
// candidate read 5.1-6.5 against a real 8.0, i.e. near the middle of OUR field), and fades linearly
// to nothing at 9. A 9 is the top of the scale on anyone's sheet, so it is the one point that needs
// no translating.

const { MAX_STANINE, STANINE_ANCHORS, COHORT_SHIFT } = require('../constants/cbatBatteries');

const MIN_STANINE = 1;
const MEDIAN_STANINE = 5;   // anchor: middle of the field
const STRONG_STANINE = 8;   // anchor: a clearly good run

const clampStanine = (n) => Math.min(MAX_STANINE, Math.max(MIN_STANINE, n));

// The shift, tapered. Straight addition at or below the median, fading to zero at MAX_STANINE.
// Continuous at the median (both branches give median + shift) and monotonic in `s` for any shift
// smaller than MAX_STANINE - MEDIAN_STANINE, which the unit tests assert.
function applyCohortShift(s) {
  if (!COHORT_SHIFT) return s;
  if (s <= MEDIAN_STANINE) return s + COHORT_SHIFT;
  return s + COHORT_SHIFT * ((MAX_STANINE - s) / (MAX_STANINE - MEDIAN_STANINE));
}

// Its exact inverse: the point on the unshifted line that applyCohortShift maps to `t`. Above the
// median the shift is s -> s(1 - k) + MAX*k for k = shift / (MAX - MEDIAN), so undoing it is the
// same algebra rearranged.
function removeCohortShift(t) {
  if (!COHORT_SHIFT) return t;
  if (t <= MEDIAN_STANINE + COHORT_SHIFT) return t - COHORT_SHIFT;
  const k = COHORT_SHIFT / (MAX_STANINE - MEDIAN_STANINE);
  return (t - MAX_STANINE * k) / (1 - k);
}

// One stanine's worth of raw score for a game. Anchors are authored strong > median for every
// game (higher is always better among the games a battery draws on — asserted in the unit tests),
// so this is always positive.
function stanineStep(gameKey) {
  const a = STANINE_ANCHORS[gameKey];
  if (!a) return null;
  return (a.strong - a.median) / (STRONG_STANINE - MEDIAN_STANINE);
}

// The compressed 8-to-9 segment for a bounded game, or null when the plain line already fits.
// `span` is one stanine's worth of raw score across that last band; below `from` the plain line is
// still in charge.
function topSegment(gameKey) {
  const a = STANINE_ANCHORS[gameKey];
  if (!a || !Number.isFinite(a.max) || a.max <= a.strong) return null;
  // Where the plain line first rounds up to 9. Rounding is half-up, so the band opens half a step
  // below its centre.
  const linearNine = a.median + (MAX_STANINE - MEDIAN_STANINE - 0.5) * stanineStep(gameKey);
  if (linearNine <= a.max) return null;
  return { from: a.strong, span: a.max - a.strong };
}

// The stanine a given raw score earns on a given game, or null if the game has no anchors.
//
// The cohort shift goes on before the rounding and the clamp, so it moves the scale rather than
// the printed number: a score that would have read 5.4 among SkyWatch players reads 6.4 — and
// therefore 6 — as an OASC estimate.
function scoreToStanine(gameKey, score) {
  const a = STANINE_ANCHORS[gameKey];
  if (!a || !Number.isFinite(score)) return null;
  const top = topSegment(gameKey);
  if (top && score > top.from) {
    return clampStanine(Math.round(applyCohortShift(STRONG_STANINE + (score - top.from) / top.span)));
  }
  const step = stanineStep(gameKey);
  return clampStanine(Math.round(applyCohortShift(MEDIAN_STANINE + (score - a.median) / step)));
}

// The lowest whole score that reaches AT LEAST `target`. Powers the report's "you're on a 5;
// average 409 over your next few runs for a 6" line, which is the whole point of showing a stanine
// rather than a percentile — it converts back into something you can aim at in the game.
//
// Rounding is half-up, so the band for stanine n opens half a step below its centre; the ceil then
// takes the first whole score inside it.
//
// "At least", not "exactly", because on a game with few possible scores the stanine bands are
// narrower than one point and some of them contain no whole score at all. Trace 2 runs 0-8 with a
// step of 0.67, so its stanine-3 band spans 3.34 to 3.99 and the first reachable score above it,
// 4, is already a stanine 4. Overshooting is the right failure: a user told to average 4+ for a 3
// gets a 4, whereas rounding down would tell them 3 is enough when it isn't.
//
// Returns null at the ends of the scale, where there is nothing left to aim for (9) or nothing
// below (1).
//
// COHORT_SHIFT has to come back off here, or the two halves disagree and the report starts naming
// scores that do not produce the stanine it promised. `base` is the point on the unshifted line
// that scoreToStanine will read back as `target` — including which side of a bounded game's
// compressed top segment it falls on, which is a fact about the line and not about the shift.
function scoreForStanine(gameKey, target) {
  const a = STANINE_ANCHORS[gameKey];
  if (!a || target <= MIN_STANINE || target > MAX_STANINE) return null;
  const base = removeCohortShift(target);
  const top = topSegment(gameKey);
  if (top && base > STRONG_STANINE) {
    return Math.ceil(top.from + (base - STRONG_STANINE - 0.5) * top.span);
  }
  const step = stanineStep(gameKey);
  return Math.ceil(a.median + (base - MEDIAN_STANINE - 0.5) * step);
}

module.exports = {
  scoreToStanine,
  scoreForStanine,
  stanineStep,
  topSegment,
  clampStanine,
  COHORT_SHIFT,
  applyCohortShift,
  removeCohortShift,
  MIN_STANINE,
  MEDIAN_STANINE,
  STRONG_STANINE,
};
