const mongoose = require('mongoose');

// Dynamic Projection Test — the post-split Hard difficulty, rounds 5-8 of the
// original eight-round ladder.
//
// A separate collection from GameSessionCbatDptResult, which keeps the
// eight-round board that clients predating the split still play and read. The
// two are not comparable: a perfect run here is 5,200 against that board's
// 6,900, the difference being exactly what rounds 1-4 were worth.
//
// Seeded from that board when the split shipped — each pre-split run was copied
// here with its rounds 1-4 share subtracted, so nobody lost their standing. Those
// rows carry `carriedOverFromLegacy` and their untouched `originalScore`. See
// utils/dptLegacyNormalise.js and scripts/seedDptHardFromLegacy.js.
const schema = new mongoose.Schema({
  userId:                { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  totalScore:            { type: Number, required: true },
  totalTime:             { type: Number, required: true },
  finalRound:            { type: Number, default: 5 },     // last ladder round reached (5-8 here)
  firstRound:            { type: Number },                 // always 5 — the rung a Hard run opens on
  gatesHit:              { type: Number, default: 0 },
  dangerZoneViolations:  { type: Number, default: 0 },
  separationViolations:  { type: Number, default: 0 },
  interceptions:         { type: Number, default: 0 },
  aircraftUsed:          { type: String },
  // Set only on the rows copied over from the eight-round board. `originalScore`
  // is what that run actually posted, before its rounds 1-4 share came off, so
  // the seeding is auditable and undoable.
  carriedOverFromLegacy: { type: Boolean },
  originalScore:         { type: Number },
  createdAt:             { type: Date, default: Date.now },
});

schema.index({ userId: 1, createdAt: -1 });
schema.index({ totalScore: -1, totalTime: 1 });

module.exports = mongoose.model('GameSessionCbatDptHardResult', schema);
