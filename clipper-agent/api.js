// Thin wrapper over the Clipper agent endpoints.
//
// Every call carries the shared bearer token — the agent has no cookie and no
// user session, so this is the whole of its identity to the server.

const BASE  = (process.env.CLIPPER_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const TOKEN = process.env.CLIPPER_AGENT_TOKEN || '';
const AGENT = process.env.CLIPPER_AGENT_ID || 'workstation';

if (!TOKEN) {
  throw new Error('CLIPPER_AGENT_TOKEN is not set — copy .env.example to .env and fill it in');
}

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}/api/clipper${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'X-Clipper-Agent': AGENT,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  // 204 is the server's "queue is empty" — a normal outcome, not a failure.
  if (res.status === 204) return null;

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.message || `${method} ${path} failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return json.data;
}

const heartbeat = (version, voices) =>
  call('/agent/heartbeat', { method: 'POST', body: { version, voices } });
const claimJob   = () => call('/agent/jobs');
const reportProgress = (id, progress, stepLabel) =>
  call(`/agent/jobs/${id}/progress`, { method: 'POST', body: { progress, stepLabel } });
const reportResult = (id, ok, payload) =>
  call(`/agent/jobs/${id}/result`, {
    method: 'POST',
    body: ok ? { ok: true, result: payload } : { ok: false, error: String(payload) },
  });

module.exports = { call, heartbeat, claimJob, reportProgress, reportResult, BASE, AGENT };
