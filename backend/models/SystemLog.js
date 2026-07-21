const mongoose = require('mongoose');
const { LOG_TYPES } = require('../constants/systemLog');

// `remove` is a reserved Mongoose schema pathname (it shadows Model.remove()), but we use it here
// purely as a string field name for AI-detected duplicate lead IDs. Suppress the warning on this
// subdoc rather than renaming, since the field name is also baked into AI prompts and consumers.
const duplicateEntrySchema = new mongoose.Schema({
  keep:   { type: String, default: '' },
  remove: { type: String, default: '' },
  reason: { type: String, default: '' },
}, { suppressReservedKeysWarning: true });

const systemLogSchema = new mongoose.Schema({
  type: { type: String, enum: LOG_TYPES, required: true },

  // ── Brief context (shared across most types) ───────────────────────────────
  briefId:       { type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief', default: null },
  briefTitle:    { type: String, default: '' },
  briefCategory: { type: String, default: '' },

  // ── priority_ranking_failure ───────────────────────────────────────────────
  category:         { type: String, default: '' },
  newStubs:         [{ title: String, briefId: { type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief' } }],
  sourceBriefId:    { type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief', default: null },
  sourceBriefTitle: { type: String, default: '' },
  attempts:         { type: Number, default: 0 },

  // ── brief_generation_failure ───────────────────────────────────────────────
  // stage: which part of generation failed ('description', 'quiz', 'mnemonic', 'keyword_linking')
  stage: { type: String, default: '' },

  // ── image_fetch_failure ────────────────────────────────────────────────────
  // searchTerms: what was tried against Wikipedia
  searchTerms: [{ type: String }],

  // ── bulk_generation_warnings + brief_generation_failure ───────────────────
  // warnings: non-fatal issues collected during generation
  warnings: [{ type: String }],

  // ── duplicate_leads_detected ──────────────────────────────────────────────
  // AI-detected potential duplicate leads that the admin should review/merge
  duplicates: [duplicateEntrySchema],

  // ── quiz_finish_failure + quiz_result_persist_failure ─────────────────────
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User',                   default: null },
  attemptId:     { type: mongoose.Schema.Types.ObjectId, ref: 'GameSessionQuizAttempt', default: null },
  gameSessionId: { type: String, default: '' },
  // Free-form structured detail (expected/actual answer counts, backfilled ids, etc.)
  details:       { type: mongoose.Schema.Types.Mixed, default: null },

  // ── cors_origin_rejected + api_unreachable ────────────────────────────────
  // origin:      the offending browser origin, e.g. 'https://www.skywatch.academy'
  // requestPath: one example path that was refused (not exhaustive — aggregated)
  // dayKey:      'YYYY-MM-DD', so repeat offences collapse into one row per day
  //              rather than flooding the log with thousands of identical rows
  origin:      { type: String, default: '' },
  requestPath: { type: String, default: '' },
  dayKey:      { type: String, default: '' },
  userAgent:   { type: String, default: '' },
  // referer: the page URL the blocked request was made from, when the browser
  // sends one. This is the single most useful clue for "where did this come
  // from" — a stray link, an embed on another site, or empty for a direct
  // address-bar visit / scanner.
  referer:     { type: String, default: '' },
  hitCount:    { type: Number, default: 0 },
  firstSeenAt: { type: Date, default: null },
  lastSeenAt:  { type: Date, default: null },
  // api_unreachable only: how long the device had been failing, and how many
  // scores were stuck in its outbox when it finally got through.
  failingForMs: { type: Number, default: 0 },
  queuedCount:  { type: Number, default: 0 },

  // ── common error detail ────────────────────────────────────────────────────
  failureReason: { type: String, default: '' },

  // ── common ─────────────────────────────────────────────────────────────────
  resolved: { type: Boolean, default: false },
  time:     { type: Date, default: Date.now },
});

systemLogSchema.index({ resolved: 1, time: -1 });
// Backs the per-origin-per-day upsert in utils/rejectedOriginLog.js. Sparse so
// the many rows without an origin (brief generation failures etc.) stay out.
systemLogSchema.index({ type: 1, origin: 1, dayKey: 1 }, { sparse: true });

module.exports = mongoose.model('SystemLog', systemLogSchema);
