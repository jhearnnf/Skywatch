const mongoose = require('mongoose');

// Colours, Letters and Numbers (CLAN) — the Hard difficulty.
//
// The test the RAF replaced with FLAG in 2021 and that Canada's CFAST still
// sits, so it lives behind the FLAG tile for players in Canada. Three tasks
// run at once for a fixed 90 seconds and every award is a multiple of 5, so
// `totalScore` can go negative and a clean run's total always lands on a 5.
//
//   colour*  the diamonds: pressed in the right band, pressed with nothing in
//            the band (or the wrong key), or let through untouched
//   letter*  the memorised code picked from four near-identical options
//   math*    the typed sums
//
// Easier runs write to GameSessionCbatClanEasierResult — a separate
// collection for the same reason FLAG's is: the two boards are never read
// together, and a difficulty field on one collection would need a backfill.
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

module.exports = mongoose.model('GameSessionCbatClanResult', schema);
