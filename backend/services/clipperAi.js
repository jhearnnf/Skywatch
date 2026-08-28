// Clipper AI — generates short-form video ideas and full scripts from the
// graded facts in the CBAT reference guide.
//
// Two calls, deliberately kept separate:
//   1. generateIdeas  — cheap batch of one-liners; the admin picks one
//   2. generateScript — the full beat list for the chosen idea
//
// The script call emits the spoken text AND the per-beat visual query, SFX cue
// and overlay suggestion in one pass, so every later stage is search-and-approve
// rather than another generation. That is the same division of labour as
// briefReelAi: the model writes the script, our code owns how it is rendered.
//
// Nothing here enforces content rules. Prompts ask, utils/clipperGuardrails.js
// enforces — see the note at the top of that file for why.

const { callOpenRouter } = require('../utils/openRouter');
const {
  GAME_SUBJECTS, subjectFor, allowedRecipeIds,
} = require('../constants/clipperSubjects');
const { parseTimelineJson: parseAiJson, containment } = require('./briefReelAi');

const MODEL = 'anthropic/claude-sonnet-4-5';

// Tokens too generic to signal what an idea is *about*. Shares the approach of
// briefReelAi's CALLOUT_STOPWORDS but not its vocabulary — every Clipper idea
// mentions CBAT and tests, so those words carry no signal here.
const IDEA_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'over', 'your',
  'you', 'are', 'has', 'have', 'their', 'than', 'about', 'what', 'when', 'how',
  'why', 'but', 'not', 'can', 'will', 'must', 'should', 'get', 'got', 'one',
  'cbat', 'test', 'tests', 'testing', 'raf', 'exam', 'score', 'scores',
  'tip', 'tips', 'trick', 'tricks', 'thing', 'things', 'know', 'need',
]);

const SIMILARITY_THRESHOLD = 0.5;

function ideaTokens(text) {
  const words = String(text || '').toLowerCase().match(/[a-z0-9]{2,}/g) || [];
  return new Set(words.filter(w => !IDEA_STOPWORDS.has(w)));
}

// Drop candidates that say the same thing as an earlier idea — either one
// already generated in this batch, or one from the ledger.
function dedupeIdeas(candidates, priorTexts) {
  const seen = (priorTexts || []).map(ideaTokens).filter(s => s.size > 0);
  const kept = [];

  for (const cand of candidates) {
    const tokens = ideaTokens(cand.oneLiner);
    if (tokens.size === 0) continue;
    if (seen.some(prev => containment(prev, tokens) >= SIMILARITY_THRESHOLD)) continue;
    seen.push(tokens);
    kept.push(cand);
  }
  return kept;
}

// ── Prompt fragments ────────────────────────────────────────────────────────

const HOUSE_RULES = `Hard content rules. These are checked by a validator after you answer, and a script that breaks them is rejected:

1. NEVER name a real person. The source material is a community chat export; the people in it did not consent to appearing in a video. Refer to "sitters", "people who've taken it", "one candidate" — never a username or name.
2. NEVER claim or imply this platform hosts the real CBAT, or that its practice games are identical to the real test. They are CBAT-style simulations. You may give advice ABOUT the real test; you may not say we have it.
3. NEVER say the platform helps someone pass an RAF application, get into the RAF, or improve their chances. Keep any reference to the RAF general.
4. Facts are confidence-graded and the grade is given to you:
   - green: state it directly.
   - amber: you MUST hedge it. Use "reportedly", "a lot of sitters say", "people tend to find", "worth checking" or similar IN THE SAME BEAT.
   - red: never used - you will not be given any.
5. Use hyphens, not em dashes or en dashes.
6. Write British English.`;

const VOICE_GUIDE = `Voice and format:

- This is a 9:16 short-form video, spoken aloud over b-roll. Target 45 seconds, roughly 110-130 words total.
- The FIRST beat is the hook. It has about 2 seconds to stop a scroll. Make it concrete and specific - a surprising number, a counterintuitive claim, a mistake people make. Never open with "In this video" or "Here are some tips".
- Short sentences. Spoken register, not written. Contractions are good.
- Name the thing plainly. Puns and idioms read as filler.
- Every beat must earn its place - if a beat does not add a new fact or turn, cut it.

Structure. A good hook only buys the first two seconds; most videos are lost in the middle, and a middle with no shape is a list of facts in the order they were remembered. Pick ONE of these and hold it all the way through:

- LIST: "three things", counted out loud ("first", "second", "and the last one"). The count tells the viewer how far in they are, which is itself a reason to stay.
- MYTH-BUST: what nearly everyone believes, then what actually happens. The turn is the payoff, so do not give it away in the hook.
- ONE-MISTAKE: the mistake, why it is the tempting thing to do, what to do instead.

Two more rules that apply whichever shape you pick:

- RE-HOOK around 40-50% of the way through. One beat that opens a NEW question rather than continuing to answer the old one - "but that is not the part that catches people out". Without it the second half is just the first half running down.
- STRONGEST FACT LAST. Rank what you have been given and spend the best of it at the end, not in beat two. A video that fires its best material early has nothing left to hold the half where people leave.`;

