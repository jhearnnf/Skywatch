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
const GameSessionCbatNumericalOpsResult  = require('../models/GameSessionCbatNumericalOpsResult');

// Single source of truth for CBAT games. Adding a new CBAT game = add one entry
// here and it automatically flows through submission routes, leaderboards,
// personal-best endpoints, and admin user stats.
// `modeFilter`, when present, is merged into every $match / find that targets
// this entry's collection. It's how two registry entries can share a single
// Model (e.g. plane-turn-2d and plane-turn-3d both read GameSessionCbatPlaneTurnResult,
// scoped by the `mode` field). Every CBAT_GAMES consumer MUST spread it into
// queries: `{ ...cfg.modeFilter, ...other }` for find/countDocuments,
// `{ $match: { ...cfg.modeFilter, ...other } }` for aggregations.
const CBAT_GAMES = {
  'plane-turn-2d': {
    Model: GameSessionCbatPlaneTurnResult,
    primaryField: 'totalRotations',
    sortDir: 1,            // lower is better
    bestOp: '$min',
    label: 'Plane Turn 2D',
    modeFilter: { mode: '2d' },
  },
  'plane-turn-3d': {
    Model: GameSessionCbatPlaneTurnResult,
    primaryField: 'totalRotations',
    sortDir: 1,
    bestOp: '$min',
    label: 'Plane Turn 3D',
    modeFilter: { mode: '3d' },
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
  'numerical-ops': {
    Model: GameSessionCbatNumericalOpsResult,
    primaryField: 'correctPercentage',
    sortDir: -1,           // higher is better
    bestOp: '$max',
    label: 'Numerical Operations',
  },
};

module.exports = { CBAT_GAMES };
