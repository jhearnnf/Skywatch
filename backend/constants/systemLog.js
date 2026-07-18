const LOG_TYPES = [
  'priority_ranking_failure',
  'brief_generation_failure',
  'image_fetch_failure',
  'bulk_generation_warnings',
  'duplicate_leads_detected',
  'quiz_finish_failure',
  'quiz_result_persist_failure',
  'account_creation_failure',
  // A browser origin that isn't on the CORS allowlist tried to call the API.
  // Aggregated one row per origin per day. This is the tripwire for a frontend
  // being served from a host the backend doesn't know about (e.g. www vs apex),
  // which otherwise breaks the site completely and silently.
  'cors_origin_rejected',
  // A client reported that it couldn't reach the API at all while the browser
  // believed it was online. Queued on the device and uploaded once it recovers,
  // so it always arrives late — see the note in utils/rejectedOriginLog.js.
  'api_unreachable',
];

module.exports = { LOG_TYPES };
