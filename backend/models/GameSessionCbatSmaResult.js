const mongoose = require('mongoose');

// Sensory Motor Apparatus Test — the Hard difficulty.
//
// `totalScore` is what the boards rank on, but it is a SkyWatch construction:
// points accumulated for every second the dot sat inside the tolerance ring,
// weighted by how close to the crosshair it was. The other three fields are the
// measurements a real tracking apparatus is actually scored on, and they are
// stored because they survive a retune of the points formula:
//
//   onTargetPct    share of the scored window spent inside the ring
//   rmsErrorPct    root-mean-square radial error, as a percentage of the
//                  display radius. 0 is perfect, 100 is the bezel.
//   worstErrorPct  the furthest the dot ever got
//
// The ring is wider on Easier, so the same physical tracking earns more per
// second there — which is why Easier has its own collection and its own board
// rather than sharing this one. See GameSessionCbatSmaEasierResult.js.
const schema = new mongoose.Schema({
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  totalScore:    { type: Number },
  onTargetPct:   { type: Number },
  rmsErrorPct:   { type: Number },
  worstErrorPct: { type: Number },
  totalTime:     { type: Number, required: true },
  createdAt:     { type: Date, default: Date.now },
});

schema.index({ userId: 1, createdAt: -1 });
schema.index({ totalScore: -1, totalTime: 1 });

module.exports = mongoose.model('GameSessionCbatSmaResult', schema);
