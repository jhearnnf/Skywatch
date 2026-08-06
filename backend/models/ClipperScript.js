const mongoose = require('mongoose');

// Clipper script — the project document for one short-form video.
//
// Stages populate this doc in order (script → footage → voice → captions →
// sfx → overlays → export), but the fine-tune editor is a persistent surface
// rather than a stage: from footage onward it is always available. Editing an
// upstream stage marks the ones after it 'stale' rather than wiping them, so
// hand-tuned work is never silently destroyed — regenerating downstream is an
// explicit action.
//
// Media-bearing stages are deliberately loose (Mixed) at this point. They are
// filled in by the local agent, whose payload shapes are still settling; the
// script stage below is strict because the guardrail validator depends on it.

const STAGES = ['script', 'footage', 'voice', 'captions', 'sfx', 'overlays', 'export'];

const beatSchema = new mongoose.Schema({
  id:   { type: String, required: true },
  text: { type: String, default: '' },          // the spoken line

  // Which reference facts this beat draws on. Drives the grade gate at
  // validation time and the ledger increment on approval.
  factKeys: { type: [String], default: [] },

  visual: {
    kind:     { type: String, enum: ['stock', 'capture', 'library'], default: 'stock' },
    query:    { type: String, default: '' },    // stock search terms
    recipeId: { type: String, default: '' },    // browser-capture recipe
  },

  // Suggested at script time, approved/edited in their own stages later.
  sfxCue:  { type: String, default: '' },
  overlay: { type: String, default: '' },
}, { _id: false });

const clipperScriptSchema = new mongoose.Schema({
  title: { type: String, default: '' },
  mode:  { type: String, enum: ['tips', 'feature'], default: 'tips', index: true },

  stage: { type: String, enum: STAGES, default: 'script', index: true },
  stageState: {
    type: Map,
    of: { type: String, enum: ['pending', 'approved', 'stale'] },
    default: () => new Map(),
  },

  idea: {
    oneLiner: { type: String, default: '' },
    hook:     { type: String, default: '' },
    angle:    { type: String, default: '' },
    factKeys: { type: [String], default: [] },
  },

  script: {
    beats:          { type: [beatSchema], default: [] },
    wordCount:      { type: Number, default: 0 },
    estDurationSec: { type: Number, default: 0 },
  },

  // Marketing outro. Modelled as a flag plus copy rather than a stage: when
  // enabled it becomes a real beat at render time, so it flows through voice,
  // captions and SFX like any other beat and outro variants can be compared.
  outro: {
    enabled: { type: Boolean, default: true },
    copy:    { type: String, default: '' },
  },

  // Latest guardrail result, so the UI can show why a script is not ready
  // without re-running validation on every page load.
  validation: {
    ok:       { type: Boolean, default: false },
    checkedAt:{ type: Date, default: null },
    findings: { type: mongoose.Schema.Types.Mixed, default: [] },
  },

  // ── Filled in by later stages / the local agent ───────────────────────────
  // footage is keyed by beat id: { [beatId]: { term, candidates[], chosen, trim } }.
  footage:  { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  voice:    { type: mongoose.Schema.Types.Mixed, default: null },
  captions: { type: mongoose.Schema.Types.Mixed, default: null },
  sfx:      { type: mongoose.Schema.Types.Mixed, default: [] },
  overlays: { type: mongoose.Schema.Types.Mixed, default: [] },
  timeline: { type: mongoose.Schema.Types.Mixed, default: null },
  renders:  { type: mongoose.Schema.Types.Mixed, default: [] },

  // Set when the ledger has been credited for this script, so repeated
  // approvals can't inflate useCount.
  ledgerCommittedAt: { type: Date, default: null },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

clipperScriptSchema.statics.STAGES = STAGES;

module.exports = mongoose.model('ClipperScript', clipperScriptSchema);
