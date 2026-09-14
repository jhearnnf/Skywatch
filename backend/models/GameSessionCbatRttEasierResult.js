const mongoose = require('mongoose');
const { CBAT_INPUT_METHODS } = require('../constants/cbatInputMethods');

// RTT's "Easier" difficulty — its own collection, so its board is never compared
// against Hard's. Same shape as GameSessionCbatRttResult; the run is shorter
// (8 target passes instead of 12) so the achievable total is lower.
const schema = new mongoose.Schema({
  userId:               { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  totalScore:           { type: Number },
  totalTime:            { type: Number, required: true },
  // Which physical control this run was flown on. Only the steered games (ACT,
  // RTT, SMA) carry this field.
  inputMethod:          { type: String, enum: CBAT_INPUT_METHODS, default: null },
  framesTaken:          { type: Number },
  framesOnTarget:       { type: Number },
  targetsCompleted:     { type: Number },
  avgCentringErrorDeg:  { type: Number },
  createdAt:            { type: Date, default: Date.now },
});

schema.index({ userId: 1, createdAt: -1 });
schema.index({ totalScore: -1, totalTime: 1 });

module.exports = mongoose.model('GameSessionCbatRttEasierResult', schema);