// ── Idea generation ─────────────────────────────────────────────────────────

const IDEA_SCHEMA = `Return ONLY a JSON object:

{
  "ideas": [
    {
      "oneLiner": "<the video's premise in one sentence, <= 120 chars>",
      "hook":     "<the opening line as it would be spoken, <= 90 chars>",
      "angle":    "<what makes THIS take different, <= 90 chars>",
      "mode":     "tips" | "feature",
      "subject":  "<subject key from the list below, or "" for a tips video that shows nothing>",
      "factKeys": ["test:flag:0", ...]
    }
  ]
}

- "tips" = advice about sitting the test. "feature" = showcases something on the platform.
- EVERY "feature" idea must name a subject, and it must be one of the keys listed below. A feature video with no subject is a video about nothing, and will be rejected.
- A "tips" idea may name a subject too, when the advice has an obvious place to be demonstrated. Leave it "" when it does not.
- factKeys must be chosen from the facts supplied below. 1-3 per idea.
- Every idea must be about a DIFFERENT main point. Do not produce two ideas that a viewer would experience as the same video.`;

// The closed list of things a video may be about, written out for the prompt.
// Both calls get it: ideas so a feature idea has something real to point at,
// scripts so the writer knows what the thing actually does and does not have to
// invent mechanics for a game it has never seen.
function formatSubjectsForPrompt() {
  return GAME_SUBJECTS
    .map(s => `- [${s.key}] ${s.spokenName} - ${s.what}`)
    .join('\n');
}

function formatFactsForPrompt(facts) {
  return facts.map(f => {
    const where = f.containerAbbr || f.containerName || f.containerId;
    return `- [${f.factKey}] (${f.grade}${where ? `, ${where}` : ''}) ${f.text}`;
  }).join('\n');
}

// The coverage map is what stops the ledger repeating itself. A fact may be
// reused freely; the same spin may not, so we hand the model every hook and
// angle a fact has already carried and require a new one.
function formatCoverage(facts) {
  const used = facts.filter(f => f.useCount > 0);
  if (used.length === 0) return 'No fact has been used in a video yet.';

  return used.map(f => {
    const angles = (f.anglesUsed || [])
      .map(a => `      - hook: "${a.hook}" / angle: "${a.angle}"`)
      .join('\n');
    return `- [${f.factKey}] used ${f.useCount}x:\n${angles || '      (angles not recorded)'}`;
  }).join('\n');
}

async function generateIdeas({ facts, priorOneLiners = [], count = 6, mode = null }) {
  if (!Array.isArray(facts) || facts.length === 0) {
    throw new Error('No facts available to generate ideas from');
  }

  const system = `You are the script writer for SkyWatch's short-form video channel. SkyWatch is an independent platform with CBAT-style practice games. You turn findings from a community research guide about the CBAT aptitude test into ideas for TikTok/Reels/Shorts videos.

${HOUSE_RULES}

${VOICE_GUIDE}

${IDEA_SCHEMA}`;

  const user = `Subjects you may promote - a "feature" idea MUST name one of these keys:
${formatSubjectsForPrompt()}

Available facts:
${formatFactsForPrompt(facts)}

Previously used angles - any reuse of these facts needs a genuinely different hook AND a different main point:
${formatCoverage(facts)}

Generate ${count} ideas${mode ? ` in "${mode}" mode` : ''}. Return ONLY the JSON object.`;

  const res = await callOpenRouter({
    key: 'clipper',
    feature: 'clipper-ideas',
    body: {
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 2000,
      temperature: 0.9,   // ideas want range; the script call is tighter
    },
  });

  const parsed = parseAiJson(res?.choices?.[0]?.message?.content ?? '{}');
  if (!parsed || !Array.isArray(parsed.ideas)) {
    throw new Error('AI returned no ideas');
  }

  const validKeys = new Set(facts.map(f => f.factKey));
  const cleaned = parsed.ideas
    .filter(i => i && typeof i.oneLiner === 'string' && i.oneLiner.trim())
    .map(i => ({
      oneLiner: i.oneLiner.trim(),
      hook:     String(i.hook  ?? '').trim(),
      angle:    String(i.angle ?? '').trim(),
      mode:     i.mode === 'feature' ? 'feature' : 'tips',
      // A hallucinated subject key is dropped rather than trusted. A feature
      // idea that loses its subject that way is discarded below: it is an
      // advert with nothing to advertise, which is the exact failure this
      // whole mechanism exists to stop.
      subject:  subjectFor(i.subject)?.key ?? '',
      // Drop hallucinated keys rather than failing the batch — the admin still
      // gets usable ideas, and an idea with no valid fact is discarded below.
      factKeys: Array.isArray(i.factKeys) ? i.factKeys.filter(k => validKeys.has(k)) : [],
    }))
    .filter(i => i.factKeys.length > 0)
    .filter(i => i.mode !== 'feature' || i.subject);

  return dedupeIdeas(cleaned, priorOneLiners);
}

