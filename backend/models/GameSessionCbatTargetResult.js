const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  userId:           { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  totalScore:       { type: Number, required: true },
  sceneScore:       { type: Number, default: 0 },
  lightScore:       { type: Number, default: 0 },
  scanScore:        { type: Number, default: 0 },
  systemScore:      { type: Number, default: 0 },
  sceneHits:        { type: Number, default: 0 },
  sceneMisses:      { type: Number, default: 0 },
  lightMatches:     { type: Number, default: 0 },
  lightMisclicks:   { type: Number, default: 0 },
  scanMatches:      { type: Number, default: 0 },
  scanMisclicks:    { type: Number, default: 0 },
  systemMatches:    { type: Number, default: 0 },
  systemMisclicks:  { type: Number, default: 0 },
  totalTime:        { type: Number, required: true },
  grade:            { type: String, enum: ['Outstanding', 'Good', 'Needs Work', 'Failed', null], default: null },
  createdAt:        { type: Date, default: Date.now },
});

schema.index({ userId: 1, createdAt: -1 });
schema.index({ totalScore: -1, totalTime: 1 });

module.exports = mongoose.model('GameSessionCbatTargetResult', schema);
