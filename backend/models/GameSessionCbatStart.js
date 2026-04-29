const mongoose = require('mongoose');
const { CBAT_GAMES } = require('../constants/cbatGames');

const schema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  gameKey:   { type: String, required: true, enum: Object.keys(CBAT_GAMES) },
  startedAt: { type: Date, default: Date.now },
});

schema.index({ userId: 1, gameKey: 1 });

module.exports = mongoose.model('GameSessionCbatStart', schema);
