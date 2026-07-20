const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  userId:               { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  totalScore:           { type: Number, required: true },
  totalTime:            { type: Number, required: true },
  finalRound:           { type: Number, default: 1 },     // last round reached (1–5)
  ringsThreaded:        { type: Number, default: 0 },     // shapes the ball passed through (default-correct behaviour)
  ringsMissed:          { type: Number, default: 0 },     // shapes the ball failed to thread when no active avoid-instruction targeted them
  avoidObeyed:          { type: Number, default: 0 },     // valid avoid-instructions where the ball correctly skipped the named next shape
  avoidViolated:        { type: Number, default: 0 },     // valid avoid-instructions where the ball passed through the shape it was told to avoid
  wallScrapeSeconds:    { type: Number, default: 0 },     // total time the ball spent in contact with the tunnel wall
  bleepHits:            { type: Number, default: 0 },     // bleeps tapped within the 2s reaction window
  bleepMisses:          { type: Number, default: 0 },     // bleeps that elapsed without a tap (or were tapped late)
  avgBleepReactionMs:   { type: Number, default: 0 },     // mean reaction time across hit bleeps; 0 if no hits
  // Round-5 memory code: 7 digits read out a quarter of the way in, typed back
  // at the end. codeAttempted is false for runs abandoned before round 5 and
  // for every session recorded before the feature existed.
  codeAttempted:        { type: Boolean, default: false },
  codeDigitsCorrect:    { type: Number, default: 0 },     // digits correct in position (0–7)
  codeRecalled:         { type: Boolean, default: false },// whole code correct
  createdAt:            { type: Date, default: Date.now },
});

schema.index({ userId: 1, createdAt: -1 });
schema.index({ totalScore: -1, totalTime: 1 });

module.exports = mongoose.model('GameSessionCbatActResult', schema);
