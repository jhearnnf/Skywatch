// Where background music lives, and the rules it lives by.
//
// Tracks are files in public/sounds/music/, resolved through Remotion's
// staticFile() exactly like the sound effects — so the browser preview and the
// agent's renderer read the same bytes, and nothing is fetched from the
// internet at render time.
//
// The library itself is in Mongo (models/ClipperMusic.js) rather than a
// constant array like clipperSfx.js, because tracks are imported from a search
// rather than committed by hand — a catalogue that grows by editing source code
// would mean a code change every time you liked a track.
//
// ── Why the library is closed rather than searched per video ────────────────
// Same reasoning as the SFX catalogue: a recurring bed is part of what makes a
// channel recognisable, and a different track on every video works against
// that. Search exists to FILL the library, not to pick per video.
//
// ── The licence rule ────────────────────────────────────────────────────────
// Only CC0 and Public Domain Mark. Both ask nothing of us: no credit, no
// share-alike, no non-commercial limit. CC-BY is excluded on purpose — it is
// free and often better produced, but it obliges a visible credit on every
// video for ever, and that is a commitment to take deliberately rather than one
// to acquire by clicking a search result.
//
// A track you have cleared yourself (Pixabay, the YouTube Audio Library, a
// licence you bought) can be dropped into the folder and registered with its
// own licence text. The rule the code enforces is that every track SAYS what it
// is; the CC0/PDM filter only applies to what the search may import.

const path = require('path');

// Relative to public/, because that is what staticFile() wants.
const MUSIC_DIR = 'sounds/music';

// Absolute, for the import writing files in. Railway ships backend/ alone, so
// this path does not exist there — the import route checks before using it,
// and Clipper is local-only anyway.
const MUSIC_ABS_DIR = path.join(__dirname, '..', '..', 'public', MUSIC_DIR);

// A filename that cannot escape the music folder or collide with a sibling.
// The title comes from a third-party API, so it is not to be trusted with
// slashes, dots or anything else the filesystem reads as structure.
function slugify(title) {
  return String(title || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'track';
}

const musicPath = (file) => (file ? `${MUSIC_DIR}/${file}` : null);

module.exports = { MUSIC_DIR, MUSIC_ABS_DIR, slugify, musicPath };
