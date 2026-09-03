const router = require('express').Router();
const { protect, adminOnly } = require('../middleware/auth');

const User           = require('../models/User');
const SurveyInvite   = require('../models/SurveyInvite');
const SurveyResponse = require('../models/SurveyResponse');
const AppSettings    = require('../models/AppSettings');

const { buildCbatPasserCohort, selectNextBatch } = require('../utils/cbatPasserCohort');
const { surveyEmailFields, renderSurveyEmail, sendSurveyBatch, surveyUrl, displayNameFor } = require('../utils/surveyEmail');
const {
  SURVEY_CAMPAIGN,
  SURVEY_TEST_CAMPAIGN,
  DEFAULT_MIN_COMPLETIONS,
  DEFAULT_DORMANT_DAYS,
  BATCH_SIZE,
} = require('../constants/survey');

router.use(protect, adminOnly);

// Thresholds come from AppSettings when set, the query string when an admin is
// experimenting with the sliders, and constants/survey.js otherwise. Query wins
// so the list can be re-cut without saving anything.
async function resolveThresholds(query = {}) {
  const s = await AppSettings.getSettings();
  const fromQuery = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  return {
    minCompletions: fromQuery(query.minCompletions)
      ?? (s.cbatSurveyMinCompletions || DEFAULT_MIN_COMPLETIONS),
    dormantDays: fromQuery(query.dormantDays)
      ?? (s.cbatSurveyDormantDays || DEFAULT_DORMANT_DAYS),
  };
}

