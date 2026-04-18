const mongoose = require('mongoose');

const gameSessionWheresThatAircraftResultSchema = new mongoose.Schema({
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  gameId:        { type: mongoose.Schema.Types.ObjectId, ref: 'GameWheresThatAircraft', required: true },
  gameSessionId: { type: String, required: true },

  userAnswer:       String, // aircraft name the user guessed
  isCorrect:        Boolean,
  timeTakenSeconds: Number,
  airstarsEarned:   { type: Number, default: 0 },
  createdAt:        { type: Date, default: Date.now },
});

module.exports = mongoose.model('GameSessionWheresThatAircraftResult', gameSessionWheresThatAircraftResultSchema);
