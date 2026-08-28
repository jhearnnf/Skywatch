// What a Clipper video is ABOUT, and the questions the pipeline asks of it.
//
// ── Why this exists ─────────────────────────────────────────────────────────
// A script has always had a `mode` of 'tips' or 'feature', but 'feature' was a
// label and nothing more: the same prompt, the same stock-jet b-roll, the same
// single mention of the site in the outro. A finished render was therefore hard
// to read as an advert for anything, which is exactly the complaint that
// prompted this file.
//
// A subject fixes that by being a thing the prompt, the capture recipes and the
// validator can all name. "Promote FLAG" stops being a wish and becomes: say
// FLAG in three beats, film /cbat/flag three times, and fail validation if the
// finished script does neither.
//
// ── Why only some games ─────────────────────────────────────────────────────
// The table only lists games carrying [data-demo-start] (and, where the game
// waits on input, [data-demo-answer]). Those two attributes are the whole
// interface the capture bot has; without them a game cannot be filmed being
// played, and a feature video whose subject cannot appear on camera is the
// problem this file was written to solve rather than a use of it.
//
// Data lives in clipperSubjects.json so the frontend can import the same list.

const { subjects: RAW } = require('./clipperSubjects.json');

const SUBJECTS = RAW.filter(s => s && s.key);

const SUBJECT_BY_KEY = new Map(SUBJECTS.map(s => [s.key, s]));

const GAME_SUBJECTS     = SUBJECTS.filter(s => s.kind === 'game');
const PLATFORM_SUBJECTS = SUBJECTS.filter(s => s.kind === 'platform');

// Every recipe id the capture agent is expected to know. Exported so the script
// prompt can hand the model a closed list and the coercion below can tell a
// hallucinated recipe from a real one.
const ALL_RECIPE_IDS = SUBJECTS.map(s => s.recipeId);

function subjectFor(key) {
  return SUBJECT_BY_KEY.get(String(key || '')) ?? null;
}

// A capture beat in a subject-led video may show the subject, the games menu or
// a leaderboard — and nothing else. Filming a different game while the voice
// talks about this one is worse than stock footage, because it looks deliberate.
//
// A video with no subject is not an advert and has nothing to be off-message
// about, so it keeps the run of the whole list: a tips video is often better
// for showing the game the tip is about.
function allowedRecipeIds(subject) {
  const platform = PLATFORM_SUBJECTS.map(s => s.recipeId);
  if (!subject) return [...platform, ...GAME_SUBJECTS.map(s => s.recipeId)];
  if (subject.kind !== 'game') return platform;
  return [subject.recipeId, ...platform];
}

// Does this line actually name the subject out loud?
//
// Matched on word boundaries against the spoken name and its aliases. Short
// aliases like "act" and "cut" are ordinary English words, so this will
// occasionally count a sentence that was not naming the game — acceptable,
// because the only thing riding on it is a warning that the product is
// under-named, and a false pass there is milder than nagging about a script
// that already says the name three times.
function mentionsSubject(text, subject) {
  if (!subject) return false;
  const hay = String(text || '');
  if (!hay) return false;

  const needles = [subject.spokenName, ...(subject.aliases || [])]
    .map(n => String(n || '').trim())
    .filter(Boolean);

  return needles.some(n => {
    const re = new RegExp(`(?<![A-Za-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, 'i');
    return re.test(hay);
  });
}

// The subject as stored on a script document. Kept narrow on purpose: the doc
// records WHICH subject, and this module answers everything else, so a change
// to a game's spoken name does not need a migration.
function normaliseSubject(input) {
  const key = typeof input === 'string' ? input : input?.key;
  const subject = subjectFor(key);
  if (!subject) return { kind: 'none', key: '' };
  return { kind: subject.kind, key: subject.key };
}

module.exports = {
  SUBJECTS,
  GAME_SUBJECTS,
  PLATFORM_SUBJECTS,
  ALL_RECIPE_IDS,
  subjectFor,
  allowedRecipeIds,
  mentionsSubject,
  normaliseSubject,
};