// ── Stock queries ───────────────────────────────────────────────────────────
//
// A stock library cannot search for an idea, only for a thing that was pointed
// a camera at. Ask it for "determination" and it returns a stranger looking
// thoughtfully out of a window, which is the exact texture that makes a video
// read as filler — and a measured render came back with seven shots, none of
// them aviation and several of them precisely that.
//
// The prompt asks for concrete nouns. This is the backstop for when it does not
// get them, because the failure is silent: an abstract query returns plenty of
// results, so nothing downstream ever looks wrong.
const ABSTRACT_QUERY_TOKENS = new Set([
  'success', 'successful', 'failure', 'failing', 'determination', 'determined',
  'motivation', 'motivated', 'inspiration', 'inspiring', 'mindset', 'attitude',
  'concentration', 'concentrating', 'focus', 'focused', 'thinking', 'thought',
  'thoughtful', 'stress', 'stressed', 'anxiety', 'anxious', 'pressure',
  'confidence', 'confident', 'achievement', 'achieving', 'goal', 'goals',
  'dream', 'dreams', 'journey', 'challenge', 'challenging', 'struggle',
  'decision', 'decisions', 'choice', 'choices', 'teamwork', 'leadership',
  'ambition', 'ambitious', 'potential', 'opportunity', 'future', 'concept',
  'abstract', 'idea', 'ideas', 'mental', 'cognitive', 'intelligence', 'smart',
  'clever', 'difficult', 'hard', 'easy', 'fast', 'quick', 'reaction', 'skill',
  'skills', 'ability', 'performance', 'preparation', 'practice', 'practising',
  // Generic people. A stock library reads these as "stock photo of a human",
  // which is the same filler by another route.
  'person', 'people', 'someone', 'man', 'men', 'woman', 'women', 'guy',
  'young', 'candidate', 'candidates', 'student', 'students', 'businessman',
]);

// Words that carry nothing on their own once the abstractions are gone. Only
// these are trimmed from the end of a query — dropping them from the middle
// would turn "jet taking off runway" into something a library cannot match.
const QUERY_FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'and', 'or',
  'his', 'her', 'their', 'its', 'this', 'that', 'up', 'out', 'under', 'over',
]);

// Anything that cannot be the SUBJECT of a shot. Used to answer "is there still
// something to film here?" after the abstractions have gone, and nothing else:
// "young candidate making a decision" strips down to "making", which passes a
// naive is-it-empty check and is not a picture of anything.
const WEAK_QUERY_TOKENS = new Set([
  ...QUERY_FUNCTION_WORDS,
  'making', 'taking', 'doing', 'being', 'getting', 'having', 'using', 'trying',
  'looking', 'feeling', 'showing', 'working', 'thinking', 'is', 'are', 'be',
]);

// Concrete things this channel is actually about, used when a query has nothing
// filmable left in it. Chosen by beat index so a script whose queries all
// collapse does not end up with the same clip six times.
const FALLBACK_QUERIES = [
  'fighter jet taking off runway',
  'cockpit instrument panel dials',
  'air traffic control radar screen',
  'military aircraft formation flying',
  'pilot helmet visor cockpit',
  'jet aircraft banking through clouds',
];

function constrainQuery(query, index = 0) {
  const words = String(query || '').toLowerCase().match(/[a-z0-9-]+/g) || [];
  const kept = words.filter(w => !ABSTRACT_QUERY_TOKENS.has(w));
  const hasSubject = kept.some(w => !WEAK_QUERY_TOKENS.has(w));

  if (!hasSubject) return FALLBACK_QUERIES[index % FALLBACK_QUERIES.length];
  // Stripping leaves dangling function words at both ends - "cockpit view of",
  // "at a desk" - and they only dilute the search.
  while (kept.length && QUERY_FUNCTION_WORDS.has(kept[kept.length - 1])) kept.pop();
  while (kept.length && QUERY_FUNCTION_WORDS.has(kept[0])) kept.shift();
  return kept.join(' ');
}

