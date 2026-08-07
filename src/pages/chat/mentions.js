// Splitting a message body into plain text and @mention runs.
//
// The server stores mentions as user ids and leaves the literal "@Display Name"
// in the body (see backend/utils/chatMentions.js for why). Rendering is
// therefore a text match: take the display names of the people this message
// actually mentioned, and find those exact names after an "@".
//
// Driving it from the resolved names rather than from a bare /@\w+/ is what
// keeps "email me @ 5pm" and "@notarealuser" from lighting up like mentions.
// It also handles names with spaces, which are legal — "@Guide Bot" is one
// mention, not a mention of "Guide" followed by the word "Bot".

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * @param {string} body
 * @param {Array<{_id: string, displayName: string}>} mentionedUsers
 * @returns {Array<{ text: string, user: object|null }>} runs in document order;
 *          `user` is set on the mention runs and null on the plain ones
 */
export function splitMentions(body, mentionedUsers = []) {
  const text = String(body ?? '')
  const named = mentionedUsers.filter(u => u?.displayName)
  if (!text || !named.length) return [{ text, user: null }]

  // Longest name first, so "@Guide Bot" is not matched as "@Guide" when both
  // exist — the same longest-wins rule the server resolves with.
  const byLength = [...named].sort((a, b) => b.displayName.length - a.displayName.length)
  const pattern = byLength.map(u => escapeRegex(u.displayName)).join('|')
  // The trailing boundary stops "@Sam" matching inside "@Samantha" when only
  // Sam was mentioned.
  const re = new RegExp(`@(${pattern})(?![A-Za-z0-9_-])`, 'gi')

  const out = []
  let last = 0
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), user: null })
    const user = byLength.find(u => u.displayName.toLowerCase() === m[1].toLowerCase())
    out.push({ text: m[0], user: user ?? null })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last), user: null })
  return out.length ? out : [{ text, user: null }]
}

/**
 * The "@" token the caret is currently sitting in, or null.
 *
 * Display names may contain SPACES ("Guide Bot"), so this cannot stop at the
 * first one — which is why the token is bounded by the display-name rules
 * instead: 20 characters, the [A-Za-z0-9 _-] charset, no double spaces, and at
 * most two spaces before we decide the sentence has moved on.
 */
export function activeMention(text, caret) {
  const before = String(text ?? '').slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at === -1) return null
  // Mid-word "@" is an email address or a handle, not a mention being typed.
  if (at > 0 && !/\s/.test(before[at - 1])) return null

  const query = before.slice(at + 1)
  if (query.length > 20) return null
  if (!/^[A-Za-z0-9 _-]*$/.test(query)) return null
  if (/\s{2,}/.test(query)) return null
  if ((query.match(/ /g) ?? []).length > 2) return null

  return { start: at, query }
}

/** Did this message mention me? */
export function mentionsMe(message, userId) {
  if (!userId) return false
  return (message?.mentions ?? []).some(id => String(id) === String(userId))
}
