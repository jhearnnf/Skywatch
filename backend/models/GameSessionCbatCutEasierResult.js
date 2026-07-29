const mongoose = require('mongoose');

// CUT "Easier" difficulty results.
//
// Same shape as GameSessionCbatCutResult, but a SEPARATE collection — the two
// difficulties keep entirely separate leaderboards and never need reading
// together, and a `difficulty` discriminator on the existing collection would
// need a backfill for every pre-difficulty row (the registry's modeFilter has to
// be a plain equality match; see GameSessionCbatFlagEasierResult).
const schema = new mongoose.Schema({
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  totalScore:    { type: Number },
  totalTime:     { type: Number, required: true },
  // Per-system breakdown (optional)
  tasksCompleted:  { type: Number },
  tasksMissed:     { type: Number },
  warningSeconds:  { type: Number },
  createdAt:       { type: Date, default: Date.now },
});

schema.index({ userId: 1, createdAt: -1 });
schema.index({ totalScore: -1, totalTime: 1 });

module.exports = mongoose.model('GameSessionCbatCutEasierResult', schema);