// ── Script generation ───────────────────────────────────────────────────────

const scriptSchema = (recipeIds) => `Return ONLY a JSON object:

{
  "title": "<short internal title, <= 60 chars>",
  "format": "list" | "myth-bust" | "one-mistake",
  "beats": [
    {
      "id": "b1",
      "text": "<the spoken line, 1-2 sentences>",
      "factKeys": ["test:flag:0"],
      "visual": {
        "kind": "stock" | "capture",
        "query": "<3-6 word stock footage search, e.g. 'fighter jet cockpit view'>",
        "recipeId": "<only when kind is capture>"
      },
      "sfxCue": "<optional: whoosh | riser | pop | scratch | notification | ''>",
      "overlay": "<optional on-screen text, <= 40 chars, '' if none>",
      "rehook": <true on the one beat that opens a new question mid-video, omit otherwise>
    }
  ],
  "outro": "<closing call to action, <= 60 chars, '' if none>"
}

- 6 to 10 beats.
- Name the shape you chose in "format", and actually follow it. A "list" script with nothing counted out loud is a list in name only.
- Mark the re-hook beat with "rehook": true. Exactly one beat, somewhere around the middle.
- factKeys may be empty for a linking beat, but every fact you were given should appear in some beat.
- visual.kind is "capture" for any beat showing the platform itself - a real screen recording of the site. Available recipeIds, and NOTHING else: ${recipeIds.map(r => `\`${r}\``).join(', ')}. Otherwise use "stock" with a query.
- visual.query must name PHYSICAL THINGS a camera has been pointed at, and should be aviation or military wherever the line allows it. Aircraft, cockpits, runways, radar screens, control towers, flight helmets, instrument panels, hangars, ground crew.
  A stock library cannot film an idea. Queries like "determination", "mental focus", "person thinking", "under pressure" or "making a decision" all return a stranger looking out of a window, and that is what makes a video look like filler. If a beat is about something abstract, pick the concrete aviation image that sits nearest to it - a beat about split-second decisions is a cockpit, not a furrowed brow.
- Do not put an overlay on every beat. Three or four across the video is right.`;

// What the script has to do differently when the video is promoting something.
//
// Every number here is also checked by utils/clipperGuardrails.js. Asking is
// not enough on its own - the previous version of this prompt said nothing at
// all about showing the product, and a finished render was accordingly hard to
// read as an advert for anything.
// The descriptions in the subject table are written to follow a colon, so they
// start lower case. This one follows a full stop.
const sentenceCase = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

function subjectBrief(subject, recipeIds) {
  if (!subject) return '';

  const isGame = subject.kind === 'game';

  return `This video is promoting one specific thing, and a viewer who watches it to the end must be able to say what that thing is and what it does.

Promoting: ${subject.spokenName}
What it is: ${isGame ? `a CBAT-style practice game on SkyWatch. ${sentenceCase(subject.what)}` : subject.what}

Rules for this video. These are checked by a validator, and a script that breaks them is rejected:

- Say "${subject.spokenName}" out loud in at least THREE beats, and one of those must be in the first two. Named once in the outro is a product nobody remembers; named in the hook is a product the video is about.
- At least THREE beats must be visual.kind "capture" with recipeId "${subject.recipeId}", and one of those must be in the first two beats. The viewer has to SEE it, and see it early - the words alone do not tell anyone what the screen looks like.
- The only recipeIds you may use are: ${recipeIds.join(', ')}. Never film a different game while the voice is talking about this one.
- Describe what it actually asks you to do, using the description above. Do not invent mechanics, scoring or features.${isGame ? `
- It is a CBAT-style simulation of that subtest, not the real CBAT.` : ''}`;
}

async function generateScript({ idea, facts, mode = 'tips', outroEnabled = true, subject = null }) {
  if (!idea || !idea.oneLiner) throw new Error('An idea is required');
  if (!Array.isArray(facts) || facts.length === 0) {
    throw new Error('No facts supplied for the script');
  }

  const resolved  = subjectFor(subject?.key ?? subject ?? idea.subject);
  const recipeIds = allowedRecipeIds(resolved);

  const system = `You are the script writer for SkyWatch's short-form video channel. SkyWatch is an independent platform with CBAT-style practice games.

${HOUSE_RULES}

