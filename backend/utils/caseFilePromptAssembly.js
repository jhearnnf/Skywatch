'use strict';

const fs   = require('fs');
const path = require('path');

const PROMPTS_DIR      = path.join(__dirname, '..', 'prompts', 'caseFiles');
const EDITORIAL_PATH   = path.join(PROMPTS_DIR, 'editorial_rules.md');
const ACTORS_DIR       = path.join(PROMPTS_DIR, 'actors');

// Module-level cache: avoids repeated disk reads for the same files.
// Key for editorial rules: '__editorial__'.
// Key for actor files:     the actorPromptKey string.
const _cache = new Map();

function readEditorialRules() {
  if (_cache.has('__editorial__')) return _cache.get('__editorial__');
  const content = fs.readFileSync(EDITORIAL_PATH, 'utf8');
  _cache.set('__editorial__', content);
  return content;
}

function readActorPrompt(actorPromptKey) {
  if (_cache.has(actorPromptKey)) return _cache.get(actorPromptKey);
  const actorPath = path.join(ACTORS_DIR, `${actorPromptKey}.md`);
  if (!fs.existsSync(actorPath)) {
    throw new Error(`Actor prompt file not found: actors/${actorPromptKey}.md`);
  }
  const content = fs.readFileSync(actorPath, 'utf8');
  _cache.set(actorPromptKey, content);
  return content;
}

// Moods the portrait in the interrogation panel can pull. Kept in step with
// MOODS in src/utils/caseFiles/actorMood.js, minus 'thinking', which is a
// client-side state for "a question is in flight" and never comes from here.
const MOODS = ['neutral', 'guarded', 'firm', 'grave', 'wry'];

// Asks for the delivery alongside the words. The player is shown a drawn
// portrait of the actor while they answer, and a face that never changes makes
// a deflection and a warning look identical. The tag is stripped by
// splitMoodTag() before anything reaches the client, so the editorial rule that
// answers are plain prose with no meta-commentary still holds for the player.
const MOOD_TAG_INSTRUCTION = [
  'System annotation, not part of your reply:',
  `After your reply, on its own final line, output exactly [[mood: X]] where X is one of: ${MOODS.join(', ')}.`,
  'Pick the one that best describes how you are delivering this particular answer.',
  'That line is removed before the player sees anything. Never mention it, and never let it change the wording of the reply itself.',
].join('\n');

/**
 * splitMoodTag(text)
 *
 * Pulls the [[mood: X]] annotation back out of a completion.
 * Returns { answer, mood }, where mood is null if the model omitted the tag or
 * emitted one that is not in MOODS — the client has its own fallback for that,
 * so a missing tag degrades to a neutral face rather than an error.
 */
function splitMoodTag(text) {
  const raw = typeof text === 'string' ? text : '';
  // Global, because a model that repeats itself should not leave half a tag in
  // the prose. The LAST match wins: it is the one the instruction asked for.
  // Case-insensitive on the key as well as the value: a model that shouts the
  // annotation back still gets its tag stripped rather than leaving it in the
  // prose the player reads.
  const pattern = /\[\[\s*mood\s*:\s*([a-zA-Z]+)\s*\]\]/gi;
  let mood = null;
  let match;
  while ((match = pattern.exec(raw)) !== null) {
    const candidate = match[1].toLowerCase();
    if (MOODS.includes(candidate)) mood = candidate;
  }
  const answer = raw.replace(pattern, '').trim();
  return { answer, mood };
}

/**
 * assembleInterrogationPrompt
 *
 * Builds the system prompt for a live actor interrogation turn.
 * Reads editorial_rules.md + actors/<actorPromptKey>.md from disk (cached).
 * Appends a context-date anchor line and the mood-tag annotation.
 *
 * @param {object} opts
 * @param {string} opts.actorPromptKey   - Filename stem under prompts/caseFiles/actors/ (e.g. 'lavrov')
 * @param {string} opts.contextDateLabel - Human-readable context date from the stage payload (e.g. 'Nov 2021')
 * @returns {{ systemPrompt: string }}
 */
function assembleInterrogationPrompt({ actorPromptKey, contextDateLabel }) {
  const editorial = readEditorialRules();
  const actor     = readActorPrompt(actorPromptKey);

  const systemPrompt = [
    editorial.trim(),
    '',
    actor.trim(),
    '',
    `You are roleplaying as of ${contextDateLabel}.`,
    '',
    MOOD_TAG_INSTRUCTION,
  ].join('\n');

  return { systemPrompt };
}

// Exported for testing only — allows cache to be cleared between test runs.
function _clearCache() {
  _cache.clear();
}

module.exports = { assembleInterrogationPrompt, splitMoodTag, MOODS, _clearCache };
