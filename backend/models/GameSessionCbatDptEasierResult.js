const mongoose = require('mongoose');

// Dynamic Projection Test — the Easier difficulty. Same shape as
// GameSessionCbatDptResult (see that file for what each field means); a
// separate collection because the two are not comparable.
//
// Easier plays rounds 1–4 of the eight-round ladder and Hard plays rounds 5–8,
// so the two share no content at all: Easier has no enemies to intercept and no
// danger zones to be penalised by, and its round-completion bonuses are worth
// 50 × 1…4 against Hard's 50 × 5…8. A perfect Easier run is 1,700 where a
// perfect Hard run is 5,200. There is no conversion between them.
const schema = new mongoose.Schema({
  userId:                { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  totalScore:            { type: Number, required: true },
  totalTime:             { type: Number, required: true },
  finalRound:            { type: Number, default: 1 },     // last ladder round reached (1–4 here)
  firstRound:            { type: Number },                 // always 1 — kept so both boards' rows read alike
  gatesHit:              { type: Number, default: 0 },
  dangerZoneViolations:  { type: Number, default: 0 },     // always 0 — zones start at round 5
  separationViolations:  { type: Number, default: 0 },     // CA-A/CA-N can still close on each other in round 4
  interceptions:         { type: Number, default: 0 },     // always 0 — the Fighter arrives at round 6
  aircraftUsed:          { type: String },
  createdAt:             { type: Date, default: Date.now },
});

schema.index({ userId: 1, createdAt: -1 });
schema.index({ totalScore: -1, totalTime: 1 });

module.exports = mongoose.model('GameSessionCbatDptEasierResult', schema);
