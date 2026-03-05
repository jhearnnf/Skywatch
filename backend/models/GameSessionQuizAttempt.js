const mongoose = require('mongoose');

const gameSessionQuizAttemptSchema = new mongoose.Schema({
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  intelBriefId:  { type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief', required: true },
  gameSessionId: { type: String, required: true, unique: true },
  difficulty:    { type: String, enum: ['easy', 'medium'], required: true },
  timeStarted:   { type: Date, default: Date.now },
  timeFinished:  Date,
  status:        { type: String, enum: ['in_progress', 'completed', 'abandoned'], default: 'in_progress' },
  isFirstAttempt:    { type: Boolean, default: true },
  totalQuestions:    { type: Number, default: 5 },
  correctAnswers:    { type: Number, default: 0 },
  percentageCorrect: { type: Number, default: 0 },
  aircoinsEarned:    { type: Number, default: 0 },
});

gameSessionQuizAttemptSchema.index({ userId: 1, timeStarted: -1 });
gameSessionQuizAttemptSchema.index({ gameSessionId: 1 });

module.exports = mongoose.model('GameSessionQuizAttempt', gameSessionQuizAttemptSchema);
