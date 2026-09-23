const mongoose = require('mongoose');

// Instruments Practise drill — one minute of free flight with the six dials
// live, matching whichever dial lights up to its target reading. 10 points for
// a quick match sliding to 5 for a slow one, plus 1 for each ring flown.
//
// Its own collection, the way ANT Practise and Vigilance Practise are: flying
// onto a dial is not what either Instruments board measures, so a drill score
// never sits beside a Reading or Orientation one.
const schema = new mongoose.Schema({
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  totalScore:    { type: Number, required: true },
  dialsMatched:  { type: Number, default: 0 },
  dialsSet:      { type: Number, default: 0 },
  ringsHit:      { type: Number, default: 0 },
  avgMatchTime:  { type: Number, default: null },
  totalTime:     { type: Number, required: true },
  createdAt:     { type: Date, default: Date.now },
});

schema.index({ userId: 1, createdAt: -1 });
schema.index({ totalScore: -1, totalTime: 1 });

module.exports = mongoose.model('GameSessionCbatInstrumentsPractiseResult', schema);
