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

/**
 * assembleInterrogationPrompt
 *
 * Builds the system prompt for a live actor interrogation turn.
 * Reads editorial_rules.md + actors/<actorPromptKey>.md from disk (cached).
 * Appends a context-date anchor line.
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
  ].join('\n');

  return { systemPrompt };
}

// Exported for testing only — allows cache to be cleared between test runs.
function _clearCache() {
  _cache.clear();
}

module.exports = { assembleInterrogationPrompt, _clearCache };
