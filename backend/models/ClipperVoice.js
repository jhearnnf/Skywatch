const mongoose = require('mongoose');

// The Voicebox profiles available on the workstation.
//
// ── Why these are persisted when agent presence is not ──────────────────────
// Agent liveness is deliberately in-memory (see the note on agentPresence in
// routes/clipper.js): it has a thirty-second useful life, and a value that
// survived a restart would report an agent that is not there.
//
// Voice profiles were kept on that same object, and they are not the same kind
// of fact. A profile is a thing the admin made in the Voicebox app; it is still
// there after the backend restarts, after the agent restarts, and after the
// browser is closed. Parking it on a liveness signal meant every backend
// restart emptied the picker - and under nodemon that is every time a backend
// file is saved, which is why it looked like page refreshes were to blame.
//
// Worse, it could not always recover on its own: the agent only enumerates
// profiles while Voicebox is actually running, and the one thing that STARTS
// Voicebox is the admin pressing Reload voices. So a restart could leave the
// picker empty until it was pressed again.
//
// ── The rule this preserves ─────────────────────────────────────────────────
// An empty report means "I could not ask", not "there are none" - Voicebox was
// not running when the agent last looked. So an empty list never reaches this
// collection, and a non-empty one replaces it wholesale. Absence of knowledge
// is not knowledge of absence, now across restarts as well as heartbeats.

const clipperVoiceSchema = new mongoose.Schema({
  // Voicebox's own id for the profile, and the value stored on a voice job.
  voiceId: { type: String, required: true, unique: true },
  name:    { type: String, default: '' },

  // When the agent last confirmed this profile still exists. Kept for judging
  // whether a picker entry is stale after a long absence.
  lastSeenAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('ClipperVoice', clipperVoiceSchema);
