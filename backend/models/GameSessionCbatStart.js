const mongoose = require('mongoose');
const { CBAT_GAMES } = require('../constants/cbatGames');

const schema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  gameKey:   { type: String, required: true, enum: Object.keys(CBAT_GAMES) },
  startedAt: { type: Date, default: Date.now },
  // Per-start client id for idempotent offline sync. A start queued while
  // offline may be replayed after the server already committed it (response
  // lost on a dropped connection); deduping on this makes the replay a no-op.
  clientStartId: { type: String, default: null },
});

schema.index({ userId: 1, gameKey: 1 });
// Sparse so the many null rows (legacy + online starts) don't bloat the index.
schema.index({ userId: 1, clientStartId: 1 }, { sparse: true });

module.exports = mongoose.model('GameSessionCbatStart', schema);
