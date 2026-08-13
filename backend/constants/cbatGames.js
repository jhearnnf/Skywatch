const GameSessionCbatPlaneTurnResult      = require('../models/GameSessionCbatPlaneTurnResult');
const GameSessionCbatAnglesResult         = require('../models/GameSessionCbatAnglesResult');
const GameSessionCbatCodeDuplicatesResult = require('../models/GameSessionCbatCodeDuplicatesResult');
const GameSessionCbatSymbolsResult        = require('../models/GameSessionCbatSymbolsResult');
const GameSessionCbatTargetResult         = require('../models/GameSessionCbatTargetResult');
const GameSessionCbatInstrumentsResult    = require('../models/GameSessionCbatInstrumentsResult');
const GameSessionCbatAntResult            = require('../models/GameSessionCbatAntResult');
const GameSessionCbatFlagResult           = require('../models/GameSessionCbatFlagResult');
const GameSessionCbatFlagEasierResult     = require('../models/GameSessionCbatFlagEasierResult');
const GameSessionCbatVisualisation2DResult = require('../models/GameSessionCbatVisualisation2DResult');
const GameSessionCbatVisualisation3DResult = require('../models/GameSessionCbatVisualisation3DResult');
const GameSessionCbatDptResult           = require('../models/GameSessionCbatDptResult');
const GameSessionCbatActResult           = require('../models/GameSessionCbatActResult');
const GameSessionCbatTrace1Result        = require('../models/GameSessionCbatTrace1Result');
const GameSessionCbatTrace2Result        = require('../models/GameSessionCbatTrace2Result');
const GameSessionCbatNumericalOpsResult  = require('../models/GameSessionCbatNumericalOpsResult');
const GameSessionCbatNumericalOpsEasierResult = require('../models/GameSessionCbatNumericalOpsEasierResult');
const GameSessionCbatDADResult           = require('../models/GameSessionCbatDADResult');
const GameSessionCbatSatResult           = require('../models/GameSessionCbatSatResult');
const GameSessionCbatSatEasierResult     = require('../models/GameSessionCbatSatEasierResult');
const GameSessionCbatCutResult           = require('../models/GameSessionCbatCutResult');
const GameSessionCbatCutEasierResult     = require('../models/GameSessionCbatCutEasierResult');
const GameSessionCbatRttResult           = require('../models/GameSessionCbatRttResult');
const GameSessionCbatRttEasierResult     = require('../models/GameSessionCbatRttEasierResult');
const GameSessionCbatSitResult           = require('../models/GameSessionCbatSitResult');
const GameSessionCbatSitEasierResult     = require('../models/GameSessionCbatSitEasierResult');
const GameSessionCbatSltResult           = require('../models/GameSessionCbatSltResult');
const GameSessionCbatSltEasierResult     = require('../models/GameSessionCbatSltEasierResult');
const GameSessionCbatVltResult           = require('../models/GameSessionCbatVltResult');
const GameSessionCbatVltEasierResult     = require('../models/GameSessionCbatVltEasierResult');
const GameSessionCbatMatfResult          = require('../models/GameSessionCbatMatfResult');
const GameSessionCbatMatfEasierResult    = require('../models/GameSessionCbatMatfEasierResult');
const GameSessionCbatVigilanceResult     = require('../models/GameSessionCbatVigilanceResult');
const GameSessionCbatSmaResult           = require('../models/GameSessionCbatSmaResult');
const GameSessionCbatSmaEasierResult     = require('../models/GameSessionCbatSmaEasierResult');

// Single source of truth for CBAT games. Adding a new CBAT game = add one entry
// here and it automatically flows through submission routes, leaderboards,
// personal-best endpoints, and admin user stats.
// `modeFilter`, when present, is merged into every $match / find that targets
// this entry's collection. It's how two registry entries can share a single
// Model (e.g. plane-turn-2d and plane-turn-3d both read GameSessionCbatPlaneTurnResult,
// scoped by the `mode` field). Every CBAT_GAMES consumer MUST spread it into
// queries: `{ ...cfg.modeFilter, ...other }` for find/countDocuments,
// `{ $match: { ...cfg.modeFilter, ...other } }` for aggregations.
//
// `weeklyExpr` (optional) is the per-session MongoDB aggregation expression
// summed into a user's weekly total on the weekly leaderboard. When omitted the
// weekly value is just the primaryField (so each replay adds its score — e.g.
// Target 100 then 200 = 300 for the week). Lower-is-better games can't sum
// their primaryField sensibly (more practice would mean a worse total), so they
// supply a derived higher-is-better points expression instead. The all-time
// board always uses primaryField/sortDir and is unaffected by weeklyExpr.

