// Validation + cooldown helpers for User.displayName.
//
// Rules
//   - length 3–20
//   - charset [A-Za-z0-9 _-] only
//   - no leading/trailing whitespace, no double-spaces
//   - reject purely numeric (collides visually with agent numbers)
//   - reject names starting with reserved prefixes (impersonation guard)
//   - reject a small profanity blocklist
//
// Cooldown
//   - 30 days between changes (first ever set is free; clear-then-set counts)

const COOLDOWN_DAYS = 30;
const COOLDOWN_MS   = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

const MIN_LEN = 3;
const MAX_LEN = 20;

const CHARSET = /^[A-Za-z0-9 _-]+$/;

const RESERVED_PREFIXES = ['agent ', 'admin', 'mod ', 'moderator', 'skywatch', 'staff', 'system', 'support'];

const PROFANITY = ['fuck', 'shit', 'cunt', 'nigger', 'faggot', 'retard', 'rape'];

function validateDisplayName(raw, { isAdmin = false } = {}) {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: true, value: null };
  }
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'displayName must be a string' };
  }
  const value = raw;
  if (value !== value.trim()) {
    return { ok: false, reason: 'No leading or trailing whitespace' };
  }
  if (value.length < MIN_LEN) {
    return { ok: false, reason: `Must be at least ${MIN_LEN} characters` };
  }
  if (value.length > MAX_LEN) {
    return { ok: false, reason: `Must be ${MAX_LEN} characters or fewer` };
  }
  if (!CHARSET.test(value)) {
    return { ok: false, reason: 'Only letters, numbers, spaces, underscores, and hyphens allowed' };
  }
  if (/\s{2,}/.test(value)) {
    return { ok: false, reason: 'No double spaces' };
  }
  if (/^\d+$/.test(value)) {
    return { ok: false, reason: 'Cannot be only numbers' };
  }
  const lower = value.toLowerCase();
  if (!isAdmin && RESERVED_PREFIXES.some(p => lower.startsWith(p))) {
    return { ok: false, reason: 'That name is reserved' };
  }
  if (PROFANITY.some(p => lower.includes(p))) {
    return { ok: false, reason: 'That name is not allowed' };
  }
  return { ok: true, value };
}

// Returns ms remaining on cooldown, or 0 if changes are allowed.
// First-ever set (no prior change timestamp) is always allowed.
function cooldownRemaining(displayNameChangedAt, now = Date.now()) {
  if (!displayNameChangedAt) return 0;
  const elapsed = now - new Date(displayNameChangedAt).getTime();
  const remaining = COOLDOWN_MS - elapsed;
  return remaining > 0 ? remaining : 0;
}

module.exports = {
  validateDisplayName,
  cooldownRemaining,
  COOLDOWN_DAYS,
  COOLDOWN_MS,
  MIN_LEN,
  MAX_LEN,
};
