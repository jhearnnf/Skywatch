// ANT (Hard) — the realistic Airborne Numerical Test.
//
// Its own collection, starting empty on purpose. Hard is not the original board
// at a higher setting: it is twelve rounds out of 120 against eight out of 80,
// with word problems, weather, two-lookup fuel and two aircraft. Nothing
// converts between the two totals, so nothing was carried over and the two
// boards rank separately for good. See src/utils/cbat/antHardGenerator.js.
//
// Same payload shape as the original board so submitAntResult serves both.
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  userId:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  totalScore:     { type: Number, required: true },
  exactCount:     { type: Number, default: 0 },
  partialCount:   { type: Number, default: 0 },
  missCount:      { type: Number, default: 0 },
  roundsPlayed:   { type: Number, required: true },
  totalTime:      { type: Number, required: true },
  grade:          { type: String, enum: ['Outstanding', 'Good', 'Needs Work', 'Failed', null], default: null },
  createdAt:      { type: Date, default: Date.now },
});

schema.index({ userId: 1, createdAt: -1 });
schema.index({ totalScore: -1, totalTime: 1 });

module.exports = mongoose.model('GameSessionCbatAntHardResult', schema);
