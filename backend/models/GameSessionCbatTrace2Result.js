const mongoose = require('mongoose');

// CBAT "Trace 2" — watch 4 aircraft manoeuvre, then answer one question per
// round. 8 rounds, one point each (correctCount / 8). Higher is better;
// totalTime is the tie-breaker.
const schema = new mongoose.Schema({
  userId:               { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  correctCount:         { type: Number, default: 0 },
  totalQuestions:       { type: Number, default: 8 },
  totalTime:            { type: Number, default: 0 },   // ms elapsed; tie-breaker
  avgTimePerQuestionMs: { type: Number },
  createdAt:            { type: Date,   default: Date.now },
});

schema.index({ userId: 1, createdAt: -1 });
schema.index({ correctCount: -1, totalTime: 1 });

module.exports = mongoose.model('GameSessionCbatTrace2Result', schema);
