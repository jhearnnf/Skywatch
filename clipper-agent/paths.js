// Where the agent keeps the files it makes.
//
// Everything the Clipper produces on disk lives under one root: screen
// recordings, the frames they are built from, and the finished MP4s. Keeping
// them together is not tidiness for its own sake — the media server serves this
// root and nothing else, so a file written outside it cannot be played in the
// admin UI or read by the renderer, both of which speak http only.
//
// The default is the OS temp directory, which is wrong for anything anyone
// wants to keep: Windows sweeps it, and a render is a deliverable that gets
// uploaded, kept and compared against the next one. CLIPPER_MEDIA_ROOT moves
// the whole tree somewhere it survives.
//
// The backend derives the same paths independently (see RENDER_DIR in
// routes/clipper.js) rather than importing this file: a hosted deployment ships
// backend/ on its own and clipper-agent/ is not there at all. The two must be
// given the same value, which is why the .env.example on both sides says so.

const path = require('node:path');
const os = require('node:os');

// The old location, kept as more than a fallback.
//
// Recordings made before the root moved are still referenced by their absolute
// paths on script and capture documents, and those scripts must keep working —
// so the media server serves this directory too rather than only the current
// root. A capture from last week is not less playable for having been made
// before the setting existed.
const LEGACY_ROOT = path.join(os.tmpdir(), 'skywatch-clipper');

const MEDIA_ROOT = process.env.CLIPPER_MEDIA_ROOT
  ? path.resolve(process.env.CLIPPER_MEDIA_ROOT)
  : LEGACY_ROOT;

// Every directory a request may be served from, current root first. Duplicates
// collapse so an unset CLIPPER_MEDIA_ROOT does not list the temp path twice.
const SERVE_ROOTS = [...new Set([MEDIA_ROOT, LEGACY_ROOT])];

module.exports = {
  MEDIA_ROOT,
  LEGACY_ROOT,
  SERVE_ROOTS,
  CAPTURE_DIR: path.join(MEDIA_ROOT, 'capture'),
  VOICE_DIR: path.join(MEDIA_ROOT, 'voice'),
  RENDER_DIR: path.join(MEDIA_ROOT, 'renders'),
};
