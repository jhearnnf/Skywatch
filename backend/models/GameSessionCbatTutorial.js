const mongoose = require('mongoose');
const { CBAT_GAMES } = require('../constants/cbatGames');

// One document per tutorial / practice-mode playthrough of a CBAT game.
//
// Unlike score results (one immutable insert per finished game), a tutorial doc
// is MUTATED as the user advances through its sections: the client reports the
// furthest step reached on entry, on every section change, and on completion.
// That lets the admin Reports page build a per-step drop-off funnel
// (count where furthestStep >= N) without storing one row per step.
//
//   clientRunId    — a per-playthrough UUID the client stamps once when the
//                    tutorial opens. It's the upsert key, so replayed/retried
//                    progress reports for the same playthrough never create a
//                    second row.
//   furthestStep   — 0-based index of the furthest section reached. Updated with
//                    $max so a backward jump (the coach-card arrows let the user
//                    revisit earlier sections) can't lower the recorded reach.
//   completed      — set true once the final section is finished; never flips back.
const schema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  gameKey:      { type: String, required: true, enum: Object.keys(CBAT_GAMES) },
  clientRunId:  { type: String, required: true },
  furthestStep: { type: Number, default: 0 },
  totalSteps:   { type: Number, default: 0 },
  completed:    { type: Boolean, default: false },
  startedAt:    { type: Date, default: Date.now },
  updatedAt:    { type: Date, default: Date.now },
});

// Upsert / dedupe target — one row per (user, playthrough).
schema.index({ userId: 1, clientRunId: 1 }, { unique: true });
// Funnel aggregation (count playthroughs reaching each step, per game, in window).
schema.index({ gameKey: 1, startedAt: 1 });

module.exports = mongoose.model('GameSessionCbatTutorial', schema);
