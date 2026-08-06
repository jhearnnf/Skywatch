const mongoose = require('mongoose');

// Clipper fact — one finding extracted from the reference guide, and the unit
// the anti-repetition ledger tracks.
//
// The guide already stores its content as atomic, confidence-graded, sourced
// records, so a fact here maps 1:1 onto one of its entries rather than being a
// chunk we invented. `factKey` is stable across re-ingests (`kind:containerId:index`),
// which is what lets useCount/anglesUsed survive the guide being updated.
//
// `contentHash` changes when the underlying text is edited, flagging the fact
// as changed without discarding its usage history.

const angleSchema = new mongoose.Schema({
  scriptId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClipperScript' },
  hook:     { type: String, default: '' },
  angle:    { type: String, default: '' },
  usedAt:   { type: Date, default: Date.now },
}, { _id: false });

const refSchema = new mongoose.Schema({
  user:  { type: String, default: '' },
  line:  { type: Number, default: null },
  quote: { type: String, default: '' },
}, { _id: false });

const clipperFactSchema = new mongoose.Schema({
  sourceSlug: { type: String, default: 'cbat-guide', index: true },

  factKey:    { type: String, required: true, unique: true },
  sourceKind: { type: String, enum: ['test', 'day', 'app', 'other'], required: true },

  containerId:   { type: String, default: '' },   // e.g. 'flag'
  containerName: { type: String, default: '' },   // e.g. 'Figures, Logistics and Groups'
  containerAbbr: { type: String, default: '' },   // e.g. 'FLAG'

  // The guide's own confidence grade. Drives the grade gate in
  // utils/clipperGuardrails.js: green may be stated flatly, amber must be
  // hedged, red is excluded from generation entirely.
  grade: { type: String, enum: ['green', 'amber', 'red'], required: true, index: true },

  tag:  { type: String, default: '' },
  text: { type: String, required: true },
  why:  { type: String, default: '' },

  refs:     { type: [refSchema], default: [] },
  refCount: { type: Number, default: 0 },

  contentHash: { type: String, default: '' },

  // ── Anti-repetition ledger ───────────────────────────────────────────────
  // A fact may be reused freely; the same *spin* may not. Generation is given
  // useCount and every previous hook/angle so it can be told to find a new one.
  useCount:   { type: Number, default: 0, index: true },
  lastUsedAt: { type: Date, default: null },
  anglesUsed: { type: [angleSchema], default: [] },

  // Manual exclusion — a fact that keeps producing bad scripts, or has been
  // superseded, without deleting its history.
  retired: { type: Boolean, default: false, index: true },
}, { timestamps: true });

// Generation picks least-used facts first, filtered by grade.
clipperFactSchema.index({ retired: 1, grade: 1, useCount: 1 });

module.exports = mongoose.model('ClipperFact', clipperFactSchema);
