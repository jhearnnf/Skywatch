// The context that comes with a request for help: where the person had just
// been, which build they were running and what device they were on. One
// builder for both ways in — "Report a problem" (routes/users.js) and
// "Message the team" (routes/chat.js) — so the admin gets the same evidence
// from either, and a new field only ever has to be added here.
//
// Everything arrives straight off the wire and ends up rendered in the admin
// panel, so each part goes through the sanitiser that already guards it.

const { locationLabel } = require('../constants/presenceLocations');
const { sanitiseClientInfo } = require('../constants/clientPlatforms');
const { sanitiseReportEnvironment } = require('./reportEnvironment');

// How many pages of context may be stored. The client sends five; this is the
// cap on what an arbitrary caller can make us keep.
const ROUTE_TRAIL_MAX = 5;

// `routeTrail` and `pageReported` arrive as raw pathnames and are stored as
// labels, never verbatim: locationLabel() drops the query string and maps
// /brief/:id and friends to a description of the page. An unrecognised path
// yields null and is dropped rather than kept as the raw string.
function sanitiseReportContext(body, userAgentHeader) {
  const raw = body && typeof body === 'object' ? body : {};
  const routeTrail = Array.isArray(raw.routeTrail)
    ? raw.routeTrail.slice(-ROUTE_TRAIL_MAX).map(locationLabel).filter(Boolean)
    : [];
  // Best-effort, like the heartbeat's: a client that cannot name its build
  // must still be able to ask for help.
  const client = sanitiseClientInfo(raw.client);
  // The User-Agent header is taken from the request, not the payload, so even
  // a bundle that predates the collector says which OS and browser it is.
  const environment = sanitiseReportEnvironment(raw.environment, userAgentHeader);
  return {
    pageReported:   typeof raw.pageReported === 'string' ? (locationLabel(raw.pageReported) || null) : null,
    routeTrail,
    clientPlatform: client?.platform ?? null,
    clientVersion:  client?.version ?? null,
    clientBuild:    client?.build ?? null,
    ...(environment ? { environment } : {}),
  };
}

module.exports = { sanitiseReportContext, ROUTE_TRAIL_MAX };
