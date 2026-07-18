// Session token issuing, cookie options, and sliding renewal.
//
// Previously the JWT was signed with a flat 7-day expiry and nothing ever
// renewed it, so *every* user was logged out weekly no matter how often they
// used the app. Worse, the frontend kept a cached user in localStorage for
// offline play and only cleared it when /auth/me actually answered — so a dead
// session didn't produce a login prompt, it produced a normal-looking app that
// silently recorded nothing. See the session/auth notes in the admin log types.
//
// The fix is a long window that slides forward on use: sign in once, keep using
// the app, never see a login screen again. Someone would have to ignore it for
// the full TTL to be asked to sign in, and that prompt is then correct rather
// than a bug.

const jwt = require('jsonwebtoken');

const TOKEN_TTL_DAYS = Number(process.env.JWT_TTL_DAYS || 90);
const TOKEN_TTL_MS   = TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

// Only re-issue once a token is older than this. Renewing on every request
// would mean signing a JWT and writing a Set-Cookie on all API traffic for no
// benefit — a token with most of its life left doesn't need extending.
const RENEW_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: `${TOKEN_TTL_DAYS}d` });

// NOTE on sameSite: 'none' is retained deliberately. The API is served from
// api.skywatch.academy, which is same-site with the frontend, so 'lax' would
// also work — but 'none' is a superset and changing it buys nothing while
// risking the Capacitor origins. Revisit only if third-party cookie policy
// starts rejecting it outright.
const cookieOptions = () => {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure:   isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge:   TOKEN_TTL_MS,
  };
};

const setAuthCookie = (res, token) => res.cookie('jwt', token, cookieOptions());

// Slide the session forward if the token is getting old. Best-effort: a failure
// here must never turn an otherwise-fine authenticated request into an error.
// Native clients don't use the cookie (they send a Bearer token), so they pick
// a renewed token up from GET /api/auth/me instead — see that route.
function maybeRenewSession(res, decoded) {
  try {
    const issuedAtMs = (decoded?.iat ?? 0) * 1000;
    if (!issuedAtMs || !decoded?.id) return false;
    if (Date.now() - issuedAtMs < RENEW_AFTER_MS) return false;
    setAuthCookie(res, signToken(decoded.id));
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  signToken,
  setAuthCookie,
  cookieOptions,
  maybeRenewSession,
  TOKEN_TTL_DAYS,
  TOKEN_TTL_MS,
  RENEW_AFTER_MS,
};
