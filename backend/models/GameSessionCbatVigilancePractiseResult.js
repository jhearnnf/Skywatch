const mongoose = require('mongoose');

// Vigilance Practise drill — one minute on a grid that starts mostly full and
// refills as fast as it is cleared, so the run is the keying and nothing else.
// No priority tasks, and a heavier mis-key penalty (see vigilanceDifficulty.js).
//
// Same fields as the two Vigilance boards so the one submit handler serves all
// three, but its own collection: a drill score is keying speed on a board with
// nothing to find, which is not what a Vigilance score measures.
const schema = new mongoose.Schema({
  userId:            { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  totalScore:        { type: Number },
  starsCleared:      { type: Number },
  prioritiesCleared: { type: Number },
  misKeyed:          { type: Number },
  totalTime:         { type: Number, required: true },
  createdAt:         { type: Date, default: Date.now },
});

schema.index({ userId: 1, createdAt: -1 });
schema.index({ totalScore: -1, totalTime: 1 });

module.exports = mongoose.model('GameSessionCbatVigilancePractiseResult', schema);
