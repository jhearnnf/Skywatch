const mongoose = require('mongoose');

const ALL_CATEGORIES = [
  'News', 'Aircrafts', 'Bases', 'Ranks', 'Squadrons', 'Training',
  'Threats', 'Allies', 'Missions', 'AOR', 'Tech', 'Terminology', 'Treaties',
];

const tutorialStepSchema = new mongoose.Schema({
  stepTitle:       { type: String, required: true },
  stepDescription: { type: String, required: true },
}, { _id: false });

const gameTypeSchema = new mongoose.Schema({
  gameTitle: { type: String, required: true, unique: true },

  // Enforced at application level — seeded values:
  //   quiz              → all categories
  //   order_of_battle   → ['Ranks', 'Squadrons', 'Missions']
  //   wheres_that_aircraft→ ['Aircrafts']
  //   flashcard_recall  → all categories
  allowedCategories: {
    type: [String],
    enum: ALL_CATEGORIES,
    required: true,
  },

  tutorialSteps:  [tutorialStepSchema],
  gameDescription: { type: String, required: true },
  awardedAirstars: { type: Number, default: 10 },
});

module.exports = mongoose.model('GameType', gameTypeSchema);
