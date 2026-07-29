const mongoose = require('mongoose');

// FLAG "Easier" difficulty results.
//
// Same shape as GameSessionCbatFlagResult, but a SEPARATE collection rather
// than a `difficulty` discriminator on the existing one. Two reasons:
//   • the registry's `modeFilter` is also used as a document fragment when
//     tests/fixtures build rows, so it has to be a plain equality match — and
//     every pre-existing FLAG session predates any difficulty field, so no
//     equality filter can cleanly mean "hard" without a backfill migration.
//   • the two difficulties have entirely separate leaderboards anyway, so the
//     collections never need to be read together.
// Hard runs keep writing to GameSessionCbatFlagResult untouched.
const schema = new mongoose.Schema({
  userId:           { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  totalScore:       { type: Number, required: true },
  mathCorrect:      { type: Number, default: 0 },
  mathWrong:        { type: Number, default: 0 },
  mathTimeout:      { type: Number, default: 0 },
  aircraftCorrect:  { type: Number, default: 0 },
  aircraftWrong:    { type: Number, default: 0 },
  aircraftMissed:   { type: Number, default: 0 },
  targetHits:       { type: Number, default: 0 },
  targetMisses:     { type: Number, default: 0 },
  aircraftsSeen:    { type: Number, default: 0 },
  aircraftBriefId:  { type: String, default: null },
  totalTime:        { type: Number, required: true },
  grade:            { type: String, enum: ['Outstanding', 'Good', 'Needs Work', 'Failed', null], default: null },
  createdAt:        { type: Date, default: Date.now },
});

schema.index({ userId: 1, createdAt: -1 });
schema.index({ totalScore: -1, totalTime: 1 });

module.exports = mongoose.model('GameSessionCbatFlagEasierResult', schema);
