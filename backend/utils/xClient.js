// X (Twitter) API v2 client — OAuth 2.0 PKCE flow + tweet posting + media upload.
// All network calls go through the injectable `fetch` (defaults to global) so
// tests can mock it without a network roundtrip.

const crypto = require('crypto');

const AUTH_BASE  = 'https://x.com/i/oauth2/authorize';
const TOKEN_URL  = 'https://api.x.com/2/oauth2/token';
const TWEETS_URL = 'https://api.x.com/2/tweets';
const MEDIA_URL  = 'https://api.x.com/2/media/upload';
const ME_URL     = 'https://api.x.com/2/users/me';

const DEFAULT_SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'offline.access', 'media.write'];

function base64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generatePkce() {
  const verifier  = base64url(crypto.randomBytes(64));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function generateState() {
  return base64url(crypto.randomBytes(24));
}

function buildAuthorizeUrl({ clientId, redirectUri, scopes = DEFAULT_SCOPES, state, codeChallenge }) {
  if (!clientId)      throw new Error('clientId required');
  if (!redirectUri)   throw new Error('redirectUri required');
  if (!state)         throw new Error('state required');
  if (!codeChallenge) throw new Error('codeChallenge required');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${AUTH_BASE}?${params.toString()}`;
}

function basicAuthHeader(clientId, clientSecret) {
  return 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
}

async function exchangeCode({ clientId, clientSecret, code, redirectUri, codeVerifier, fetchImpl = fetch }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
  });
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': basicAuthHeader(clientId, clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(`X token exchange failed (${res.status}): ${stringifyErr(data)}`);
  return data;
}

async function refreshAccessToken({ clientId, clientSecret, refreshToken, fetchImpl = fetch }) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': basicAuthHeader(clientId, clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(`X token refresh failed (${res.status}): ${stringifyErr(data)}`);
  return data;
}

async function getMe({ accessToken, fetchImpl = fetch }) {
  const res = await fetchImpl(ME_URL, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(`X /users/me failed (${res.status}): ${stringifyErr(data)}`);
  return data?.data || data;
}

async function postTweet({ accessToken, text, mediaIds = [], poll = null, fetchImpl = fetch }) {
  const body = { text };
  if (mediaIds.length) body.media = { media_ids: mediaIds };
  if (poll && Array.isArray(poll.options) && poll.options.length) {
    body.poll = {
      options: poll.options,
      duration_minutes: Number(poll.duration_minutes) || 1440,
    };
  }
  const res = await fetchImpl(TWEETS_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(`X tweet failed (${res.status}): ${stringifyErr(data)}`);
  return data?.data || data;
}

// X v2 /2/media/upload requires media_category — without it the API returns
// 400 "One or more parameters to your request was invalid." (v1.1 was lenient,
// v2 is strict). The multipart `media` part also needs a filename so the
// boundary is well-formed.
function mediaCategoryFor(mimeType) {
  const m = String(mimeType || '').toLowerCase();
  if (m === 'image/gif')      return 'tweet_gif';
  if (m.startsWith('video/')) return 'tweet_video';
  return 'tweet_image';
}

function filenameFor(mimeType) {
  const m = String(mimeType || '').toLowerCase();
  if (m === 'image/png')  return 'upload.png';
  if (m === 'image/gif')  return 'upload.gif';
  if (m === 'image/webp') return 'upload.webp';
  if (m.startsWith('video/mp4')) return 'upload.mp4';
  return 'upload.jpg';
}

async function uploadMedia({ accessToken, buffer, mimeType, fetchImpl = fetch }) {
  if (!buffer || !buffer.length) throw new Error('buffer required');
  if (!mimeType)                 throw new Error('mimeType required');
  const form = new FormData();
  form.append('media', new Blob([buffer], { type: mimeType }), filenameFor(mimeType));
  form.append('media_category', mediaCategoryFor(mimeType));
  form.append('media_type', mimeType);
  const res = await fetchImpl(MEDIA_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}` },
    body: form,
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(`X media upload failed (${res.status}): ${stringifyErr(data)}`);
  // v2 returns { data: { id, media_key, ... } }; v1.1-style returns { media_id_string }.
  return data?.data?.id || data?.media_id_string || data?.id || null;
}

async function safeJson(res) {
  try { return await res.json(); } catch { return null; }
}

function stringifyErr(data) {
  if (!data) return 'no body';
  if (data.error_description) return data.error_description;
  if (data.detail)            return data.detail;
  if (data.title)             return data.title;
  if (data.errors)            return JSON.stringify(data.errors);
  return JSON.stringify(data);
}

module.exports = {
  DEFAULT_SCOPES,
  generatePkce,
  generateState,
  buildAuthorizeUrl,
  exchangeCode,
  refreshAccessToken,
  getMe,
  postTweet,
  uploadMedia,
};
