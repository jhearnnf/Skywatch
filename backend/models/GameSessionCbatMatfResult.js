const mongoose = require('mongoose');

// Table Reading Test. Speeded rather than fixed-length: both parts run to a
// clock and you answer as many as you can, so there is no question ceiling and
// `attempted` is stored alongside `correctCount` to make accuracy readable.
const schema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  correctCount: { type: Number },
  attempted:    { type: Number },
  gridCorrect:  { type: Number },   // part one — the coordinate grid
  tableCorrect: { type: Number },   // part two — the table lookup
  totalTime:    { type: Number, required: true },
  createdAt:    { type: Date, default: Date.now },
});

schema.index({ userId: 1, createdAt: -1 });
schema.index({ correctCount: -1, totalTime: 1 });

module.exports = mongoose.model('GameSessionCbatMatfResult', schema);
