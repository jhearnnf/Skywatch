const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  userId:           { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  score:            { type: Number, required: true },          // net points (correct - incorrect)
  correctTurns:     { type: Number, default: 0 },
  totalTurns:       { type: Number, default: 40 },
  roundsCompleted:  { type: Number, default: 5 },
  accuracy:         { type: Number, default: 0 },              // 0-100
  aircraftUsed:     { type: String, default: 'Hawk T2' },
  totalTime:        { type: Number, default: 0 },              // ms elapsed; tie-breaker
  createdAt:        { type: Date,   default: Date.now },
});

schema.index({ userId: 1, createdAt: -1 });
schema.index({ score: -1, totalTime: 1 });

module.exports = mongoose.model('GameSessionCbatTrace1Result', schema);
