const mongoose = require('mongoose');

// SLT's "Easier" difficulty — four tabs instead of six and single-hop lookups
// only. Its own collection, so its board stands alone.
const schema = new mongoose.Schema({
  userId:               { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  correctCount:         { type: Number },
  totalQuestions:       { type: Number },
  totalTime:            { type: Number, required: true },
  avgTimePerQuestionMs: { type: Number },
  createdAt:            { type: Date, default: Date.now },
});

schema.index({ userId: 1, createdAt: -1 });
schema.index({ correctCount: -1, totalTime: 1 });

module.exports = mongoose.model('GameSessionCbatSltEasierResult', schema);
