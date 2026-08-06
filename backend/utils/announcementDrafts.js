// Turns recent GitHub commits into short, user-facing update messages for the
// Announcements channel.
//
// This does NOT post anything. It returns drafts for an admin to approve, edit
// or discard one by one — the AI writes, a human ships. That split is
// deliberate: commit messages are written for developers and regularly say
// things ("bump versionCode", "fix the CUT panel drop cues") that mean nothing
// to a player, and occasionally things we would not want announced at all.
//
// External deps (OpenRouter, GitHub) are injected so unit tests can stub them
// without hitting the network — same pattern as socialDraftGenerator.js.

const { callOpenRouter } = require('./openRouter');
const { fetchRecentCommits } = require('./githubCommits');

// Matches the model the rest of the backend uses for short-form copy.
const DEFAULT_MODEL = 'anthropic/claude-haiku-4-5';

const MAX_UPDATES = 6;
const MAX_CHARS   = 280;

const SYSTEM_PROMPT = `You write short product update notes for SkyWatch, an aptitude-training platform for people interested in the Royal Air Force.

You are given raw git commit messages. Turn them into update notes a PLAYER would care about.

Rules:
- Each note is 1-2 short sentences, under ${MAX_CHARS} characters.
- Write for a player, not a developer. "Commit", "refactor", "endpoint", "schema", "backend" and file names must never appear.
- Say what changed and why it matters to them. If a commit has no player-visible effect, leave it out entirely.
- Group related commits into ONE note. Do not write a note per commit.
- Plain, factual, quietly confident. No marketing hype, no exclamation marks, no emoji.
- Use hyphens, never em dashes.
- Never say or imply the platform helps people apply to the RAF. Keep any reference general.
- Never imply these are the real RAF CBAT tests. They are CBAT-style practice.
- If NOTHING in the list is player-visible, return an empty updates array. That is a valid and useful answer.

Return ONLY valid JSON, no code fences, in this exact shape:
{"updates":[{"text":"...","shas":["abc1234"]}]}

"shas" lists the short SHAs of every commit that note covers.`;

function buildUserPrompt(commits) {
  const lines = commits.map(c => `- ${c.shortSha} ${c.message}`).join('\n');
  return `Recent commits, newest first:\n\n${lines}\n\nWrite at most ${MAX_UPDATES} update notes.`;
}

// Models sometimes wrap JSON in ```json fences despite being told not to.
function parseUpdates(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const cleaned = raw.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Last resort: pull the outermost object out of any surrounding prose.
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return [];
    try { parsed = JSON.parse(match[0]); } catch { return []; }
  }

  const updates = Array.isArray(parsed?.updates) ? parsed.updates : [];
  return updates
    .map(u => ({
      text: typeof u?.text === 'string' ? u.text.trim() : '',
      shas: Array.isArray(u?.shas) ? u.shas.filter(s => typeof s === 'string') : [],
    }))
    .filter(u => u.text)
    .slice(0, MAX_UPDATES);
}

/**
 * Generate draft announcement notes from recent commits.
 *
 * @param {string[]} excludeShas short SHAs already announced — filtered out
 *   before the model sees them, so a second run doesn't re-offer old news.
 * @returns {Promise<{ updates: Array<{text, shas}>, commitsConsidered: number, skipped: number }>}
 */
async function generateAnnouncementDrafts({
  excludeShas = [],
  limit = 15,
  model = DEFAULT_MODEL,
  fetchCommits = fetchRecentCommits,
  callAi = callOpenRouter,
} = {}) {
  const excluded = new Set(excludeShas.map(String));

  // Over-fetch, then drop the already-announced ones, so a run that follows a
  // big announcement still has material to work with.
  const all = await fetchCommits({ limit: limit + excluded.size });
  const fresh = all.filter(c => !excluded.has(c.shortSha) && !excluded.has(c.sha)).slice(0, limit);

  if (!fresh.length) {
    return { updates: [], commitsConsidered: 0, skipped: all.length };
  }

  const data = await callAi({
    // The generic OpenRouter key — this is an occasional admin action, not a
    // feature with its own budget line.
    key: 'main',
    feature: 'announcements',
    body: {
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: buildUserPrompt(fresh) },
      ],
      temperature: 0.6,
    },
  });

  const raw = data?.choices?.[0]?.message?.content ?? '';
  const updates = parseUpdates(raw).map(u => ({
    text: u.text.slice(0, MAX_CHARS),
    // Keep only SHAs that were actually in the input — a model that invents one
    // would otherwise poison the exclude list and silently hide a real commit.
    shas: u.shas.filter(s => fresh.some(c => c.shortSha === s || c.sha === s)),
  }));

  return {
    updates,
    commitsConsidered: fresh.length,
    skipped: all.length - fresh.length,
  };
}

module.exports = {
  generateAnnouncementDrafts,
  parseUpdates,
  buildUserPrompt,
  DEFAULT_MODEL,
  MAX_UPDATES,
  MAX_CHARS,
};
