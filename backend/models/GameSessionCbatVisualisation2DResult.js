const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  correctCount:  { type: Number, required: true },
  tier1Correct:  { type: Number },
  tier2Correct:  { type: Number },
  totalTime:     { type: Number, required: true },
  grade:         { type: String, enum: ['Outstanding', 'Good', 'Needs Work', 'Failed', null], default: null },
  createdAt:     { type: Date, default: Date.now },
});

schema.index({ userId: 1, createdAt: -1 });
schema.index({ correctCount: -1, totalTime: 1 });

module.exports = mongoose.model('GameSessionCbatVisualisation2DResult', schema);
