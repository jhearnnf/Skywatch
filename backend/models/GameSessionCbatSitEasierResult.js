const mongoose = require('mongoose');

// SIT's "Easier" difficulty. Its own collection so its board is never compared
// against Hard's — Easier runs four rounds where Hard runs six, so the two do
// not even share a ceiling.
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

module.exports = mongoose.model('GameSessionCbatSitEasierResult', schema);
