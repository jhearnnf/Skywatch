const mongoose = require('mongoose');

// ANT Practise — the stripped drill behind ANT's Practise button. Eight plain
// speed/distance/time questions (two of each of ANT's four calculations), all on
// one page, with no map or tables to read.
//
// Same fields and the same 80-point scale as GameSessionCbatAntResult, but
// deliberately its own collection: the drill hands over the figures the game
// makes you find on the board, so an 80 here is not an 80 there.
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

module.exports = mongoose.model('GameSessionCbatAntPractiseResult', schema);
