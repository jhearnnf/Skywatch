const mongoose = require('mongoose');

// Each answer is an embedded sub-document — Mongoose auto-generates _id
const answerSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
});

const gameQuizQuestionSchema = new mongoose.Schema({
  gameTypeId:   { type: mongoose.Schema.Types.ObjectId, ref: 'GameType', required: true },
  intelBriefId: { type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief', required: true },
  difficulty:   { type: String, enum: ['easy', 'medium'], required: true },
  question:     { type: String, required: true, trim: true },

  // Exactly 7 answer options; one is correct
  answers: {
    type: [answerSchema],
    validate: {
      validator: (arr) => arr.length === 7,
      message: 'Each quiz question must have exactly 7 answer options',
    },
  },

  // Must match one of the embedded answer _ids
  correctAnswerId: { type: mongoose.Schema.Types.ObjectId, required: true },
});

module.exports = mongoose.model('GameQuizQuestion', gameQuizQuestionSchema);
