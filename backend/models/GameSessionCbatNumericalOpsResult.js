const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  userId:               { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  correctCount:         { type: Number },
  correctPercentage:    { type: Number, required: true },
  round1Correct:        { type: Number },
  round2Correct:        { type: Number },
  round3Correct:        { type: Number },
  round4Correct:        { type: Number },
  totalTime:            { type: Number, required: true },
  avgTimePerQuestionMs: { type: Number },
  createdAt:            { type: Date, default: Date.now },
});

schema.index({ userId: 1, createdAt: -1 });
schema.index({ correctPercentage: -1, totalTime: 1 });

module.exports = mongoose.model('GameSessionCbatNumericalOpsResult', schema);
