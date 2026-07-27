// Timezone every "which day did this happen on" bucket is keyed by. The audience
// is UK-based, so a day has to mean the day they experienced — a UTC grid pushes
// anything logged after 23:00 BST into tomorrow's column, which reads as a
// tester having skipped a day they did not skip.
//
// Shared rather than per-module because two different things now key days this
// way — the reports charts bucket events at read time, and app-open records are
// stored pre-bucketed at write time — and they have to agree exactly or a day's
// app opens land in a column its games do not.
const ACTIVITY_TZ = 'Europe/London';

// Format a Date as YYYY-MM-DD in a given IANA timezone (en-CA yields ISO order).
function ymdInTz(date, tz = ACTIVITY_TZ) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(date));
}

module.exports = { ACTIVITY_TZ, ymdInTz };
