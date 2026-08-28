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

  // The one beat that opens a new question mid-video. Recorded because it is a
  // structural claim about the script, not a property of the line: reading the
  // beats back later, "where does this re-hook?" is not recoverable from the
  // text alone.
  rehook: { type: Boolean, default: false },
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

  // What the video is ABOUT - a CBAT game, the platform, or nothing in
  // particular. Stored as a key alone: constants/clipperSubjects.js owns the
  // spoken name, the description and the capture recipe, so renaming a game
  // does not need a migration.
  //
  // `mode: 'feature'` used to be the whole of this, and it was a label nothing
  // acted on. The subject is what the script prompt, the capture recipes and
  // the guardrail validator all read.
  subject: {
    kind: { type: String, enum: ['game', 'platform', 'none'], default: 'none' },
    key:  { type: String, default: '' },
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
    // 'list' | 'myth-bust' | 'one-mistake' - the retention shape the writer
    // committed to. Empty on scripts written before shapes were asked for.
    format:         { type: String, default: '' },
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
  // One background track for the whole video: { slug, title, file, licence,
  // sourceUrl, volume, duckVolume, fadeOutMs }. Levels live here rather than on
  // the track because the same bed sits differently under a busy read.
  music:    { type: mongoose.Schema.Types.Mixed, default: null },
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
