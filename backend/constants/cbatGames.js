const GameSessionCbatPlaneTurnResult      = require('../models/GameSessionCbatPlaneTurnResult');
const GameSessionCbatAnglesResult         = require('../models/GameSessionCbatAnglesResult');
const GameSessionCbatCodeDuplicatesResult = require('../models/GameSessionCbatCodeDuplicatesResult');
const GameSessionCbatSymbolsResult        = require('../models/GameSessionCbatSymbolsResult');
const GameSessionCbatTargetResult         = require('../models/GameSessionCbatTargetResult');
const GameSessionCbatInstrumentsResult    = require('../models/GameSessionCbatInstrumentsResult');
const GameSessionCbatAntResult            = require('../models/GameSessionCbatAntResult');
const GameSessionCbatFlagResult           = require('../models/GameSessionCbatFlagResult');
const GameSessionCbatVisualisation2DResult = require('../models/GameSessionCbatVisualisation2DResult');

// Single source of truth for CBAT games. Adding a new CBAT game = add one entry
// here and it automatically flows through submission routes, leaderboards,
// personal-best endpoints, and admin user stats.
const CBAT_GAMES = {
  'plane-turn': {
    Model: GameSessionCbatPlaneTurnResult,
    primaryField: 'totalRotations',
    sortDir: 1,            // lower is better
    bestOp: '$min',
    label: 'Plane Turn',
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
};

module.exports = { CBAT_GAMES };
