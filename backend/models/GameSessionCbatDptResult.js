const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  userId:                { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  totalScore:            { type: Number, required: true },
  totalTime:             { type: Number, required: true },
  finalRound:            { type: Number, default: 1 },     // last round reached (1–8)
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
