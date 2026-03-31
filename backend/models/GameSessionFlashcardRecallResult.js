const mongoose = require('mongoose');

const cardResultSchema = new mongoose.Schema({
  intelBriefId:     { type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief' },
  recalled:         Boolean, // did the user self-report recall?
  rating:           { type: String, enum: ['again', 'hard', 'good', 'easy'] },
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
