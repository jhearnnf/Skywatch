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
// so one stanine step = (strong - median) / 3, and
//
//   stanine = clamp(round(5 + (score - median) / step), 1, 9)
//
// The line is deliberately simple and deliberately visible in the data file. It is a calibrated
// estimate against SkyWatch's own norms and the report page says so in as many words — it is NOT a
// prediction of what OASC would award.

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

const { MAX_STANINE, STANINE_ANCHORS } = require('../constants/cbatBatteries');

const MIN_STANINE = 1;
const MEDIAN_STANINE = 5;   // anchor: middle of the field
const STRONG_STANINE = 8;   // anchor: a clearly good run

const clampStanine = (n) => Math.min(MAX_STANINE, Math.max(MIN_STANINE, n));

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
function scoreToStanine(gameKey, score) {
  const a = STANINE_ANCHORS[gameKey];
  if (!a || !Number.isFinite(score)) return null;
  const top = topSegment(gameKey);
  if (top && score > top.from) {
    return clampStanine(Math.round(STRONG_STANINE + (score - top.from) / top.span));
  }
  const step = stanineStep(gameKey);
  return clampStanine(Math.round(MEDIAN_STANINE + (score - a.median) / step));
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
function scoreForStanine(gameKey, target) {
  const a = STANINE_ANCHORS[gameKey];
  if (!a || target <= MIN_STANINE || target > MAX_STANINE) return null;
  const top = topSegment(gameKey);
  if (top && target > STRONG_STANINE) {
    return Math.ceil(top.from + (target - STRONG_STANINE - 0.5) * top.span);
  }
  const step = stanineStep(gameKey);
  return Math.ceil(a.median + (target - MEDIAN_STANINE - 0.5) * step);
}

module.exports = {
  scoreToStanine,
  scoreForStanine,
  stanineStep,
  topSegment,
  clampStanine,
  MIN_STANINE,
  MEDIAN_STANINE,
  STRONG_STANINE,
};
