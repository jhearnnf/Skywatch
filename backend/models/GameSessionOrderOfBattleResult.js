const mongoose = require('mongoose');

const gameSessionOrderOfBattleResultSchema = new mongoose.Schema({
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  gameId:        { type: mongoose.Schema.Types.ObjectId, ref: 'GameOrderOfBattle', required: true },
  gameSessionId: { type: String, required: true },

  // The order of IntelligenceBrief ObjectIds submitted by the user
  userSubmittedOrder: [{ type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief' }],

  isCorrect:        Boolean,
  timeTakenSeconds: Number,
  aircoinsEarned:   { type: Number, default: 0 },
  createdAt:        { type: Date, default: Date.now },
});

module.exports = mongoose.model('GameSessionOrderOfBattleResult', gameSessionOrderOfBattleResultSchema);
