const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  userId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  totalRotations:  { type: Number, required: true },
  totalTime:       { type: Number, required: true },
  levelsCompleted: { type: Number, default: 5 },
  aircraftUsed:    { type: String },
  createdAt:       { type: Date, default: Date.now },
});

schema.index({ userId: 1, createdAt: -1 });
schema.index({ totalRotations: 1, totalTime: 1 });

module.exports = mongoose.model('GameSessionCbatPlaneTurnResult', schema);
