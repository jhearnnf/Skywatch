const mongoose = require('mongoose');

// MATF's "Easier" difficulty — a coordinate grid running ±8 instead of ±17, a
// smaller wind sheet, and a longer clock on each part. Its own collection, so
// its board stands alone.
const schema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  correctCount: { type: Number },
  attempted:    { type: Number },
  gridCorrect:  { type: Number },
  tableCorrect: { type: Number },
  totalTime:    { type: Number, required: true },
  createdAt:    { type: Date, default: Date.now },
});

schema.index({ userId: 1, createdAt: -1 });
schema.index({ correctCount: -1, totalTime: 1 });

module.exports = mongoose.model('GameSessionCbatMatfEasierResult', schema);
