// Records browser origins that aren't on the CORS allowlist.
//
// Why this exists: a frontend served from a host the backend doesn't know about
// (the real case: www.skywatch.academy alongside the apex) produces a site that
// looks completely normal and silently does nothing. Every API call fails at the
// CORS layer, which the browser reports to JS as an opaque network error rather
// than an HTTP status — so the app can't tell it apart from being offline, keeps
// the user signed in from cache, and quietly queues everything forever.
//
// The server, however, sees every one of those requests. Logging them here turns
// a failure that is invisible on both sides into one row in the admin log panel.
//
// Deliberately NOT sent back to the browser: we can't attach CORS headers to a
// response for a disallowed origin without defeating the point of the allowlist,
// so the browser will never be able to read the 403. Server-side is the only
// place this can be observed, which is exactly why it's recorded here.

const SystemLog = require('../models/SystemLog');

// 'YYYY-MM-DD' in UTC — the aggregation bucket. One row per origin per day keeps
// a misconfigured domain from writing thousands of identical rows.
const dayKeyFor = (d = new Date()) => d.toISOString().slice(0, 10);

// Fire-and-forget. Never awaited by request handling and never throws: a logging
// failure must not turn into a second failure on top of the one being logged.
function recordRejectedOrigin(origin, req) {
  const now = new Date();
  const dayKey = dayKeyFor(now);

  SystemLog.findOneAndUpdate(
    { type: 'cors_origin_rejected', origin, dayKey },
    {
      $inc: { hitCount: 1 },
      $set: {
        lastSeenAt:  now,
        requestPath: req?.originalUrl ?? '',
        userAgent:   (req?.headers?.['user-agent'] ?? '').slice(0, 300),
        // Keep the most recent referer we saw for this origin/day. Empty for a
        // direct visit (nothing linked to it); populated when a page did.
        referer:     (req?.headers?.referer ?? req?.headers?.referrer ?? '').slice(0, 300),
      },
      $setOnInsert: {
        type: 'cors_origin_rejected',
        origin,
        dayKey,
        firstSeenAt: now,
        time: now,
        failureReason: `Origin ${origin} is not on the CORS allowlist`,
      },
    },
    { upsert: true },
  ).catch(() => { /* logging must never break the request */ });
}

module.exports = { recordRejectedOrigin, dayKeyFor };
