const mongoose = require('mongoose');

// Vigilance Test, Hard. Its own collection, ranking from zero — nothing
// converts between this board and the Easier one (a 60-second run at triple
// points). Hard keeps the original clock and points — the full 180 seconds at
// 10 a star — with stars appearing far more often. Same rules too: a star
// stays until it is keyed correctly. See GameSessionCbatVigilanceResult.js
// for the Easier half, which sits under the original key.
const schema = new mongoose.Schema({
  userId:            { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  totalScore:        { type: Number },
  starsCleared:      { type: Number },
  prioritiesCleared: { type: Number },
  misKeyed:          { type: Number },
  totalTime:         { type: Number, required: true },
  createdAt:         { type: Date, default: Date.now },
});

schema.index({ userId: 1, createdAt: -1 });
schema.index({ totalScore: -1, totalTime: 1 });

module.exports = mongoose.model('GameSessionCbatVigilanceHardResult', schema);
