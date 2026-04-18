const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User',              required: true },
  gameId:    { type: mongoose.Schema.Types.ObjectId, ref: 'GameOrderOfBattle', required: true },
  won:       { type: Boolean },
  abandoned: { type: Boolean, default: false },
  userChoices: [{
    choiceId:        { type: mongoose.Schema.Types.ObjectId },
    userOrderNumber: { type: Number },
  }],
  airstarsEarned:    { type: Number, default: 0 },
  timeTakenSeconds:  { type: Number, default: null },
  createdAt:         { type: Date, default: Date.now },
});

module.exports = mongoose.model('GameSessionOrderOfBattleResult', schema);
