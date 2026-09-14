const mongoose = require('mongoose');
const { CBAT_INPUT_METHODS } = require('../constants/cbatInputMethods');

// CBAT Rapid Tracking Test (RTT) — a psychomotor tracking task. Score is an
// accumulating total (higher better), like Target/FLAG/DPT/CUT: points per
// frame captured on target, weighted by how close to dead centre it was, minus
// wasted frames and missed targets. The breakdown fields are optional and feed
// the results screen / admin drill-down only.
const schema = new mongoose.Schema({
  userId:               { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  totalScore:           { type: Number },
  totalTime:            { type: Number, required: true },
  // Which physical control this run was flown on. Only the steered games (ACT,
  // RTT, SMA) carry this field.
  inputMethod:          { type: String, enum: CBAT_INPUT_METHODS, default: null },
  // Per-run breakdown (optional)
  framesTaken:          { type: Number },
  framesOnTarget:       { type: Number },
  targetsCompleted:     { type: Number },
  avgCentringErrorDeg:  { type: Number },
  createdAt:            { type: Date, default: Date.now },
});

schema.index({ userId: 1, createdAt: -1 });
schema.index({ totalScore: -1, totalTime: 1 });

module.exports = mongoose.model('GameSessionCbatRttResult', schema);
