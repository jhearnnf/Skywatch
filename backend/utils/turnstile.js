// Cloudflare Turnstile server-side verification.
// Returns { ok: true } when the token is valid, otherwise { ok: false, reason }.
// If TURNSTILE_SECRET_KEY is not configured, returns { ok: true, unconfigured: true }
// so the admin UI can display a warning while signups continue to work.

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

async function verifyTurnstileToken(token, remoteIp) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, unconfigured: true };
  if (!token)  return { ok: false, reason: 'missing-token' };

  try {
    const body = new URLSearchParams();
    body.append('secret', secret);
    body.append('response', token);
    if (remoteIp) body.append('remoteip', remoteIp);

    const res = await fetch(SITEVERIFY_URL, { method: 'POST', body });
    const data = await res.json();
    if (data.success) return { ok: true };
    return { ok: false, reason: (data['error-codes'] || []).join(',') || 'invalid-token' };
  } catch (err) {
    return { ok: false, reason: `siteverify-error: ${err.message}` };
  }
}

module.exports = { verifyTurnstileToken };
