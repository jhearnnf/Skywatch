const mongoose = require('mongoose');

// Dynamic Projection Test — the ORIGINAL eight-round board.
//
// When the Easier/Hard split cut the ladder in half this collection was
// deliberately left alone rather than becoming the Hard board. Clients that
// predate the split are still playing the eight-round game and reading this
// board with hardcoded URLs — a native build only changes with a store release
// — and their totals run up to 1,700 higher than a four-round Hard run can
// reach. Ranking the two together would have put them permanently on top.
//
// So this stays the eight-round board, ranking eight-round runs against each
// other, and goes quiet on its own as clients update. Every run on it was
// COPIED (never moved or altered) onto GameSessionCbatDptHardResult with its
// rounds 1-4 share taken off, so nobody lost their standing on the new board.
// See scripts/seedDptHardFromLegacy.js.

const schema = new mongoose.Schema({
  userId:                { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  totalScore:            { type: Number, required: true },
  totalTime:             { type: Number, required: true },
  finalRound:            { type: Number, default: 1 },     // last round reached (1–8; a full run reaches 8)
  gatesHit:              { type: Number, default: 0 },     // total lettered + numbered gates passed in correct order
  dangerZoneViolations:  { type: Number, default: 0 },     // count of distinct entries into a danger zone at unsafe altitude
  separationViolations:  { type: Number, default: 0 },     // count of distinct separation breaches (<3000ft, too close)
  interceptions:         { type: Number, default: 0 },     // successful enemy intercepts
  aircraftUsed:          { type: String },                 // brief title of the aircraft chosen for CA-A / CA-N
  createdAt:             { type: Date, default: Date.now },
});

schema.index({ userId: 1, createdAt: -1 });
schema.index({ totalScore: -1, totalTime: 1 });

module.exports = mongoose.model('GameSessionCbatDptResult', schema);
