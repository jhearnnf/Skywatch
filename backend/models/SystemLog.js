const mongoose = require('mongoose');
const { LOG_TYPES } = require('../constants/systemLog');

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
  duplicates: [{
    keep:   { type: String, default: '' },
    remove: { type: String, default: '' },
    reason: { type: String, default: '' },
  }],

  // ── common error detail ────────────────────────────────────────────────────
  failureReason: { type: String, default: '' },

  // ── common ─────────────────────────────────────────────────────────────────
  resolved: { type: Boolean, default: false },
  time:     { type: Date, default: Date.now },
});

systemLogSchema.index({ resolved: 1, time: -1 });

module.exports = mongoose.model('SystemLog', systemLogSchema);
