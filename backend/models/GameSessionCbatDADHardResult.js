const mongoose = require('mongoose');

// Directions & Distances "Hard" difficulty results.
//
// DAD split ANT's way round: the plain `dad` collection is the Easier board and
// keeps every score set before the split (those were played on the questions
// Hard now plays, but the board was un-toppable once the Real CBAT set got
// harder). Hard starts here, fresh. Same shape as GameSessionCbatDADResult.
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

module.exports = mongoose.model('GameSessionCbatDADHardResult', schema);
