// PostHog session replays attached to a support ticket, for admins only.
//
// Two parts:
//   • The CURRENT session. The reporting browser knows which recording is
//     running when they press Report and sends its id. Nothing is looked up;
//     the link is built here from the id, never taken from the client, so a
//     user cannot put an arbitrary address into an admin's ticket.
//   • EARLIER sessions, for a problem that happened on a previous visit. One
//     HogQL query per ticket, run in the background after the report is
//     saved, and the answer is stored on the ticket so reopening it never
//     calls PostHog again. Reading data back through the API is not billed;
//     it only counts against a rate limit, and one call per report is far
//     inside it. Any failure — no key, a timeout, a rate limit — leaves the
//     report exactly as it would have been, with "Couldn't load earlier
//     sessions" in the card.
//
// Needs POSTHOG_PERSONAL_API_KEY (a phx_ key with session recording / query
// read access) and POSTHOG_PROJECT_ID in backend/.env. Without them the
// earlier-sessions list says so, and the current-session link still works.

const ChatConversation = require('../models/ChatConversation');
const { locationLabel } = require('../constants/presenceLocations');

// posthog-js session ids are UUIDs (v7). Anything else is not one of ours.
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_OFFSET_MS = 24 * 60 * 60 * 1000;
const EARLIER_LIMIT = 5;
const EARLIER_DAYS = 7;
const FETCH_TIMEOUT_MS = 8000;

const uiHost = () => (process.env.POSTHOG_UI_HOST || 'https://eu.posthog.com').replace(/\/+$/, '');
const projectId = () => (process.env.POSTHOG_PROJECT_ID || '').trim();

/**
 * The client's description of its recording, cleaned. Returns null when it
 * sent nothing usable at all, so an old bundle files a report with no card.
 */
function sanitiseReplay(input) {
  if (!input || typeof input !== 'object') return null;
  const recording = input.recording === true;
  const sessionId = typeof input.sessionId === 'string' && SESSION_ID_RE.test(input.sessionId)
    ? input.sessionId.toLowerCase()
    : null;
  const rawOffset = Number(input.offsetMs);
  const offsetMs = Number.isFinite(rawOffset) && rawOffset >= 0 && rawOffset <= MAX_OFFSET_MS
    ? Math.round(rawOffset)
    : null;
  return {
    recording: recording && Boolean(sessionId),
    sessionId,
    offsetMs,
    capturedAt: new Date(),
    earlier: { status: 'pending', fetchedAt: null, sessions: [] },
  };
}

function replayUrl(sessionId, offsetMs = null) {
  if (!sessionId || !SESSION_ID_RE.test(sessionId)) return null;
  const project = projectId();
  const base = project
    ? `${uiHost()}/project/${encodeURIComponent(project)}/replay/${sessionId}`
    : `${uiHost()}/replay/${sessionId}`;
  return Number.isFinite(offsetMs) && offsetMs > 0 ? `${base}?t=${Math.floor(offsetMs / 1000)}` : base;
}

// Admin view of a ticket's replay. Never sent to the ticket's owner.
function serializeReplay(replay) {
  if (!replay) return null;
  const earlier = replay.earlier ?? { status: 'pending', sessions: [] };
  // A lookup still "pending" minutes later died with the process that ran
  // it. Say it failed rather than leave a spinner up for ever.
  const stale = earlier.status === 'pending' && replay.capturedAt
    && Date.now() - new Date(replay.capturedAt).getTime() > 2 * 60 * 1000;
  return {
    recording:  Boolean(replay.recording),
    url:        replay.recording ? replayUrl(replay.sessionId, replay.offsetMs) : null,
    capturedAt: replay.capturedAt ?? null,
    earlier: {
      status:   stale ? 'failed' : (earlier.status ?? 'pending'),
      sessions: (earlier.sessions ?? []).map(s => ({
        sessionId:     s.sessionId,
        url:           replayUrl(s.sessionId),
        startedAt:     s.startedAt ?? null,
        durationSec:   s.durationSec ?? null,
        pages:         s.pages ?? [],
        matchesReport: Boolean(s.matchesReport),
      })),
    },
  };
}

