'use strict';

/**
 * @mention parsing for chat messages.
 *
 * Mentions are resolved from the message TEXT on the server, not taken from a
 * list the client sends alongside it. Two reasons:
 *
 *   • Typing "@Falcon" by hand has to work exactly like picking Falcon out of
 *     the autocomplete. One code path means it always does.
 *   • A client-supplied id list is a claim about who was mentioned. Verifying
 *     it against the body costs the same as just parsing the body, and parsing
 *     cannot be lied to.
 *
 * The body keeps the literal "@Display Name" text rather than a "<@id>" token.
 * Tokens survive a rename, but every other surface in this app — the channel
 * preview, the report queue, the admin transcript, the reply snapshot — reads
 * the raw body, and all of them would have to learn to decode it. A rename is
 * rare (30-day cooldown) and the worst it does is leave an old mention
 * un-highlighted; a raw "<@664f...>" in the moderation queue is a permanent
 * papercut.
 *
 * Display names are 3–20 chars of [A-Za-z0-9 _-] with no double spaces (see
 * utils/displayName.js), which is what makes this parseable at all: SPACES ARE
 * LEGAL IN A NAME, so "@Guide Bot" cannot be read by splitting on whitespace.
 * Instead each "@" grabs the longest legal run after it and we try successively
 * shorter prefixes, longest first, against the real display names in the
 * database. Longest-first is what makes "@Guide Bot" resolve to Guide Bot even
 * if a user called "Guide" also exists.
 */

const { MIN_LEN, MAX_LEN } = require('./displayName');

// At most this many distinct people per message. A mention is a notification;
// without a cap one message could ping the entire user base.
const MENTION_LIMIT = 10;

// The run of name-legal characters following an "@".
//
// `(?<!\S)` requires the "@" to start the message or follow whitespace, so
// "james@example.com" is an email address rather than a mention of a user
// called "example". The run itself must start with a non-space, or "@ hello"
// would open a candidate.
//
// Kept identical to activeMention() in src/pages/chat/mentions.js: what the
// composer highlights as you type has to be what the server actually resolves.
const MENTION_RUN = new RegExp(`(?<!\\S)@([A-Za-z0-9_-][A-Za-z0-9 _-]{0,${MAX_LEN - 1}})`, 'g');

// Every prefix of a run that could legally be a display name, longest first.
// Prefixes ending in a space are skipped — a name never has trailing space, and
// trying them would just duplicate the next candidate down.
function prefixesOf(run) {
  const out = [];
  for (let end = Math.min(run.length, MAX_LEN); end >= MIN_LEN; end--) {
    const candidate = run.slice(0, end);
    if (candidate !== candidate.trim()) continue;
    out.push(candidate);
  }
  return out;
}

// The raw runs following each "@" in the body.
function mentionRuns(body) {
  const runs = [];
  const re = new RegExp(MENTION_RUN.source, 'g');
  let m;
  while ((m = re.exec(String(body ?? ''))) !== null) runs.push(m[1]);
  return runs;
}

// Every lowercase name a body could be mentioning. This is the set to look up.
function mentionCandidates(body) {
  const out = new Set();
  for (const run of mentionRuns(body)) {
    for (const p of prefixesOf(run)) out.add(p.toLowerCase());
  }
  return [...out];
}

/**
 * Resolve the mentions in a body to real users.
 *
 * @param {string}   body
 * @param {Function} findUsers  async (lowerNames[]) => [{ _id, displayName,
 *                              displayNameLower, isBot }]. Injected so this is
 *                              unit-testable without a database.
 * @returns {Promise<Array>} the mentioned users, de-duplicated, capped
 */
async function resolveMentions(body, { findUsers, limit = MENTION_LIMIT } = {}) {
  const candidates = mentionCandidates(body);
  if (!candidates.length) return [];

  const users = await findUsers(candidates);
  const byLower = new Map(
    (users ?? []).map(u => [String(u.displayNameLower ?? u.displayName ?? '').toLowerCase(), u]),
  );
  if (!byLower.size) return [];

  const picked = new Map();
  for (const run of mentionRuns(body)) {
    // Longest first, and stop at the first hit: "@Guide Bot" must resolve to
    // Guide Bot, not to a shorter "Guide" that happens to also exist.
    for (const p of prefixesOf(run)) {
      const user = byLower.get(p.toLowerCase());
      if (user) { picked.set(String(user._id), user); break; }
    }
    if (picked.size >= limit) break;
  }
  return [...picked.values()].slice(0, limit);
}

// Does this body mention this specific user? Used to decide whether the guide
// bot was addressed, without re-querying.
function mentionsUser(mentionedUsers, userId) {
  return (mentionedUsers ?? []).some(u => String(u._id) === String(userId));
}

module.exports = {
  MENTION_LIMIT,
  mentionRuns,
  mentionCandidates,
  prefixesOf,
  resolveMentions,
  mentionsUser,
};
