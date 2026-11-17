'use strict';

/**
 * Auto-send for the CBAT outcome questionnaire.
 *
 * When an admin switches it on (Admin › Content › Potential CBAT Passers
 * Survey), the backend does exactly what pressing "Send bulk email" on a freshly
 * loaded panel does: saved thresholds, the next batch the list would pre-tick,
 * the default email. Every SURVEY_AUTO_SEND_INTERVAL_HOURS (calendar days, UK
 * time), at a fixed UK hour that rotates through SURVEY_AUTO_SEND_HOURS_UK so
 * the send-time data stays comparable across slots.
 *
 * Runs inside the backend on a timer. There is no public endpoint, so nothing
 * outside can trigger a send.
 *
 * Safety, in the order it is checked:
 *   1. The links must point at the public https site, with the
 *      ALLOW_LOCAL_EMAIL_LINKS override IGNORED. A local backend talks to the
 *      production database, so without this a dev machine would mail real
 *      users dead localhost links (see the 2026-09-03 incident).
 *   2. The questionnaire must be open. Mailing links to a closed form is
 *      pointless.
 *   3. The run is CLAIMED atomically on the settings row (lastAt moves only if
 *      the switch is on and the interval has passed). A restart, an overlapping
 *      deploy or a second server cannot send the same run twice.
 *   4. The send itself goes through utils/surveySend.js, which never mails
 *      anyone who already has a delivered invite.
 */

const AppSettings = require('../models/AppSettings');
const { buildCbatPasserCohort, selectNextBatch } = require('./cbatPasserCohort');
const { clientUrlProblem, resolveVariant } = require('./surveyEmail');
const { inviteAndSend, savedThresholds } = require('./surveySend');
const { ACTIVITY_TZ, ymdInTz } = require('../constants/activity');
const {
  BATCH_SIZE,
  SURVEY_AUTO_SEND_INTERVAL_HOURS,
  SURVEY_AUTO_SEND_CHECK_MINUTES,
  SURVEY_AUTO_SEND_HOURS_UK,
  SURVEY_AUTO_SEND_GRACE_HOURS,
} = require('../constants/survey');

const HOUR_MS = 60 * 60 * 1000;
const INTERVAL_DAYS = Math.round(SURVEY_AUTO_SEND_INTERVAL_HOURS / 24);
const GRACE_MS = SURVEY_AUTO_SEND_GRACE_HOURS * HOUR_MS;

// The UTC instant of HH:00 on a UK calendar day (YYYY-MM-DD), BST-aware.
// Guess as if UTC, read back the UK wall clock at that instant, correct by the
// difference. Re-checked once so a guess landing across a clock change settles.
function ukWallClockToDate(ymd, hour) {
  const [y, m, d] = ymd.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d, hour);
  let t = target;
  for (let i = 0; i < 2; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: ACTIVITY_TZ, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(t)).map(x => [x.type, x.value]));
    const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    t += target - wall;
  }
  return new Date(t);
}

function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// The next scheduled run: which slot, which UK hour, and when.
//
// The day is INTERVAL_DAYS after the last run's UK calendar day (today, if it
// has never run); the hour is the slot after the last one used. A run missed by
// more than the grace window slides a day at a time rather than firing late,
// so a batch never goes out at an hour that would muddy the comparison.
function nextAutoSendSlot(settings, now = new Date()) {
  const n = SURVEY_AUTO_SEND_HOURS_UK.length;
  const prev = Number.isInteger(settings?.cbatSurveyAutoSendSlot) ? settings.cbatSurveyAutoSendSlot : -1;
  const slot = (((prev + 1) % n) + n) % n;
  const hour = SURVEY_AUTO_SEND_HOURS_UK[slot];
  const last = settings?.cbatSurveyAutoSendLastAt;
  let day = last ? addDays(ymdInTz(last), INTERVAL_DAYS) : ymdInTz(now);
  let at = ukWallClockToDate(day, hour);
  while (now.getTime() > at.getTime() + GRACE_MS) {
    day = addDays(day, 1);
    at = ukWallClockToDate(day, hour);
  }
  return { slot, hour, at };
}

// When the next automatic send is due, for the admin panel. Null when off.
function nextAutoSendAt(settings, now = new Date()) {
  if (!settings?.cbatSurveyAutoSendEnabled) return null;
  return nextAutoSendSlot(settings, now).at;
}

// One check. Returns { skipped } when nothing was attempted, or the stored result.
async function runSurveyAutoSend({ now = new Date() } = {}) {
  if (clientUrlProblem({ strict: true })) return { skipped: 'link' };

  const current = await AppSettings.getSettings();
  if (!current.cbatSurveyAutoSendEnabled) return { skipped: 'off' };
  if (current.cbatSurveyEnabled === false) return { skipped: 'closed' };

  const due = nextAutoSendSlot(current, now);
  if (now < due.at) return { skipped: 'not-due' };

  // Compare-and-set on the lastAt we just read: only one checker can move it,
  // so a restart, an overlapping deploy or a second server cannot send twice.
  const claimed = await AppSettings.findOneAndUpdate(
    {
      _id: current._id,
      cbatSurveyAutoSendEnabled: true,
      cbatSurveyAutoSendLastAt: current.cbatSurveyAutoSendLastAt ?? null,
    },
    { $set: { cbatSurveyAutoSendLastAt: now, cbatSurveyAutoSendSlot: due.slot } },
    { returnDocument: 'after' },
  );
  if (!claimed) return { skipped: 'not-due' };

  // slotHour is kept on the result so the panel (and anyone reading the row)
  // can see which rotation slot this batch was.
  const result = { at: now, slotHour: due.hour, sentCount: 0, failedCount: 0, sent: [], failed: [], error: null };
  try {
    const cohort = await buildCbatPasserCohort(savedThresholds(claimed));
    const chosen = selectNextBatch(cohort, BATCH_SIZE);
    if (chosen.length) {
      const { sent, failed } = await inviteAndSend(chosen, {
        variant: resolveVariant(),
        logMeta: { source: 'auto', slotHour: due.hour },
      });
      result.sent = sent.map(s => s.email);
      result.failed = failed.map(f => ({ email: f.email, error: f.error }));
      result.sentCount = sent.length;
      result.failedCount = failed.length;
    }
  } catch (err) {
    result.error = err.message;
  }

  await AppSettings.updateOne({ _id: claimed._id }, { $set: { cbatSurveyAutoSendLastResult: result } });
  if (result.sentCount || result.failedCount || result.error) {
    console.log(`[surveyAutoSend] sent ${result.sentCount}, failed ${result.failedCount}${result.error ? `, error: ${result.error}` : ''}`);
  }
  return result;
}

// Called once from server.js (never from app.js, so tests never start a timer).
function startSurveyAutoSend() {
  const tick = () => runSurveyAutoSend().catch(err => console.error('[surveyAutoSend]', err.message));
  // A short wait after boot so the first check does not compete with startup.
  setTimeout(tick, 60 * 1000).unref();
  setInterval(tick, SURVEY_AUTO_SEND_CHECK_MINUTES * 60 * 1000).unref();
}

module.exports = { runSurveyAutoSend, startSurveyAutoSend, nextAutoSendAt, nextAutoSendSlot, ukWallClockToDate };