const normalisePath = (p) => {
  const s = String(p ?? '').split(/[?#]/)[0].replace(/\/+$/, '');
  return s || '/';
};

// The user's sessions with pageviews, newest first. Keyed on the person
// rather than one distinct id, so the pageviews a session made before login
// (identify() merges them into the person) still count.
const EARLIER_QUERY = `
  SELECT
    \`$session_id\` AS sid,
    min(timestamp) AS started,
    max(timestamp) AS ended,
    groupUniqArray(properties.$pathname) AS paths
  FROM events
  WHERE event = '$pageview'
    AND timestamp > now() - INTERVAL ${EARLIER_DAYS} DAY
    AND notEmpty(\`$session_id\`)
    AND person_id IN (SELECT person_id FROM person_distinct_ids WHERE distinct_id = {uid})
  GROUP BY sid
  ORDER BY started DESC
  LIMIT ${EARLIER_LIMIT + 1}
`;

/**
 * Ask PostHog for the user's recent sessions. Pure apart from the fetch, which
 * is injectable for tests. Returns { status, sessions }.
 */
async function fetchEarlierSessions({ userId, excludeSessionId = null, reportedPath = null, fetchImpl = globalThis.fetch }) {
  const key = (process.env.POSTHOG_PERSONAL_API_KEY || '').trim();
  const project = projectId();
  if (!key || !project || typeof fetchImpl !== 'function') return { status: 'unconfigured', sessions: [] };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${uiHost()}/api/projects/${encodeURIComponent(project)}/query/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: { kind: 'HogQLQuery', query: EARLIER_QUERY, values: { uid: String(userId) } },
      }),
      signal: controller.signal,
    });
    if (!res.ok) return { status: 'failed', sessions: [] };
    const data = await res.json();
    const target = reportedPath ? normalisePath(reportedPath) : null;
    const sessions = (data?.results ?? [])
      .filter(row => Array.isArray(row) && typeof row[0] === 'string' && SESSION_ID_RE.test(row[0]))
      .filter(row => !excludeSessionId || row[0].toLowerCase() !== excludeSessionId)
      .map(([sid, started, ended, paths]) => {
        const list = Array.isArray(paths) ? paths.filter(p => typeof p === 'string') : [];
        const startedAt = started ? new Date(started) : null;
        const endedAt = ended ? new Date(ended) : null;
        return {
          sessionId: sid.toLowerCase(),
          startedAt: startedAt && !isNaN(startedAt) ? startedAt : null,
          durationSec: startedAt && endedAt && !isNaN(startedAt) && !isNaN(endedAt)
            ? Math.max(0, Math.round((endedAt - startedAt) / 1000))
            : null,
          // Labels, never the raw paths: the same rule the report's own
          // routeTrail follows, so the ticket never becomes a list of which
          // briefs someone read. The admin sees the real URLs in PostHog.
          pages: [...new Set(list.map(locationLabel).filter(Boolean))].slice(0, 12),
          matchesReport: Boolean(target) && list.some(p => normalisePath(p) === target),
        };
      });
    // The ones that visited the reported page first, newest first within each.
    sessions.sort((a, b) => (Number(b.matchesReport) - Number(a.matchesReport))
      || ((b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0)));
    return { status: 'ready', sessions: sessions.slice(0, EARLIER_LIMIT) };
  } catch {
    return { status: 'failed', sessions: [] };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Store a ticket's replay and look up the earlier sessions in the background.
 * Never throws and never delays the caller: the report has been filed either
 * way, and the card fills in when the lookup lands.
 */
async function attachReplay(conversationId, rawReplay, { userId, reportedPath = null } = {}) {
  const replay = sanitiseReplay(rawReplay);
  if (!replay) return null;
  try {
    await ChatConversation.updateOne({ _id: conversationId }, { $set: { replay } });
  } catch {
    return null;
  }
  setImmediate(async () => {
    try {
      const earlier = await fetchEarlierSessions({
        userId, excludeSessionId: replay.sessionId, reportedPath,
      });
      await ChatConversation.updateOne(
        { _id: conversationId, replay: { $ne: null } },
        { $set: {
          'replay.earlier.status':    earlier.status,
          'replay.earlier.fetchedAt': new Date(),
          'replay.earlier.sessions':  earlier.sessions,
        } },
      );
    } catch { /* the card says it couldn't load */ }
  });
  return replay;
}

module.exports = {
  SESSION_ID_RE, sanitiseReplay, replayUrl, serializeReplay, fetchEarlierSessions, attachReplay,
};