// Derived weekly points for a lower-is-better run: fewer rotations and less time
// → more points. Clamped at 0 so a disastrous run never subtracts from the
// week. Constants are tuned per mode off the realistic ranges in
// cbatFakeLeaderboard.js and are safe to retune without touching the all-time
// board. $round keeps weekly totals integer.
const tracePointsExpr = (base, rotW, timeW) => ({
  $round: [{
    $max: [0, {
      $subtract: [
        base,
        { $add: [
          { $multiply: [{ $ifNull: ['$totalRotations', 0] }, rotW] },
          { $multiply: [{ $ifNull: ['$totalTime', 0] }, timeW] },
        ] },
      ],
    }],
  }, 0],
});

const CBAT_GAMES = {
  'plane-turn-2d': {
    Model: GameSessionCbatPlaneTurnResult,
    primaryField: 'totalRotations',
    sortDir: 1,            // lower is better
    bestOp: '$min',
    label: 'Trace Practise 2D',
    modeFilter: { mode: '2d' },
    // Validated against real 2D sessions (n=42): rotations 40–99 (med 54),
    // time 66–137s (med 88). Yields best ≈177, median ≈152, worst ≈82 — all
    // positive (no clamping), higher = better, so weekly sums sensibly.
    weeklyExpr: tracePointsExpr(250, 1, 0.5),
  },
  'plane-turn-3d': {
    Model: GameSessionCbatPlaneTurnResult,
    primaryField: 'totalRotations',
    sortDir: 1,
    bestOp: '$min',
    label: 'Trace Practise 3D',
    modeFilter: { mode: '3d' },
    // Validated against real 3D sessions (n=9): rotations 160–267 (med 184),
    // time 149–244s (med 173). Lower per-rotation weight since counts are
    // larger. Yields best ≈193, median ≈169, worst ≈90 — all positive.
    weeklyExpr: tracePointsExpr(350, 0.7, 0.3),
  },
  'angles': {
    Model: GameSessionCbatAnglesResult,
    primaryField: 'correctCount',
    sortDir: -1,           // higher is better
    bestOp: '$max',
    label: 'Angles',
  },
  'code-duplicates': {
    Model: GameSessionCbatCodeDuplicatesResult,
    primaryField: 'correctCount',
    sortDir: -1,
    bestOp: '$max',
    label: 'Code Duplicates',
  },
  'symbols': {
    Model: GameSessionCbatSymbolsResult,
    primaryField: 'correctCount',
    sortDir: -1,
    bestOp: '$max',
    label: 'Symbols',
  },
  'target': {
    Model: GameSessionCbatTargetResult,
    primaryField: 'totalScore',
    sortDir: -1,
    bestOp: '$max',
    label: 'Target',
  },
  'instruments': {
    Model: GameSessionCbatInstrumentsResult,
    primaryField: 'correctCount',
    sortDir: -1,
    bestOp: '$max',
    label: 'Instruments',
  },
  'ant': {
    Model: GameSessionCbatAntResult,
    primaryField: 'totalScore',
    sortDir: -1,
    bestOp: '$max',
    label: 'Airborne Numerical Test',
  },
  'flag': {
    Model: GameSessionCbatFlagResult,
    primaryField: 'totalScore',
    sortDir: -1,
    bestOp: '$max',
    label: 'FLAG',
  },
  // FLAG's "Easier" difficulty — slower maths cadence, longer callsign reads,
  // gentler spawn pressure. Its own collection and therefore its own boards;
  // the page at /cbat/flag picks the key from the selected difficulty.
  'flag-easier': {
    Model: GameSessionCbatFlagEasierResult,
    primaryField: 'totalScore',
    sortDir: -1,
    bestOp: '$max',
    label: 'FLAG (Easier)',
  },
  'visualisation-2d': {
    Model: GameSessionCbatVisualisation2DResult,
    primaryField: 'correctCount',
    sortDir: -1,
    bestOp: '$max',
    label: 'Visualisation 2D',
  },
  'visualisation-3d': {
    Model: GameSessionCbatVisualisation3DResult,
    primaryField: 'correctCount',
    sortDir: -1,
    bestOp: '$max',
    label: 'Visualisation 3D',
  },
  'dpt': {
    Model: GameSessionCbatDptResult,
    primaryField: 'totalScore',
    sortDir: -1,
    bestOp: '$max',
    label: 'DPT',
  },
  'act': {
    Model: GameSessionCbatActResult,
    primaryField: 'totalScore',
    sortDir: -1,
    bestOp: '$max',
    label: 'ACT',
  },
  'trace-1': {
    Model: GameSessionCbatTrace1Result,
    primaryField: 'correctTurns',
    sortDir: -1,           // higher is better
    bestOp: '$max',
    label: 'Trace 1',
  },
  'trace-2': {
    Model: GameSessionCbatTrace2Result,
    primaryField: 'correctCount',
    sortDir: -1,           // higher is better
    bestOp: '$max',
    label: 'Trace 2',
  },
  'numerical-ops': {
    Model: GameSessionCbatNumericalOpsResult,
    primaryField: 'correctPercentage',
    sortDir: -1,           // higher is better
    bestOp: '$max',
    label: 'Numerical Operations',
  },
  // Numerical Operations' "Easier" difficulty — smaller numbers per round, ×/÷
  // held inside the 10 times table, and an op mix weighted toward + and −. Its
  // own collection and therefore its own boards; the page at
  // /cbat/numerical-ops picks the key from the selected difficulty.
  'numerical-ops-easier': {
    Model: GameSessionCbatNumericalOpsEasierResult,
    primaryField: 'correctPercentage',
    sortDir: -1,
    bestOp: '$max',
    label: 'Numerical Operations (Easier)',
  },
  'dad': {
    Model: GameSessionCbatDADResult,
    primaryField: 'correctCount',
    sortDir: -1,           // higher is better
    bestOp: '$max',
    label: 'Directions and Distances',
  },
  'sat': {
    Model: GameSessionCbatSatResult,
    primaryField: 'correctCount',
    sortDir: -1,           // higher is better
    bestOp: '$max',
    label: 'Situational Awareness Test',
  },
  // SAT's "Easier" difficulty — 2–3 units instead of 3–5, always 2 controller
  // aircraft instead of 2–3, fewer support calls, and a shorter run (2
  // situations of 5 questions, so scores are out of 10 not 18). Its own
  // collection and therefore its own boards; the page at /cbat/sat picks the
  // key from the selected difficulty.
  'sat-easier': {
    Model: GameSessionCbatSatEasierResult,
    primaryField: 'correctCount',
    sortDir: -1,
    bestOp: '$max',
    label: 'Situational Awareness Test (Easier)',
  },
  'cut': {
    Model: GameSessionCbatCutResult,
    primaryField: 'totalScore',
    sortDir: -1,           // higher is better (accumulating score)
    bestOp: '$max',
    label: 'Cognitive Updating Test',
  },
  // CUT's "Easier" difficulty — slower fuel/pressure/airspeed drift and a
  // thinner task cadence. Its own collection and therefore its own boards; the
  // page at /cbat/cut picks the key from the selected difficulty.
  'cut-easier': {
    Model: GameSessionCbatCutEasierResult,
    primaryField: 'totalScore',
    sortDir: -1,
    bestOp: '$max',
    label: 'Cognitive Updating Test (Easier)',
  },
  'rtt': {
    Model: GameSessionCbatRttResult,
    primaryField: 'totalScore',
    sortDir: -1,           // higher is better (accumulating score)
    bestOp: '$max',
    label: 'Rapid Tracking Test',
  },
  // RTT's "Easier" difficulty — 8 target passes instead of 12, no fast air,
  // slower passes and less time behind cover. Its own collection and therefore
  // its own boards; the page at /cbat/rtt picks the key from the selected
  // difficulty.
  'rtt-easier': {
    Model: GameSessionCbatRttEasierResult,
    primaryField: 'totalScore',
    sortDir: -1,
    bestOp: '$max',
    label: 'Rapid Tracking Test (Easier)',
  },
  'sit': {
    Model: GameSessionCbatSitResult,
    primaryField: 'correctCount',
    sortDir: -1,           // higher is better
    bestOp: '$max',
    label: 'Spatial Integration Test',
  },
  // SIT's "Easier" difficulty — four rounds instead of six, fewer object
  // classes on the map and a longer look at the clip. Scores out of 4, not 6,
  // so the two boards do not share a ceiling. Its own collection; the page at
  // /cbat/sit picks the key from the selected difficulty.
  'sit-easier': {
    Model: GameSessionCbatSitEasierResult,
    primaryField: 'correctCount',
    sortDir: -1,
    bestOp: '$max',
    label: 'Spatial Integration Test (Easier)',
  },
  'slt': {
    Model: GameSessionCbatSltResult,
    primaryField: 'correctCount',
    sortDir: -1,
    bestOp: '$max',
    label: 'System Logic Test',
  },
  // SLT's "Easier" difficulty — four tabs instead of six and single-hop
  // lookups only (no question needs two tabs combined). Eight questions
  // instead of ten, so the boards do not share a ceiling.
  'slt-easier': {
    Model: GameSessionCbatSltEasierResult,
    primaryField: 'correctCount',
    sortDir: -1,
    bestOp: '$max',
    label: 'System Logic Test (Easier)',
  },
  'vlt': {
    Model: GameSessionCbatVltResult,
    primaryField: 'correctCount',
    sortDir: -1,
    bestOp: '$max',
    label: 'Verbal Logic Test',
  },
  // VLT's "Easier" difficulty — five tabs instead of eight and six questions
  // instead of eight, all of them two-tab joins rather than three.
  'vlt-easier': {
    Model: GameSessionCbatVltEasierResult,
    primaryField: 'correctCount',
    sortDir: -1,
    bestOp: '$max',
    label: 'Verbal Logic Test (Easier)',
  },
  // Speeded, so there is no question ceiling — a better player simply answers
  // more inside the same clock. Ranks on correctCount like the fixed-length
  // games, but its board carries no "/N".
  'matf': {
    Model: GameSessionCbatMatfResult,
    primaryField: 'correctCount',
    sortDir: -1,
    bestOp: '$max',
    label: 'Table Reading Test',
  },
  // MATF's "Easier" difficulty — a coordinate grid running ±8 instead of ±17, a
  // smaller wind sheet, and a longer clock on each of the two parts.
  'matf-easier': {
    Model: GameSessionCbatMatfEasierResult,
    primaryField: 'correctCount',
    sortDir: -1,
    bestOp: '$max',
    label: 'Table Reading Test (Easier)',
  },
  // Deliberately has NO Easier key. The test measures sustained attention on a
  // dull task over a fixed stretch; shortening or lightening it would remove
  // what is being measured. See GameSessionCbatVigilanceResult.js.
  'vigilance': {
    Model: GameSessionCbatVigilanceResult,
    primaryField: 'totalScore',
    sortDir: -1,           // higher is better (accumulating score)
    bestOp: '$max',
    label: 'Vigilance Test',
  },
  'sma': {
    Model: GameSessionCbatSmaResult,
    primaryField: 'totalScore',
    sortDir: -1,           // higher is better (accumulating score)
    bestOp: '$max',
    label: 'Sensory Motor Apparatus Test',
  },
  // SMA's "Easier" difficulty — a slower drift, no gusts, a run of 30 scored
  // seconds instead of 60, and a tolerance ring of 0.24 of the display radius
  // instead of 0.16. The ring is the reason this needs its own collection rather
  // than a shared board with a lower ceiling: a wider ring pays more points for
  // the same physical tracking, so the two scores are not on one scale.
  'sma-easier': {
    Model: GameSessionCbatSmaEasierResult,
    primaryField: 'totalScore',
    sortDir: -1,
    bestOp: '$max',
    label: 'Sensory Motor Apparatus Test (Easier)',
  },
};

// A game with an Easier/Hard split keeps two registry keys — `flag` and
// `flag-easier` — each with its own collection and its own board. Only the
// Easier label says which it is; the Hard one is just the game's name, which
// reads as ambiguous rather than as Hard anywhere a single result is announced
// on its own (the Medals channel). This names BOTH halves, the same way the
// Recent Scores feed chips both.
//
// Derived from the registry rather than from a second list, so a new split game
// is covered by adding its `-easier` entry above and nothing else. Games with no
// split keep their plain label.
const EASIER_SUFFIX = '-easier';

function cbatLabelWithDifficulty(gameKey) {
  const cfg = CBAT_GAMES[gameKey];
  if (!cfg) return null;
  if (gameKey.endsWith(EASIER_SUFFIX)) return cfg.label;   // already carries "(Easier)"
  return CBAT_GAMES[`${gameKey}${EASIER_SUFFIX}`] ? `${cfg.label} (Hard)` : cfg.label;
}

module.exports = { CBAT_GAMES, cbatLabelWithDifficulty };
