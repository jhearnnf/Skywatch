const mongoose = require('mongoose');

// One screen recording the capture bot has made, kept so it can be used again.
//
// ── Why this is its own collection ──────────────────────────────────────────
// A recording of a game is not specific to the beat that asked for it. Twenty
// seconds of FLAG being played is twenty seconds of FLAG being played, whatever
// line happens to be spoken over it - so re-recording the same game for every
// new script is a minute of browser automation spent producing a file we
// already had.
//
// Neither existing home is durable enough to be that catalogue:
//
//   ClipperJob    the agent panel can clear finished jobs (DELETE /jobs), which
//                 would silently empty the library.
//   ClipperScript footage entries are pruned when a script's beats are
//                 rewritten (see utils/clipperBeatCarry.js), so a recording
//                 would vanish because a sentence changed.
//
// A recording therefore gets a record of its own, written when the capture job
// completes and outliving both.
//
// The file itself still lives only on the agent's disk under %TEMP%, so an
// entry here is a claim about something that may since have been cleaned up.
// The listing route checks and says so rather than offering a dead clip.

const clipperCaptureSchema = new mongoose.Schema({
  // Which recipe produced it - the whole basis for reuse. A capture is offered
  // only to beats asking for the same recipe, because filming a different game
  // while the voice talks about this one is worse than stock footage.
  recipeId: { type: String, required: true, index: true },

  label: { type: String, default: '' },

  // Path on the agent's machine. Stored as the durable identity for the same
  // reason `chosen.playbackUrl` is a file:// URL: the agent's media server port
  // is ephemeral, so an http URL would bake in a port that dies with it.
  localPath: { type: String, default: '' },
  playbackUrl: { type: String, default: '' },

  durationSec: { type: Number, default: null },
  bytes:  { type: Number, default: null },
  width:  { type: Number, default: null },
  height: { type: Number, default: null },

  // Where the bot's hand went, in clip time (clipper-agent/capture/humanInput.js).
  // Travels with the recording rather than with the beat, so a reused clip
  // keeps its input-driven punch-in - see focusFromInput.
  inputLog: { type: mongoose.Schema.Types.Mixed, default: [] },

  // Kept for tracing a clip back to the run that made it.
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClipperJob', default: null },

  // So the picker can lead with the takes that have proved useful, and so a
  // clip nobody has ever chosen is identifiable as a candidate for deletion.
  useCount:   { type: Number, default: 0 },
  lastUsedAt: { type: Date, default: null },
}, { timestamps: true });

// The picker's query: the newest usable take of one recipe.
clipperCaptureSchema.index({ recipeId: 1, createdAt: -1 });

module.exports = mongoose.model('ClipperCapture', clipperCaptureSchema);
