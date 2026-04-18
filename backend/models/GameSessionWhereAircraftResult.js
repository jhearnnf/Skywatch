const mongoose = require('mongoose');

const gameSessionWhereAircraftResultSchema = new mongoose.Schema({
  userId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User',             required: true },
  aircraftBriefId: { type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief', required: true },
  gameSessionId:   { type: String, required: true },

  status:          { type: String, enum: ['completed', 'abandoned', 'round1_only'], required: true },

  // Round 1 — identify the aircraft by name
  round1Correct:   { type: Boolean, default: false },

  // Round 2 — locate the base(s) on the map
  round2Attempted: { type: Boolean, default: false },
  round2Correct:   { type: Boolean, default: false },
  selectedBaseIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief' }],
  correctBaseIds:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief' }],

  won:             { type: Boolean, default: false },
  airstarsEarned:  { type: Number,  default: 0 },
  timeTakenSeconds:{ type: Number,  default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('GameSessionWhereAircraftResult', gameSessionWhereAircraftResultSchema);
