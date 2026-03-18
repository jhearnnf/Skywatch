const mongoose = require('mongoose');

const gameWhosAtAircraftSchema = new mongoose.Schema({
  gameTypeId:         { type: mongoose.Schema.Types.ObjectId, ref: 'GameType', required: true },
  intelBriefId:       { type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief', required: true },
  silhouetteImageUrl: { type: String, required: true, trim: true },
});

// Validate that the referenced brief is in the 'Aircrafts' category
gameWhosAtAircraftSchema.pre('save', async function () {
  const brief = await mongoose.model('IntelligenceBrief').findById(this.intelBriefId).select('category');
  if (brief && brief.category !== 'Aircrafts') {
    throw new Error("Who's That Aircraft: intel brief must be in the 'Aircrafts' category");
  }
});

module.exports = mongoose.model('GameWhosAtAircraft', gameWhosAtAircraftSchema);
