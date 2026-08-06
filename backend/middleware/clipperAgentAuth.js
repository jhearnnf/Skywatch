const crypto = require('crypto');

// Bearer-token auth for the local Clipper agent.
//
// The agent is a headless process on a workstation. It has no browser, no
// session cookie and no user, so `protect`/`adminOnly` cannot apply — this is
// the substitute. The token is a shared secret in CLIPPER_AGENT_TOKEN.
//
// If the variable is unset the agent endpoints are closed entirely rather than
// left open. A deployment that never configured a token has no agent, and an
// unauthenticated job queue would let anyone drain work or post fake results.

// Constant-time compare so a wrong token cannot be recovered by timing how long
// the rejection takes. Lengths are compared first because timingSafeEqual
// throws on a mismatch, and the length itself is not the secret.
function tokensMatch(provided, expected) {
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function clipperAgentAuth(req, res, next) {
  const expected = process.env.CLIPPER_AGENT_TOKEN;

  if (!expected) {
    return res.status(503).json({ message: 'Clipper agent is not configured on this server' });
  }

  const header = req.get('authorization') || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!provided || !tokensMatch(provided, expected)) {
    return res.status(401).json({ message: 'Invalid agent token' });
  }

  // Free-text label so several agents (desktop, laptop) are distinguishable in
  // the job log. Never trusted for authorisation — the token already did that.
  req.agentId = String(req.get('x-clipper-agent') || 'agent').slice(0, 64);
  next();
}

module.exports = { clipperAgentAuth, tokensMatch };
