const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  userId:               { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  correctCount:         { type: Number },
  totalQuestions:       { type: Number },
  totalTime:            { type: Number, required: true },
  avgTimePerQuestionMs: { type: Number },
  // 'easier' for a run from the Easier mode; absent for the runs from before
  // the split and from builds that predate it, which were the Hard game.
  difficulty:           { type: String, enum: ['easier', null], default: null },
  createdAt:            { type: Date, default: Date.now },
});

schema.index({ userId: 1, createdAt: -1 });
schema.index({ correctCount: -1, totalTime: 1 });

module.exports = mongoose.model('GameSessionCbatDADResult', schema);
