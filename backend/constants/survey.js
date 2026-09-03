'use strict';

/**
 * The CBAT outcome questionnaire — shared constants.
 *
 * The campaign asks people who look like they have finished with SkyWatch (and
 * therefore probably sat their real CBAT) what actually happened: which role,
 * did they pass, how close our practice tests were to the real battery, and
 * whether we helped. It ends on a donation ask.
 *
 * NOTHING HERE SENDS ANYTHING. Every send is an explicit admin button press —
 * see routes/adminSurvey.js. There is no cron, no queue and no auto-send on any
 * schedule, deliberately: the whole point of the list is that an admin can come
 * back in a fortnight, see who has already been mailed ticked off, and choose
 * the next batch by hand.
 */

// One campaign for now. Stored on every invite and response so a second
// campaign later can coexist with this one's data rather than replacing it.
const SURVEY_CAMPAIGN = 'cbat_outcome_2026';

// Dry runs live under their own campaign key, which is what keeps them out of
// everything: the cohort, the "already emailed" ticks, the response summary and
// the donation funnel all filter on SURVEY_CAMPAIGN, so a test invite is
// invisible to them without a single extra condition anywhere.
const SURVEY_TEST_CAMPAIGN = 'cbat_outcome_test';

// ── Cohort thresholds ────────────────────────────────────────────────────────
// Both are admin-editable (AppSettings.cbatSurveyMinCompletions /
// cbatSurveyDormantDays); these are the fallbacks.

// Completed runs required before someone counts as having really used SkyWatch.
// A *completed* run is a row in one of the CBAT result collections. Opening a
// game and quitting writes a GameSessionCbatStart and no result, so abandoned
// sessions are excluded by construction rather than by a heuristic.
const DEFAULT_MIN_COMPLETIONS = 10;

// Days of CBAT silence before we treat someone as finished with the site.
//
// 21 rather than 14 because the two errors are not symmetrical. Mailing someone
// who has not sat the test yet burns a one-shot contact for nothing; mailing
// someone a week later than ideal costs almost nothing. 14 days is also exactly
// the length of the things that are NOT a CBAT — a holiday, a half-term, an
// exam block — and 21 clears most of them. Getting it wrong early is recoverable
// anyway: a "not yet" answer defers them rather than spending the contact.
const DEFAULT_DORMANT_DAYS = 21;

// Candidates between this and the dormancy threshold are shown in the admin list
// but never included in a bulk send: recently quiet, plausibly just on a break.
// An admin can still mail one individually if they recognise the name.
//
// This is a floor on the LIST, not a hard minimum: an admin who sets the
// dormancy threshold below it is deliberately asking for those people, so the
// floor drops to whichever of the two is lower. See buildCbatPasserCohort.
const WARM_BAND_DAYS = 14;

// Emails per send. Resend's batch endpoint takes up to 100; 50 keeps a single
// mistake small and matches the size an admin can actually eyeball first.
const BATCH_SIZE = 50;

// ── Deferral, for people who have not sat the test yet ───────────────────────
//
// Answering "not yet" is useful information, not a dead end. Those accounts are
// held back rather than struck off: the invite is stamped with a date before
// which they must not be contacted again, and once it passes they return to the
// list as ordinary candidates. This is what makes an early send recoverable —
// mistiming the dormancy threshold costs a deferral, not a burnt contact.

// When they tell us the date, wait this long past it before asking again. A
// week is enough for the result to have landed without the memory fading.
const BOOKED_GRACE_DAYS = 7;

// When they do not know the date yet. Long enough not to nag, short enough that
// someone who books the following month is not lost for half a year.
const DEFAULT_DEFER_DAYS = 60;

// Guards the date they type. A test in the past is a typo (or the wrong answer
// to the previous question), and one three years out is a slip of the year.
const MAX_BOOKING_MONTHS_AHEAD = 36;

// ── Exclusions ───────────────────────────────────────────────────────────────
// Accounts that must never appear in the cohort, regardless of their stats.
// Matched case-insensitively. Bots (isBot), admins (isAdmin), banned accounts
// and anyone who has opted out are excluded by the query itself and are NOT
// listed here — this is only for real accounts we know personally.
//
// Testers are deliberately NOT excluded: several people who tested the Android
// app were genuine CBAT candidates, and they are exactly who this asks about.

const EXCLUDED_EMAILS = [
  'osmightymanos@hotmail.co.uk',      // account owner
  'jameshearn1995@hotmail.co.uk',     // account owner (second account)
  'jo.knight324@icloud.com',
  'simperson125@gmail.com',
  'gavinhearn1978@gmail.com',
  'support.akhand.apps@gmail.com',
  'shepyzommor@gmail.com',
  'andreaspaschalis@gmail.com',
  'karatekiddnb@gmail.com',
];

// Matched against displayName. These accounts are known to us by name rather
// than by the address they signed up with.
const EXCLUDED_DISPLAY_NAMES = [
  'Bethanemery0',
  'Bobbert',
  'Owen',
  'Ede',
  'KEZZA',
  'Ashley M',
  'roscoche',
];

const excludedEmailSet = new Set(EXCLUDED_EMAILS.map(e => e.toLowerCase()));
const excludedNameSet  = new Set(EXCLUDED_DISPLAY_NAMES.map(n => n.toLowerCase()));

// `user` may be a lean object or a hydrated doc — only reads plain fields.
function isExcludedAccount(user) {
  if (!user) return true;
  if (user.isAdmin || user.isBot || user.isBanned) return true;
  if (user.researchEmailOptOut?.at) return true;
  if (!user.email) return true;
  if (excludedEmailSet.has(String(user.email).toLowerCase())) return true;
  const name = user.displayName ? String(user.displayName).trim().toLowerCase() : '';
  if (name && excludedNameSet.has(name)) return true;
  return false;
}

// ── Answer vocabularies ──────────────────────────────────────────────────────
// Stored verbatim on SurveyResponse, so these strings are permanent.

const PASS_ANSWERS = ['yes', 'no', 'waiting'];

// 1–5, low to high. Kept as numbers so the admin summary can average them.
const RATING_MIN = 1;
const RATING_MAX = 5;

const OPT_OUT_REASONS = [
  'too_many_emails',
  'not_relevant',
  'finished_with_skywatch',
  'never_signed_up',
  'other',
];

module.exports = {
  SURVEY_CAMPAIGN,
  SURVEY_TEST_CAMPAIGN,
  BOOKED_GRACE_DAYS,
  DEFAULT_DEFER_DAYS,
  MAX_BOOKING_MONTHS_AHEAD,
  DEFAULT_MIN_COMPLETIONS,
  DEFAULT_DORMANT_DAYS,
  WARM_BAND_DAYS,
  BATCH_SIZE,
  EXCLUDED_EMAILS,
  EXCLUDED_DISPLAY_NAMES,
  isExcludedAccount,
  PASS_ANSWERS,
  RATING_MIN,
  RATING_MAX,
  OPT_OUT_REASONS,
};
