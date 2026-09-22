const mongoose = require('mongoose');

// CLAN "Easier" difficulty results. Same shape as GameSessionCbatClanResult
// (see that file for what each field means); a separate collection because
// Easier serves shorter codes, slower diamonds and fewer sums in the same 90
// seconds, so a score here is not on the Hard board's scale.
const schema = new mongoose.Schema({
  userId:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  totalScore:     { type: Number, required: true },
  colourHits:     { type: Number, default: 0 },
  colourWrong:    { type: Number, default: 0 },
  colourMissed:   { type: Number, default: 0 },
  letterCorrect:  { type: Number, default: 0 },
  letterWrong:    { type: Number, default: 0 },
  letterTimeout:  { type: Number, default: 0 },
  mathCorrect:    { type: Number, default: 0 },
  mathWrong:      { type: Number, default: 0 },
  mathTimeout:    { type: Number, default: 0 },
  totalTime:      { type: Number, required: true },
  grade:          { type: String, enum: ['Outstanding', 'Good', 'Needs Work', 'Failed', null], default: null },
  createdAt:      { type: Date, default: Date.now },
});

schema.index({ userId: 1, createdAt: -1 });
schema.index({ totalScore: -1, totalTime: 1 });

module.exports = mongoose.model('GameSessionCbatClanEasierResult', schema);