${VOICE_GUIDE}
${resolved ? `
${subjectBrief(resolved, recipeIds)}
` : ''}
${scriptSchema(recipeIds)}`;

  const user = `Write the script for this idea.

Premise: ${idea.oneLiner}
Hook:    ${idea.hook || '(write one)'}
Angle:   ${idea.angle || '(your choice)'}
Mode:    ${mode}
Promoting: ${resolved ? `${resolved.spokenName} (capture recipeId "${resolved.recipeId}")` : 'nothing in particular'}

Facts you may use - the grade in brackets decides whether you state it flatly or hedge it:
${formatFactsForPrompt(facts)}

${outroEnabled
  ? 'End with a short call to action pointing at skywatch.academy. One sentence, spoken in under three seconds - the outro is the last thing on screen and every extra word there is time the viewer spends not looking at anything new. It must not mention RAF applications.'
  : 'Do not write an outro - return "" for outro.'}

Return ONLY the JSON object.`;

  const res = await callOpenRouter({
    key: 'clipper',
    feature: 'clipper-script',
    body: {
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 3000,
      temperature: 0.7,
    },
  });

  const parsed = parseAiJson(res?.choices?.[0]?.message?.content ?? '{}');
  if (!parsed || !Array.isArray(parsed.beats) || parsed.beats.length === 0) {
    throw new Error('AI returned no script beats');
  }

  const validKeys   = new Set(facts.map(f => f.factKey));
  const validRecipes = new Set(recipeIds);

  const beats = parsed.beats
    .filter(b => b && typeof b.text === 'string' && b.text.trim())
    .map((b, i) => {
      const kind = b.visual?.kind === 'capture' ? 'capture' : 'stock';
      const text = b.text.trim();

      // A capture beat naming a recipe we do not have is the one case worth
      // repairing rather than reporting. Left alone it fails the whole capture
      // job at record time; demoted to stock it silently costs the video the
      // shot of the product it was asking for. Pointing it at the subject is
      // what the beat was reaching for anyway.
      let recipeId = kind === 'capture' ? String(b.visual?.recipeId ?? '').trim() : '';
      if (recipeId && !validRecipes.has(recipeId)) recipeId = recipeIds[0];

      return {
        id:       String(b.id || `b${i + 1}`),
        text,
        factKeys: Array.isArray(b.factKeys) ? b.factKeys.filter(k => validKeys.has(k)) : [],
        visual: {
          kind,
          // Constrained rather than trusted: an abstract query fails silently,
          // returning plenty of results that are all wrong.
          query:    kind === 'stock' ? constrainQuery(b.visual?.query, i) : '',
          recipeId,
        },
        sfxCue:  String(b.sfxCue  ?? '').trim(),
        overlay: String(b.overlay ?? '').trim(),
        rehook:  b.rehook === true,
      };
    });

  // Exactly one re-hook, and never the opening beat - a "new question" on beat
  // one is just the hook by another name. If the model marked several, keep the
  // middle one, which is where the rule was aimed.
  const marked = beats.map((b, i) => (b.rehook ? i : -1)).filter(i => i > 0);
  for (const b of beats) b.rehook = false;
  if (marked.length) beats[marked[Math.floor((marked.length - 1) / 2)]].rehook = true;

  const wordCount = beats.reduce((n, b) => n + b.text.split(/\s+/).filter(Boolean).length, 0);

  const FORMATS = ['list', 'myth-bust', 'one-mistake'];

  return {
    title: String(parsed.title ?? '').trim() || idea.oneLiner.slice(0, 60),
    // Echoed back so the caller stores WHICH subject this script was written
    // for. Validation needs it on every later edit, not just at generation.
    subject: resolved ? { kind: resolved.kind, key: resolved.key } : { kind: 'none', key: '' },
    // Recorded rather than merely asked for, so "which shape is this" is
    // answerable when a script is read back weeks later - and so a shape the
    // model invented does not quietly become a fourth format.
    format: FORMATS.includes(parsed.format) ? parsed.format : '',
    beats,
    wordCount,
    // ~2.6 words/sec is a typical short-form voiceover pace. Reconciled against
    // real VO duration once stage 3 has run.
    estDurationSec: Math.round(wordCount / 2.6),
    outro: outroEnabled ? String(parsed.outro ?? '').trim() : '',
  };
}

module.exports = {
  generateIdeas,
  generateScript,
  subjectBrief,
  constrainQuery,
  ABSTRACT_QUERY_TOKENS,
  FALLBACK_QUERIES,
  dedupeIdeas,
  ideaTokens,
  IDEA_STOPWORDS,
  SIMILARITY_THRESHOLD,
};