// GET /api/admin/cbat-passers — the recipient list, grouped by the day of each
// candidate's last completed CBAT run.
router.get('/', async (req, res) => {
  try {
    const { minCompletions, dormantDays } = await resolveThresholds(req.query);
    const cohort = await buildCbatPasserCohort({ minCompletions, dormantDays });
    const nextBatch = selectNextBatch(cohort, BATCH_SIZE);

    res.json({
      status: 'success',
      data: {
        ...cohort,
        batchSize: BATCH_SIZE,
        // Ids only — the rows themselves are already in `groups`, and the admin
        // list highlights these rather than rendering a second copy.
        nextBatchIds: nextBatch.map(u => u._id),
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/cbat-passers/preview — the exact email a real recipient would
// receive, rendered with a real (or, if none has been issued yet, a clearly
// fake) token. Nothing is created or sent here.
router.get('/preview', async (req, res) => {
  try {
    let user = null;

    if (req.query.userId) {
      user = await User.findById(req.query.userId).select('email displayName agentNumber').lean();
    } else {
      const { minCompletions, dormantDays } = await resolveThresholds(req.query);
      const cohort = await buildCbatPasserCohort({ minCompletions, dormantDays });
      user = selectNextBatch(cohort, 1)[0] ?? null;
    }

    // With an empty cohort there is still a template worth looking at, so fall
    // back to a stand-in rather than returning nothing.
    if (!user) {
      user = { _id: null, email: 'agent@example.com', displayName: null, agentNumber: '1234567' };
    }

    const existing = user._id
      ? await SurveyInvite.findOne({ userId: user._id, campaign: SURVEY_CAMPAIGN }).lean()
      : null;

    // A placeholder token is fine here: this endpoint renders, it never sends,
    // and issuing a real token for a preview would leave an invite row behind
    // that quietly excluded the person from the next batch.
    const token = existing?.token ?? 'preview-token-not-a-real-link';
    const fields = await surveyEmailFields();
    const { subject, html } = renderSurveyEmail({ fields, user, token });

    res.json({
      status: 'success',
      data: {
        subject,
        html,
        fields,
        recipient: user._id
          ? { _id: user._id, email: user.email, name: displayNameFor(user) }
          : null,
        isPlaceholder: !user._id,
        link: surveyUrl(token),
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/admin/cbat-passers/send — mail the next batch.
//
// The ONLY path in the codebase that sends a questionnaire email, and it runs
// only when an admin presses the button. Body may carry `userIds` to send to a
// hand-picked set (which is how a 'warm' band candidate gets included), or
// nothing at all to take the next `limit` from the ready band.
router.post('/send', async (req, res) => {
  try {
    const limit = Math.min(Number(req.body?.limit) || BATCH_SIZE, BATCH_SIZE);
    const { minCompletions, dormantDays } = await resolveThresholds(req.body ?? {});
    const cohort = await buildCbatPasserCohort({ minCompletions, dormantDays });

    let chosen;
    if (Array.isArray(req.body?.userIds) && req.body.userIds.length) {
      // Hand-picked. Still constrained to the cohort, so a stale page cannot
      // mail someone who has since opted out or already been invited.
      const wanted = new Set(req.body.userIds.map(String));
      chosen = cohort.groups
        .flatMap(g => g.users)
        .filter(u => wanted.has(u._id.toString()) && u.mailable)
        .slice(0, limit);
    } else {
      chosen = selectNextBatch(cohort, limit);
    }

    if (!chosen.length) {
      return res.status(400).json({ message: 'No eligible recipients — everyone in the ready band has already been emailed, or is waiting on a test date they gave us.' });
    }

    // Invite rows first: a token has to exist before it can be put in an email.
    //
    // An existing invite is REUSED rather than replaced when it is mailable —
    // a failed send, or someone who said "not yet" and whose date has now come
    // round. Keeping the same row (and the same token) means their earlier
    // answers stay attached to the questionnaire and the link from the first
    // email still works, which matters because people keep old mail.
    //
    // The unique (userId, campaign) index is still what makes a double-clicked
    // button harmless: a racing second insert collides and that user is dropped
    // from the send rather than mailed twice.
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

    if (!recipients.length) {
      return res.status(400).json({ message: 'Every chosen account has already been contacted for this questionnaire.' });
    }

    const { sent, failed } = await sendSurveyBatch(
      recipients.map(r => ({ user: r.user, token: r.token })),
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
          ? { $set: { sentAt: now, sendError: null, deferredUntil: null, sentToEmail: r.user.email }, $inc: { sendCount: 1 } }
          : { $set: { sentAt: r.invite.sentAt ?? null, sendError: failedMap.get(id) ?? 'unknown send failure' } },
      );
    }));

    res.json({
      status: 'success',
      data: {
        sent:   sent.map(s => s.email),
        failed: failed.map(f => ({ email: f.email, error: f.error })),
        sentCount:   sent.length,
        failedCount: failed.length,
      },
    });
  } catch (err) {
    res.status(502).json({ message: `Send failed: ${err.message}` });
  }
});

// POST /api/admin/cbat-passers/test — mail yourself the real thing.
//
// The only way to check the whole chain (the email as it arrives, the link
// opening in a browser, the questionnaire, the badge, the donation ask) without
// spending a real invitation on a real person. The preview endpoint renders the
// email but cannot show you how it survives an inbox.
//
// It sends the SAME email built by the SAME code as a live send. What makes it
// safe is the campaign key and the isTest flag, not a different code path:
//   • SURVEY_TEST_CAMPAIGN keeps it out of the cohort, the ticked-off list,
//     the response summary and the funnel, all of which filter on the real key.
//   • isTest stops the questionnaire writing to the account, so answering "yes
//     I passed" or hitting unsubscribe during a dry run changes nothing.
//
// Repeatable on purpose: each press clears the previous test invite and its
// answers, so the flow can be walked as many times as it takes.
router.post('/test', async (req, res) => {
  try {
    const to = (req.body?.email ?? '').toString().trim() || req.user.email;
    if (!to) return res.status(400).json({ message: 'No address to send to.' });

    const previous = await SurveyInvite.findOne({ userId: req.user._id, campaign: SURVEY_TEST_CAMPAIGN });
    if (previous) {
      await SurveyResponse.deleteOne({ inviteId: previous._id });
      await SurveyInvite.deleteOne({ _id: previous._id });
    }

    const invite = await SurveyInvite.create({
      userId: req.user._id,
      campaign: SURVEY_TEST_CAMPAIGN,
      token: SurveyInvite.newToken(),
      sentToEmail: to,
      isTest: true,
    });

    const { sent, failed } = await sendSurveyBatch([
      { user: { ...req.user.toObject?.() ?? req.user, email: to }, token: invite.token },
    ]);

    if (failed.length) {
      await SurveyInvite.updateOne({ _id: invite._id }, { sendError: failed[0].error });
      return res.status(502).json({ message: `Test email failed: ${failed[0].error}` });
    }

    await SurveyInvite.updateOne({ _id: invite._id }, { sentAt: new Date(), $inc: { sendCount: 1 } });
    res.json({ status: 'success', data: { sentTo: sent[0]?.email ?? to, link: surveyUrl(invite.token) } });
  } catch (err) {
    res.status(502).json({ message: `Test email failed: ${err.message}` });
  }
});

// DELETE /api/admin/cbat-passers/invite/:userId — clear a failed invitation so
// the account returns to the pool. Only ever removes a row that never went out;
// deleting a delivered invite would let us mail the same person twice.
router.delete('/invite/:userId', async (req, res) => {
  try {
    const result = await SurveyInvite.deleteOne({
      userId: req.params.userId,
      campaign: SURVEY_CAMPAIGN,
      sentAt: null,
    });
    if (!result.deletedCount) {
      return res.status(400).json({ message: 'No unsent invitation for that account. A delivered invite cannot be cleared.' });
    }
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/cbat-passers/responses — every answer, plus the aggregates
// worth reading at a glance.
router.get('/responses', async (_req, res) => {
  try {
    const responses = await SurveyResponse.find({ campaign: SURVEY_CAMPAIGN })
      .sort({ updatedAt: -1 })
      .populate('userId', 'agentNumber displayName email cbatPassed')
      .lean();

    const answered = (v) => v !== null && v !== undefined;
    const mean = (nums) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null);

    const sat        = responses.filter(r => r.satTest === true);
    const notYet     = responses.filter(r => r.satTest === false);
    const passed     = sat.filter(r => r.passedForRole === 'yes');
    const failed     = sat.filter(r => r.passedForRole === 'no');
    const waiting    = sat.filter(r => r.passedForRole === 'waiting');
    const realism    = responses.map(r => r.realismRating).filter(answered);
    const helped     = responses.map(r => r.helpedRating).filter(answered);

    // Role tallies, most answered first.
    const roleCounts = {};
    for (const r of responses) {
      if (!r.role) continue;
      const key = r.role === 'other' ? `other:${r.roleOther || 'unspecified'}` : r.role;
      roleCounts[key] = (roleCounts[key] ?? 0) + 1;
    }

    const invites = await SurveyInvite.countDocuments({ campaign: SURVEY_CAMPAIGN, sentAt: { $ne: null } });
    const optOuts = await SurveyInvite.countDocuments({ campaign: SURVEY_CAMPAIGN, optedOutAt: { $ne: null } });

    res.json({
      status: 'success',
      data: {
        responses,
        summary: {
          invitesSent: invites,
          started:     responses.length,
          completed:   responses.filter(r => r.completedAt).length,
          optOuts,
          satTest:     sat.length,
          notYet:      notYet.length,
          passed:      passed.length,
          failed:      failed.length,
          waiting:     waiting.length,
          avgRealism:  mean(realism),
          avgHelped:   mean(helped),
          donationClicks: responses.filter(r => r.donationClicked).length,
          roleCounts,
          // The free-text answers are the point of the whole exercise, so they
          // are surfaced in the summary rather than left to be dug out of rows.
          gaps: responses.filter(r => r.gaps?.trim()).map(r => ({
            gaps: r.gaps,
            role: r.role,
            agentNumber: r.userId?.agentNumber ?? null,
          })),
        },
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
