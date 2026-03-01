const mongoose = require('mongoose');

const ALLOWED_CATEGORIES = ['Ranks', 'Squadrons', 'Missions'];

const gameOrderOfBattleSchema = new mongoose.Schema({
  gameTypeId:   { type: mongoose.Schema.Types.ObjectId, ref: 'GameType', required: true },
  intelBriefId: { type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief', required: true },

  orderType: {
    type: String,
    enum: ['rank_seniority', 'mission_date', 'squadron_seniority'],
    required: true,
  },

  // Ordered array of IntelligenceBrief ObjectIds representing the correct sequence
  correctOrder: [{ type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief' }],
});

// Validate allowed categories
gameOrderOfBattleSchema.pre('save', async function (next) {
  const brief = await mongoose.model('IntelligenceBrief').findById(this.intelBriefId).select('category');
  if (brief && !ALLOWED_CATEGORIES.includes(brief.category)) {
    return next(new Error(`Order of Battle only allows categories: ${ALLOWED_CATEGORIES.join(', ')}`));
  }
  next();
});

module.exports = mongoose.model('GameOrderOfBattle', gameOrderOfBattleSchema);
module.exports.ALLOWED_CATEGORIES = ALLOWED_CATEGORIES;
