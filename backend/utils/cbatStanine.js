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

// The stanine a given raw score earns on a given game, or null if the game has no anchors.
function scoreToStanine(gameKey, score) {
  const a = STANINE_ANCHORS[gameKey];
  if (!a || !Number.isFinite(score)) return null;
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
  const step = stanineStep(gameKey);
  return Math.ceil(a.median + (target - MEDIAN_STANINE - 0.5) * step);
}

module.exports = {
  scoreToStanine,
  scoreForStanine,
  stanineStep,
  clampStanine,
  MIN_STANINE,
  MEDIAN_STANINE,
  STRONG_STANINE,
};
