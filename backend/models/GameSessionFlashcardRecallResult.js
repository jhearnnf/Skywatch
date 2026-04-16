const mongoose = require('mongoose');
const { FLASHCARD_RATINGS } = require('../constants/flashcardRatings');

const cardResultSchema = new mongoose.Schema({
  intelBriefId:     { type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief' },
  recalled:         { type: Boolean, required: true },
  rating:           { type: String, enum: FLASHCARD_RATINGS },
  timeTakenSeconds: Number,
}, { _id: false });

const gameSessionFlashcardRecallResultSchema = new mongoose.Schema({
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  gameId:        { type: mongoose.Schema.Types.ObjectId, ref: 'GameFlashcardRecall', required: true },
  gameSessionId: { type: String, required: true },

  cardResults:    [cardResultSchema],
  aircoinsEarned: { type: Number, default: 0 },
  abandoned:      { type: Boolean, default: false },
  cardsAnswered:  { type: Number, default: 0 },
  createdAt:      { type: Date, default: Date.now },
});

module.exports = mongoose.model('GameSessionFlashcardRecallResult', gameSessionFlashcardRecallResultSchema);
