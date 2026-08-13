const mongoose = require('mongoose');

// Vigilance Test. Ships with ONE difficulty on purpose: the test measures
// whether you can hold attention on something dull for a fixed stretch, so a
// shorter or gentler variant would remove the thing being measured. Every other
// CBAT game with a split changes load, not duration — here duration IS the load.
const schema = new mongoose.Schema({
  userId:            { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  totalScore:        { type: Number },
  starsCleared:      { type: Number },
  prioritiesCleared: { type: Number },
  misKeyed:          { type: Number },
  totalTime:         { type: Number, required: true },
  createdAt:         { type: Date, default: Date.now },
});

schema.index({ userId: 1, createdAt: -1 });
schema.index({ totalScore: -1, totalTime: 1 });

module.exports = mongoose.model('GameSessionCbatVigilanceResult', schema);
