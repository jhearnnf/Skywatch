const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  correctCount:  { type: Number, required: true },
  round1Correct: { type: Number },
  round2Correct: { type: Number },
  totalTime:     { type: Number, required: true },
  grade:         { type: String },
  createdAt:     { type: Date, default: Date.now },
});

schema.index({ userId: 1, createdAt: -1 });
schema.index({ correctCount: -1, totalTime: 1 });

module.exports = mongoose.model('GameSessionCbatAnglesResult', schema);
