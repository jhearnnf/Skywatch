const mongoose = require('mongoose');
const { CBAT_INPUT_METHODS } = require('../constants/cbatInputMethods');

// Sensory Motor Apparatus Test — the Easier difficulty. Same shape as
// GameSessionCbatSmaResult (see that file for what each field means); a separate
// collection because the two are not comparable.
//
// Easier runs 30 scored seconds against Hard's 60, so its ceiling is 300 rather
// than 600 — but the bigger difference is the tolerance ring, which is
// 0.24 of the display radius instead of 0.16. A wider ring pays more points for
// the same physical tracking, so a score set here would flatter its holder on
// the Hard board and there is no honest conversion between them.
const schema = new mongoose.Schema({
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  totalScore:    { type: Number },
  onTargetPct:   { type: Number },
  rmsErrorPct:   { type: Number },
  worstErrorPct: { type: Number },
  totalTime:     { type: Number, required: true },
  // Which physical control this run was flown on. Only the steered games (ACT,
  // RTT, SMA) carry this field.
  inputMethod:   { type: String, enum: CBAT_INPUT_METHODS, default: null },
  // Whether rudder pedals held the lateral axis, beside whatever `inputMethod`
  // flew the vertical one. SMA is the only test flown on pedals, so only its
  // two collections carry this. null = the client never said (older builds).
  pedals:        { type: Boolean, default: null },
  createdAt:     { type: Date, default: Date.now },
});

schema.index({ userId: 1, createdAt: -1 });
schema.index({ totalScore: -1, totalTime: 1 });

module.exports = mongoose.model('GameSessionCbatSmaEasierResult', schema);
