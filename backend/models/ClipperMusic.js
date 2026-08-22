const mongoose = require('mongoose');

// A track in the Clipper music library.
//
// The licence fields are required, not decoration. These tracks end up under
// published videos, so "what is this and may we use it?" has to be answerable
// months later without re-running a search that may no longer return the same
// result. Same principle as the per-clip licence capture in clipperFootage.js.

const clipperMusicSchema = new mongoose.Schema({
  // Stable id and the basis of the filename, so a track can be referenced from
  // a script without depending on a Mongo id the admin never sees.
  slug:  { type: String, required: true, unique: true, index: true },
  title: { type: String, required: true },
  creator: { type: String, default: '' },

  // Filename within public/sounds/music/. Stored bare rather than as a full
  // path so moving the folder is a constant change, not a migration.
  file: { type: String, required: true },

  durationMs: { type: Number, default: 0 },
  bytes:      { type: Number, default: 0 },

  // Measured at import (utils/clipperTempo.js), used to land the cuts inside a
  // beat on the music. Null when ffmpeg is missing or the track has no pulse
  // worth trusting — an absent tempo simply means nothing snaps, which is
  // exactly how videos behaved before this existed.
  bpm:           { type: Number, default: null },
  bpmConfidence: { type: Number, default: 0 },

  // ── Provenance ────────────────────────────────────────────────────────────
  // `licence` is free text because a hand-added track may carry a licence no
  // enum would anticipate ("Pixabay content licence", "purchased - invoice
  // 1042"). What matters is that it is never empty.
  licence:     { type: String, required: true },
  licenceUrl:  { type: String, default: '' },
  sourceUrl:   { type: String, default: '' },
  attribution: { type: String, default: '' },
  // 'openverse' for an imported track, 'local' for one dropped in by hand.
  provider:    { type: String, default: 'local' },
  providerId:  { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('ClipperMusic', clipperMusicSchema);
