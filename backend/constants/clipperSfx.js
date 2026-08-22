// The Clipper sound-effect catalogue.
//
// A closed set, deliberately. Unlike footage — where every beat wants a
// different clip — short-form SFX want the opposite: the same dozen sounds
// recurring is what makes a channel recognisable, and a per-video search would
// introduce variety that actively works against that.
//
// Same principle as the closed action enums in briefReelAi: the script writer
// picks a cue from this list, so it can never name a sound we cannot play.
//
// Files live in public/sounds/sound_effects/ so both the browser preview and
// the agent's renderer resolve them through Remotion's staticFile().

const SFX_DIR = 'sounds/sound_effects';

// `placement` is where a cue belongs relative to the line it punctuates, and it
// exists because forced alignment already knows when every word was spoken
// (utils/clipperCaptions.js) while SFX could only ever be placed at a beat
// boundary. A stinger fired at the start of a sentence it was meant to land on
// the end of is not punctuation, it is noise arriving early.
//
//   lead  the sound sets up what follows, so it belongs at the beat's start
//   land  the sound punctuates something, so it belongs on the final word -
//         which is usually where the emphasis of a spoken line falls
const SFX = [
  { id: 'whoosh',        file: 'whoosh_small.mp3',          label: 'Whoosh',          durationMs: 2425, use: 'Beat-to-beat transition', placement: 'lead' },
  { id: 'whoosh-big',    file: 'whoosh_big.mp3',            label: 'Whoosh (big)',    durationMs: 5431, use: 'Major turn or reveal', placement: 'lead' },
  { id: 'riser',         file: 'riser.mp3',                 label: 'Riser',           durationMs: 14545, use: 'Build into a payoff - start it early', placement: 'lead' },
  { id: 'impact',        file: 'impact.mp3',                label: 'Impact',          durationMs: 329,  use: 'Land a fact hard', placement: 'land' },
  { id: 'sub-drop',      file: 'sub_drop.mp3',              label: 'Sub drop',        durationMs: 1985, use: 'Weight under a reveal', placement: 'land' },
  { id: 'pop',           file: 'pop.mp3',                   label: 'Pop',             durationMs: 99,   use: 'Callout appearing', placement: 'lead' },
  { id: 'click',         file: 'click.mp3',                 label: 'Click',           durationMs: 322,  use: 'UI interaction in a demo', placement: 'lead' },
  { id: 'notification',  file: 'notification.mp3',          label: 'Notification',    durationMs: 319,  use: 'Score or alert moment', placement: 'land' },
  { id: 'ding',          file: 'ding_bell.mp3',             label: 'Ding',            durationMs: 2519, use: 'Correct answer, positive beat', placement: 'land' },
  { id: 'record-scratch',file: 'record_scratch.mp3',        label: 'Record scratch',  durationMs: 1599, use: 'Contradiction - "actually, no"', placement: 'land' },
  { id: 'camera',        file: 'camera_shutter_double.mp3', label: 'Camera shutter',  durationMs: 950,  use: 'Freeze-frame or stat card', placement: 'land' },
  { id: 'swoosh-reverse',file: 'swoosh_reverse.mp3',        label: 'Swoosh (reverse)',durationMs: 2367, use: 'Lead INTO a cut - place it before the beat', placement: 'lead' },
  { id: 'typewriter',    file: 'typewriter.mp3',            label: 'Typewriter',      durationMs: 980,  use: 'Text appearing on screen', placement: 'lead' },
];

const SFX_BY_ID = new Map(SFX.map(s => [s.id, s]));

// The AI writes a free-text sfxCue on each beat. Map it onto the catalogue so a
// near-miss ("swoosh", "woosh", "transition") still resolves rather than being
// silently dropped.
const CUE_ALIASES = {
  whoosh: 'whoosh', woosh: 'whoosh', swoosh: 'whoosh', transition: 'whoosh',
  riser: 'riser', build: 'riser', rise: 'riser',
  impact: 'impact', hit: 'impact', boom: 'impact', thud: 'impact',
  drop: 'sub-drop', bass: 'sub-drop',
  pop: 'pop', bubble: 'pop',
  click: 'click', tap: 'click',
  notification: 'notification', alert: 'notification', ping: 'notification',
  ding: 'ding', bell: 'ding', correct: 'ding',
  scratch: 'record-scratch', 'record-scratch': 'record-scratch', 'record scratch': 'record-scratch',
  camera: 'camera', shutter: 'camera', snap: 'camera',
  reverse: 'swoosh-reverse',
  typewriter: 'typewriter', typing: 'typewriter', type: 'typewriter',
};

function resolveCue(cue) {
  const raw = String(cue || '').trim().toLowerCase();
  if (!raw) return null;
  if (SFX_BY_ID.has(raw)) return raw;
  if (CUE_ALIASES[raw]) return CUE_ALIASES[raw];
  // Last resort: any alias word appearing in the cue text.
  for (const [word, id] of Object.entries(CUE_ALIASES)) {
    if (raw.includes(word)) return id;
  }
  return null;
}

function sfxPath(id) {
  const entry = SFX_BY_ID.get(id);
  return entry ? `${SFX_DIR}/${entry.file}` : null;
}

module.exports = { SFX, SFX_BY_ID, SFX_DIR, CUE_ALIASES, resolveCue, sfxPath };
