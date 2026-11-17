'use strict';

/**
 * The one place a questionnaire invitation is actually sent.
 *
 * Two callers, doing the same thing:
 *   - POST /api/admin/cbat-passers/send  (the "Send bulk email" button)
 *   - utils/surveyAutoSend.js            (the every-two-days auto-send, when switched on)
 *
 * They share this so the automatic send can never drift from what the button
 * does: same invite rows, same token reuse, same "never mail anyone twice" rule.
 */

const SurveyInvite = require('../models/SurveyInvite');
const { sendSurveyBatch } = require('./surveyEmail');
const {
  SURVEY_CAMPAIGN,
  DEFAULT_MIN_COMPLETIONS,
  DEFAULT_DORMANT_DAYS,
} = require('../constants/survey');

// The thresholds saved with "Save as defaults"; 0/absent falls back to the constants.
function savedThresholds(settings) {
  return {
    minCompletions: settings?.cbatSurveyMinCompletions || DEFAULT_MIN_COMPLETIONS,
    dormantDays:    settings?.cbatSurveyDormantDays    || DEFAULT_DORMANT_DAYS,
  };
}

// `chosen` is a list of cohort rows (each with _id and email). Returns what was
// sent and what failed; `recipientCount` is how many survived the invite step
// (0 means every chosen account had already been contacted).
async function inviteAndSend(chosen, { variant, logMeta } = {}) {
  // Invite rows first: a token has to exist before it can be put in an email.
  //
  // An existing invite is REUSED rather than replaced when it is mailable —
  // a failed send, or someone who said "not yet" and whose date has now come
  // round. Keeping the same row (and the same token) means their earlier
  // answers stay attached to the questionnaire and the link from the first
  // email still works, which matters because people keep old mail.
  //
  // The unique (userId, campaign) index is still what makes a double-clicked
  // button (or a button press racing the auto-send) harmless: a racing second
  // insert collides and that user is dropped from the send rather than mailed twice.
  const recipients = [];
  for (const candidate of chosen) {
    // eslint-disable-next-line no-await-in-loop
    let invite = await SurveyInvite.findOne({ userId: candidate._id, campaign: SURVEY_CAMPAIGN });

    if (invite) {
      if (!SurveyInvite.isMailable(invite)) continue;
    } else {
      try {
        // eslint-disable-next-line no-await-in-loop
        invite = await SurveyInvite.create({
          userId: candidate._id,
          campaign: SURVEY_CAMPAIGN,
          token: SurveyInvite.newToken(),
          sentToEmail: candidate.email,
        });
      } catch (err) {
        if (err?.code === 11000) continue; // raced — someone else just invited them
        throw err;
      }
    }
    recipients.push({ invite, token: invite.token, user: candidate });
  }

  if (!recipients.length) return { sent: [], failed: [], recipientCount: 0 };

  const { sent, failed } = await sendSurveyBatch(
    recipients.map(r => ({ user: r.user, token: r.token })),
    { variant, logMeta },
  );

  const sentIds   = new Set(sent.map(s => s.userId.toString()));
  const failedMap = new Map(failed.map(f => [f.userId.toString(), f.error]));
  const now = new Date();

  await Promise.all(recipients.map(r => {
    const id = r.user._id.toString();
    // A successful send clears any deferral: the wait has been served, and
    // this IS the follow-up it was waiting for. If they say "not yet" again,
    // the questionnaire sets a fresh one.
    return SurveyInvite.updateOne(
      { _id: r.invite._id },
      sentIds.has(id)
        // brokenLinkAt is cleared here and only here: the debt is settled by an
        // email that actually went out, not by an admin ticking something.
        ? { $set: { sentAt: now, sendError: null, deferredUntil: null, brokenLinkAt: null, sentToEmail: r.user.email }, $inc: { sendCount: 1 } }
        : { $set: { sentAt: r.invite.sentAt ?? null, sendError: failedMap.get(id) ?? 'unknown send failure' } },
    );
  }));

  return { sent, failed, recipientCount: recipients.length };
}

module.exports = { inviteAndSend, savedThresholds };
