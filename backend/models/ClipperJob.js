const mongoose = require('mongoose');

// A unit of media work for the local Clipper agent: download stock clips,
// record the site in a browser, synthesise voice, align captions, render.
//
// The queue lives in Mongo rather than in memory because the agent is on a
// workstation that gets closed, sleeps, and loses its network. A job must
// survive all of that and still be there when the agent comes back — an
// in-process queue would drop work every time the laptop lid shut.
//
// Claiming is a single atomic findOneAndUpdate (see routes/clipper.js), so two
// agents polling at once cannot take the same job.

const JOB_TYPES = [
  'footage-search',   // query stock providers for a beat
  'capture',          // drive a browser and record the site
  'voices',           // start Voicebox and enumerate its voice profiles
  'voice',            // synthesise a beat's narration
  'captions',         // word-level alignment over the voice track
  'render',           // compose the final MP4
];

const JOB_STATUSES = ['queued', 'claimed', 'done', 'failed'];

const clipperJobSchema = new mongoose.Schema({
  scriptId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClipperScript', required: true, index: true },
  type:     { type: String, enum: JOB_TYPES, required: true },
  status:   { type: String, enum: JOB_STATUSES, default: 'queued', index: true },

  // Everything the agent needs to run without calling back for context.
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  result:  { type: mongoose.Schema.Types.Mixed, default: null },
  error:   { type: String, default: '' },

  // Progress reporting for long jobs — a render can take minutes and the UI
  // should not look frozen while it does.
  progress: { type: Number, default: 0, min: 0, max: 100 },
  stepLabel: { type: String, default: '' },

  claimedAt:  { type: Date, default: null },
  claimedBy:  { type: String, default: '' },   // agent instance id, for debugging
  finishedAt: { type: Date, default: null },

  attempts:    { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 3 },
}, { timestamps: true });

// The claim query: oldest queued job first.
clipperJobSchema.index({ status: 1, createdAt: 1 });

clipperJobSchema.statics.JOB_TYPES = JOB_TYPES;
clipperJobSchema.statics.JOB_STATUSES = JOB_STATUSES;

module.exports = mongoose.model('ClipperJob', clipperJobSchema);
