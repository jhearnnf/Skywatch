'use strict';

/**
 * Auto-send for the CBAT outcome questionnaire.
 *
 * When an admin switches it on (Admin › Content › Potential CBAT Passers
 * Survey), the backend does exactly what pressing "Send bulk email" on a freshly
 * loaded panel does: saved thresholds, the next batch the list would pre-tick,
 * the default email. At most once every SURVEY_AUTO_SEND_INTERVAL_HOURS.
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
const {
  BATCH_SIZE,
  SURVEY_AUTO_SEND_INTERVAL_HOURS,
  SURVEY_AUTO_SEND_CHECK_MINUTES,
} = require('../constants/survey');

const HOUR_MS = 60 * 60 * 1000;
const INTERVAL_MS = SURVEY_AUTO_SEND_INTERVAL_HOURS * HOUR_MS;

// When the next automatic send is due, for the admin panel. Null when off, or
// when on but never run (it then goes at the next check).
function nextAutoSendAt(settings) {
  if (!settings?.cbatSurveyAutoSendEnabled) return null;
  const last = settings.cbatSurveyAutoSendLastAt;
  return last ? new Date(new Date(last).getTime() + INTERVAL_MS) : null;
}

// One check. Returns { skipped } when nothing was attempted, or the stored result.
async function runSurveyAutoSend({ now = new Date() } = {}) {
  if (clientUrlProblem({ strict: true })) return { skipped: 'link' };

  const current = await AppSettings.getSettings();
  if (!current.cbatSurveyAutoSendEnabled) return { skipped: 'off' };
  if (current.cbatSurveyEnabled === false) return { skipped: 'closed' };

  const claimed = await AppSettings.findOneAndUpdate(
    {
      _id: current._id,
      cbatSurveyAutoSendEnabled: true,
      $or: [
        { cbatSurveyAutoSendLastAt: null },
        { cbatSurveyAutoSendLastAt: { $lte: new Date(now.getTime() - INTERVAL_MS) } },
      ],
    },
    { $set: { cbatSurveyAutoSendLastAt: now } },
    { returnDocument: 'after' },
  );
  if (!claimed) return { skipped: 'not-due' };

  const result = { at: now, sentCount: 0, failedCount: 0, sent: [], failed: [], error: null };
  try {
    const cohort = await buildCbatPasserCohort(savedThresholds(claimed));
    const chosen = selectNextBatch(cohort, BATCH_SIZE);
    if (chosen.length) {
      const { sent, failed } = await inviteAndSend(chosen, { variant: resolveVariant() });
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

module.exports = { runSurveyAutoSend, startSurveyAutoSend, nextAutoSendAt };
