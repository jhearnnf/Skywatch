const mongoose = require('mongoose');

// Each card ties a brief to a specific question + answer for recall
const flashcardItemSchema = new mongoose.Schema({
  intelBriefId:      { type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief', required: true },
  displayedQuestion: { type: String, required: true, trim: true },
  displayedAnswer:   { type: String, required: true, trim: true },
}, { _id: false });

const gameFlashcardRecallSchema = new mongoose.Schema({
  gameTypeId: { type: mongoose.Schema.Types.ObjectId, ref: 'GameType', required: true },
  cards:      { type: [flashcardItemSchema], required: true },
});

module.exports = mongoose.model('GameFlashcardRecall', gameFlashcardRecallSchema);
