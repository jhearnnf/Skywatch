const mongoose = require('mongoose');

const CATEGORIES = [
  'News', 'Aircrafts', 'Bases', 'Ranks', 'Squadrons', 'Training',
  'Threats', 'Allies', 'Missions', 'AOR', 'Tech', 'Terminology', 'Treaties',
];

const sourceSchema = new mongoose.Schema({
  url:         { type: String, required: true },
  articleDate: Date,
  siteName:    { type: String, trim: true },
}, { _id: false });

const keywordSchema = new mongoose.Schema({
  keyword:              { type: String, required: true, trim: true },
  generatedDescription: { type: String, trim: true },
});

const intelligenceBriefSchema = new mongoose.Schema(
  {
    dateAdded: { type: Date, default: Date.now },
    category:  { type: String, enum: CATEGORIES, required: true },

    media: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Media' }],

    title:       { type: String, required: true, trim: true },
    subtitle:    { type: String, trim: true },
    description: { type: String, trim: true }, // ~200 words

    sources:  [sourceSchema],
    keywords: [keywordSchema],

    // 10 questions per difficulty — references to GameQuizQuestion
    quizQuestionsEasy: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'GameQuizQuestion' }],
      validate: { validator: (arr) => arr.length <= 10, message: 'Max 10 easy questions' },
    },
    quizQuestionsMedium: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'GameQuizQuestion' }],
      validate: { validator: (arr) => arr.length <= 10, message: 'Max 10 medium questions' },
    },
  },
  { timestamps: true }
);

intelligenceBriefSchema.index({ category: 1, dateAdded: -1 });
intelligenceBriefSchema.index({ title: 'text', subtitle: 'text' });

module.exports = mongoose.model('IntelligenceBrief', intelligenceBriefSchema);
module.exports.CATEGORIES = CATEGORIES;
