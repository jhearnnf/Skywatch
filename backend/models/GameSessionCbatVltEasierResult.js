const mongoose = require('mongoose');

// VLT's "Easier" difficulty — five tabs instead of eight and shorter inference
// chains. Its own collection, so its board stands alone.
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

module.exports = mongoose.model('GameSessionCbatVltEasierResult', schema);
