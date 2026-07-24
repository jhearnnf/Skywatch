const GameSessionCbatPlaneTurnResult      = require('../models/GameSessionCbatPlaneTurnResult');
const GameSessionCbatAnglesResult         = require('../models/GameSessionCbatAnglesResult');
const GameSessionCbatCodeDuplicatesResult = require('../models/GameSessionCbatCodeDuplicatesResult');
const GameSessionCbatSymbolsResult        = require('../models/GameSessionCbatSymbolsResult');
const GameSessionCbatTargetResult         = require('../models/GameSessionCbatTargetResult');
const GameSessionCbatInstrumentsResult    = require('../models/GameSessionCbatInstrumentsResult');
const GameSessionCbatAntResult            = require('../models/GameSessionCbatAntResult');
const GameSessionCbatFlagResult           = require('../models/GameSessionCbatFlagResult');
const GameSessionCbatVisualisation2DResult = require('../models/GameSessionCbatVisualisation2DResult');
const GameSessionCbatVisualisation3DResult = require('../models/GameSessionCbatVisualisation3DResult');
const GameSessionCbatDptResult           = require('../models/GameSessionCbatDptResult');
const GameSessionCbatActResult           = require('../models/GameSessionCbatActResult');
const GameSessionCbatTrace1Result        = require('../models/GameSessionCbatTrace1Result');
const GameSessionCbatTrace2Result        = require('../models/GameSessionCbatTrace2Result');
const GameSessionCbatNumericalOpsResult  = require('../models/GameSessionCbatNumericalOpsResult');
const GameSessionCbatDADResult           = require('../models/GameSessionCbatDADResult');
const GameSessionCbatSatResult           = require('../models/GameSessionCbatSatResult');
const GameSessionCbatCutResult           = require('../models/GameSessionCbatCutResult');

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
  'cut': {
    Model: GameSessionCbatCutResult,
    primaryField: 'totalScore',
    sortDir: -1,           // higher is better (accumulating score)
    bestOp: '$max',
    label: 'Cognitive Updating Test',
  },
};

module.exports = { CBAT_GAMES };
