// Finding background music that carries no obligations.
//
// Openverse indexes CC-licensed audio and can filter by licence server-side. We
// ask it for CC0 and Public Domain Mark only, and then check the licence again
// on every result before it can be shown or imported.
//
// The second check is the point of this file. A query parameter is a request,
// not a guarantee: a change to Openverse's filter semantics, a typo in the
// query string, or an API that starts ignoring an unknown parameter would all
// quietly widen the pool to licences that require attribution — and the failure
// mode is a published video that owes a credit nobody knows about. Checking the
// licence we were actually handed makes that impossible rather than unlikely.
//
// CC-BY is deliberately NOT allowed. It is free and often better produced, but
// it obliges a visible credit on every video that uses it, for ever. That is a
// commitment to make deliberately, not one to acquire by clicking a search
// result. See the note in constants/clipperMusic.js.

const OPENVERSE_API = 'https://api.openverse.org/v1/audio/';
const UA = 'SkyWatch/1.0 (educational-platform)';

// The only licences that ask nothing of us: no credit, no share-alike, no
// non-commercial limit. Anything outside this list is rejected on the way in.
const FREE_LICENCES = new Set(['cc0', 'pdm']);

// Openverse serves preview-quality renditions for some providers, which is fine
// for a backing track under narration but means very long files are rarely
// worth the download. A short-form video is under a minute.
const MAX_DURATION_MS = 12 * 60 * 1000;
const MIN_DURATION_MS = 5 * 1000;

function isFreeLicence(licence) {
  return FREE_LICENCES.has(String(licence || '').toLowerCase());
}

// One search result, in the shape the rest of Clipper uses. Licence fields are
// not optional: an entry that cannot say what it is may not be stored.
function toCandidate(row) {
  if (!row?.id || !row?.url) return null;
  if (!isFreeLicence(row.license)) return null;

  const durationMs = Number(row.duration) || 0;
  if (durationMs && (durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS)) return null;

  return {
    provider:    'openverse',
    providerId:  String(row.id),
    title:       String(row.title || 'Untitled').slice(0, 200),
    creator:     String(row.creator || '').slice(0, 120),
    downloadUrl: row.url,
    durationMs,
    filetype:    String(row.filetype || 'mp3').toLowerCase(),
    bytes:       Number(row.filesize) || null,
    // Provenance, captured now because re-deriving it months later means
    // re-running a search that may no longer return the same thing.
    licence:     `${String(row.license).toUpperCase()} ${row.license_version || ''}`.trim(),
    licenceUrl:  row.license_url || null,
    sourceUrl:   row.foreign_landing_url || null,
    attribution: String(row.attribution || '').slice(0, 500),
    upstream:    String(row.provider || ''),
  };
}

// ── Authentication ──────────────────────────────────────────────────────────
// Openverse serves anonymous requests but rate-limits them hard, and once the
// budget is spent it does not throttle — it refuses, with
// 401 {"detail":"Authentication credentials were not provided."}. A handful of
// searches is enough to hit it, which reads as "the feature is broken".
//
// Registering an application lifts the limit substantially. Credentials are
// optional: without them this still works, it is just fragile, and the error
// below says so rather than reporting a bare status code.
const TOKEN_URL = 'https://api.openverse.org/v1/auth_tokens/token/';

// Cached because a token lasts hours and fetching one per search would double
// the request count on an API we are already being rate-limited by.
let cachedToken = { value: null, expiresAt: 0 };

function resetTokenCache() {
  cachedToken = { value: null, expiresAt: 0 };
}

async function getAccessToken() {
  const id = process.env.OPENVERSE_CLIENT_ID;
  const secret = process.env.OPENVERSE_CLIENT_SECRET;
  if (!id || !secret) return null;

  // A minute of headroom, so a token that expires mid-flight is not used.
  if (cachedToken.value && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.value;
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: new URLSearchParams({
      grant_type: 'client_credentials', client_id: id, client_secret: secret,
    }),
  });

  if (!res.ok) {
    // Not fatal: fall back to anonymous rather than failing the search outright.
    // Bad credentials should degrade to the behaviour of having none.
    resetTokenCache();
    return null;
  }

  const data = await res.json();
  if (!data?.access_token) return null;

  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
  return cachedToken.value;
}

async function searchMusic(term, { limit = 20, signal } = {}) {
  const query = String(term || '').trim();
  if (!query) return [];

  const url = `${OPENVERSE_API}?${new URLSearchParams({
    q: query,
    license: [...FREE_LICENCES].join(','),
    page_size: String(Math.min(50, Math.max(1, limit))),
  })}`;

  const token = await getAccessToken();
  const headers = { 'User-Agent': UA, ...(token ? { Authorization: `Bearer ${token}` } : {}) };

  let res = await fetch(url, { headers, signal });

  // A cached token can be revoked or expire early. One retry with a fresh one
  // distinguishes "our token went stale" from "we are over the limit".
  if (res.status === 401 && token) {
    resetTokenCache();
    const fresh = await getAccessToken();
    if (fresh) res = await fetch(url, { headers: { ...headers, Authorization: `Bearer ${fresh}` }, signal });
  }

  if (!res.ok) {
    throw new Error(describeFailure(res.status, token));
  }

  const data = await res.json();
  return (data.results ?? []).map(toCandidate).filter(Boolean);
}

// Say what to do about it. "Openverse search failed (401)" is a status code
// wearing a sentence, and the cause here is almost always the anonymous quota.
function describeFailure(status, hadToken) {
  if (status === 401 || status === 429) {
    return hadToken
      ? 'Openverse refused the request (rate limited). Wait a few minutes and try again.'
      : 'Openverse rate-limits anonymous searches and this one ran out of budget. '
        + 'Register a free application key and set OPENVERSE_CLIENT_ID and '
        + 'OPENVERSE_CLIENT_SECRET in backend/.env to lift the limit - see '
        + 'backend/scripts/registerOpenverse.js. Or wait a few minutes and try again.';
  }
  return `Openverse search failed (${status})`;
}

module.exports = {
  searchMusic, toCandidate, isFreeLicence, getAccessToken, resetTokenCache, describeFailure,
  FREE_LICENCES, MAX_DURATION_MS, MIN_DURATION_MS, OPENVERSE_API, TOKEN_URL,
};
