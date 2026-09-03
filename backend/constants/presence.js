// How recently an account must have sent a heartbeat to count as online.
//
// Shared rather than repeated, because two places now render "who/how many are
// online" for admins — the Users Online tile on the dashboard and the presence
// strip in the community rail — and an admin reading "4 online" in one and a
// three-name list in the other would be looking at a bug that isn't there.
//
// The floor is set by the client: src/hooks/useHeartbeat.js beats every 30s and
// goes quiet after 5 minutes without input, so anything under ~6 minutes would
// drop people who are reading a page without touching the mouse. Ten leaves room
// for a missed beat on a bad connection.
const PRESENCE_WINDOW_MS = 10 * 60 * 1000;

// Presence is a glance, not a directory: past a certain length the list stops
// being readable and the count carries the information on its own. The count
// reported alongside it is always the true total, capped or not.
const PRESENCE_LIST_LIMIT = 50;

// The tighter window behind the presence dots on the CBAT hub (see
// `cbatCard` in GET /api/chat/presence).
//
// Deliberately far shorter than PRESENCE_WINDOW_MS, because the two answer
// different questions. The strip says "who is around", and being forgiving
// there is right: someone who shut the lid four minutes ago is still worth
// listing. A dot sitting on the Target card is a claim about *now* — that
// someone is on that page as you look at it — and ten minutes of slack would
// leave dots parked on games nobody is playing.
//
// Three minutes is six of the client's 30s beats, so a couple of dropped
// requests on a phone connection still keeps a live player's dot alight.
const PRESENCE_HERE_WINDOW_MS = 3 * 60 * 1000;

module.exports = { PRESENCE_WINDOW_MS, PRESENCE_LIST_LIMIT, PRESENCE_HERE_WINDOW_MS };
