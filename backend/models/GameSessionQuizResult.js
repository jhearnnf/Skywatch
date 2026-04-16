const mongoose = require('mongoose');

const gameSessionQuizResultSchema = new mongoose.Schema({
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  questionId:    { type: mongoose.Schema.Types.ObjectId, ref: 'GameQuizQuestion', required: true },
  gameSessionId: { type: String, required: true }, // UUID grouping all questions in one play session
  attemptId:     { type: mongoose.Schema.Types.ObjectId, ref: 'GameSessionQuizAttempt' },

  // Subset of answer _ids that were displayed (3 for easy, 5 for medium)
  displayedAnswerIds: [mongoose.Schema.Types.ObjectId],

  // All question _ids shown in this game session (for grouping/stats)
  displayedQuestionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'GameQuizQuestion' }],

  selectedAnswerId: { type: mongoose.Schema.Types.ObjectId, default: null },
  isCorrect:        Boolean,
  timeTakenSeconds: Number,
  aircoinsEarned:   { type: Number, default: 0 },
  createdAt:        { type: Date, default: Date.now },
});

gameSessionQuizResultSchema.index({ userId: 1, createdAt: -1 });
gameSessionQuizResultSchema.index({ gameSessionId: 1 });

module.exports = mongoose.model('GameSessionQuizResult', gameSessionQuizResultSchema);
