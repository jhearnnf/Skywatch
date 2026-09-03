const router = require('express').Router();

const { protect }    = require('../middleware/auth');
const User           = require('../models/User');
const AppSettings    = require('../models/AppSettings');
const SurveyInvite   = require('../models/SurveyInvite');
const SurveyResponse = require('../models/SurveyResponse');
const surveyRoles    = require('../constants/surveyRoles.json');
const {
  SURVEY_CAMPAIGN,
  SURVEY_TEST_CAMPAIGN,
  PASS_ANSWERS,
  RATING_MIN,
  RATING_MAX,
  OPT_OUT_REASONS,
  BOOKED_GRACE_DAYS,
  DEFAULT_DEFER_DAYS,
  MAX_BOOKING_MONTHS_AHEAD,
} = require('../constants/survey');

const DAY_MS = 24 * 60 * 60 * 1000;

// A booking date we are willing to believe. Rejects the past (a typo, or the
// wrong answer to the previous question) and anything absurdly far out (a
// mistyped year), returning null so the caller falls back to the default
// deferral rather than trusting a nonsense date it would then act on.
function parseBookingDate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (d < todayStart) return null;
  const ceiling = new Date(now);
  ceiling.setMonth(ceiling.getMonth() + MAX_BOOKING_MONTHS_AHEAD);
  if (d > ceiling) return null;
  return d;
}

// When may we contact this person again?
//
// A known date wins: wait a week past it, by which time they have their result
// and it is still fresh. Otherwise fall back to a fixed interval — "I have not
// booked it yet" is a real answer and still has to produce a date, or the
// deferral would be indefinite and they would never be asked again.
function deferralFor({ bookedFor, now = new Date() }) {
  if (bookedFor) return new Date(bookedFor.getTime() + BOOKED_GRACE_DAYS * DAY_MS);
  return new Date(now.getTime() + DEFAULT_DEFER_DAYS * DAY_MS);
}

/**
 * The public face of the CBAT outcome questionnaire.
 *
 * Authenticated by the invite token in the URL and nothing else. The token
 * proves "whoever opened the email we sent to this account", which is exactly
 * as much identity as recording an answer needs, and asking for a password
 * instead would lose most of the responses — a recipient may be on a device
 * they have never signed in on, and half the point of the campaign is reaching
 * people who have drifted away from the site.
 *
 * The token is scoped hard: it can read a display name and read/write this one
 * response row. It is not a session, grants nothing else about the account, and
 * is never exchanged for a login.
 */

// Cheap in-process throttle on token lookups. The tokens are 32 random bytes so
// guessing one is not a realistic attack; this exists to stop a broken client
// (or a crawler in a redirect loop) hammering the endpoint, not as a security
// boundary. In-memory on purpose — a durable counter would be more machinery
// than the risk justifies.
const HITS = new Map(); // ip -> { count, resetAt }
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 60;

function throttle(req, res, next) {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  const now = Date.now();
  const entry = HITS.get(ip);
  if (!entry || now > entry.resetAt) {
    HITS.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }
  if (++entry.count > MAX_PER_WINDOW) {
    return res.status(429).json({ message: 'Too many requests. Please wait a moment.' });
  }
  next();
}

// Keeps the map from growing without bound on a long-lived process.
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of HITS) if (now > e.resetAt) HITS.delete(ip);
}, 5 * 60 * 1000).unref?.();

async function loadInvite(token) {
  if (!token || typeof token !== 'string' || token.length < 16) return null;
  return SurveyInvite.findOne({ token }).populate('userId', 'displayName agentNumber cbatPassed');
}

function nameFor(user) {
  return user?.displayName?.trim() || (user?.agentNumber ? `Agent ${user.agentNumber}` : 'there');
}

/**
 * POST /api/survey/self — the signed-in shortcut.
 *
 * `/survey` with no token is a real entry point, not a mistake: the link gets
 * passed around (in chat, in an announcement, by someone who deleted the
 * email), and a signed-in visitor already has more identity than the token
 * carries. So instead of a second questionnaire that reads an account, this
 * mints (or finds) that account's ordinary invite and hands back its token —
 * the whole flow after this point is byte-for-byte the emailed one, including
 * resuming a half-finished run, the badge and the deferral.
 *
 * Finding rather than always creating is what makes it safe to click twice, and
 * what joins a self-serve answer to an invitation the person was already sent:
 * the unique (userId, campaign) index means there is exactly one row to land
 * on, so a run started from an email and continued from `/survey` is one
 * response, not two.
 *
 * It never returns anyone else's token, and it is a POST because it can create
 * a row — a GET that quietly issued a capability token would be fetchable by
 * anything that follows links.
 */
router.post('/self', protect, async (req, res) => {
  try {
    const settings = await AppSettings.getSettings();
    if (settings.cbatSurveyEnabled === false) {
      return res.status(410).json({ message: 'This questionnaire has closed.' });
    }

    // Admins land in the dry-run campaign, exactly as the "mail yourself the
    // real thing" button does. The owner walking the live link is the most
    // likely visitor this endpoint will ever have, and their answers must not
    // turn up in the response summary or the funnel — the campaign key is what
    // keeps them out, and `isTest` stops the run writing a PASSED badge onto
    // their own account. Nothing else about the flow changes.
    const isTest   = !!req.user.isAdmin || !!req.user.isBot;
    const campaign = isTest ? SURVEY_TEST_CAMPAIGN : SURVEY_CAMPAIGN;
    const filter   = { userId: req.user._id, campaign };

    let invite = await SurveyInvite.findOne(filter);
    if (!invite) {
      try {
        invite = await SurveyInvite.create({
          ...filter,
          token: SurveyInvite.newToken(),
          isTest,
          selfServe: true,
        });
      } catch (err) {
        // Raced against another tab. The index did its job; read back the row
        // that won rather than failing the request.
        if (err?.code !== 11000) throw err;
        invite = await SurveyInvite.findOne(filter);
      }
    }

    if (!invite) return res.status(500).json({ message: 'Could not open the questionnaire.' });

    res.json({ status: 'success', data: { token: invite.token } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/survey/:token — everything the page needs to render.
router.get('/:token', throttle, async (req, res) => {
  try {
    const invite = await loadInvite(req.params.token);
    if (!invite) return res.status(404).json({ message: 'This questionnaire link is not valid.' });

    const settings = await AppSettings.getSettings();

    // First open. Recorded once so the admin funnel can tell "never opened it"
    // apart from "opened it and did not answer" — two very different problems.
    if (!invite.openedAt) {
      invite.openedAt = new Date();
      await invite.save();
    }

    const response = await SurveyResponse.findOne({ inviteId: invite._id }).lean();

    res.json({
      status: 'success',
      data: {
        name: nameFor(invite.userId),
        closed: settings.cbatSurveyEnabled === false,
        optedOut: !!invite.optedOutAt,
        completed: !!invite.completedAt,
        roleGroups: surveyRoles.groups,
        // Answers so far, so a reopened link resumes rather than restarts.
        response: response ?? null,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Whitelist + validate. Anything not listed here is ignored rather than stored,
// so a malformed or hostile client cannot write arbitrary fields onto the row.
function sanitiseAnswers(body = {}) {
  const out = {};
  const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : null);
  const rating = (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= RATING_MIN && n <= RATING_MAX ? n : null;
  };
  const pass = (v) => (PASS_ANSWERS.includes(v) ? v : null);

  if ('satTest' in body)       out.satTest = body.satTest === true ? true : body.satTest === false ? false : null;
  if ('testBookedFor' in body) out.testBookedFor = parseBookingDate(body.testBookedFor);
  if ('testBookedUnknown' in body) out.testBookedUnknown = body.testBookedUnknown === true;
  if ('role' in body)          out.role = text(body.role, 60);
  if ('roleOther' in body)     out.roleOther = text(body.roleOther, 120);
  if ('passedForRole' in body) out.passedForRole = pass(body.passedForRole);
  if ('passedAnyRole' in body) out.passedAnyRole = pass(body.passedAnyRole);
  if ('passedAnyRoleWhich' in body) out.passedAnyRoleWhich = text(body.passedAnyRoleWhich, 120);
  if ('realismRating' in body) out.realismRating = rating(body.realismRating);
  if ('gaps' in body)          out.gaps = text(body.gaps, 2000);
  if ('comment' in body)       out.comment = text(body.comment, 2000);
  if ('helpedRating' in body)  out.helpedRating = rating(body.helpedRating);
  if ('donationClicked' in body && body.donationClicked === true) out.donationClicked = true;

  return out;
}

// PATCH /api/survey/:token — save answers.
//
// Called after EVERY answer, not once at the end. A questionnaire that only
// stores a completed run throws away every person who quits halfway, and those
// people have usually already answered the question we care most about.
router.patch('/:token', throttle, async (req, res) => {
  try {
    const invite = await loadInvite(req.params.token);
    if (!invite) return res.status(404).json({ message: 'This questionnaire link is not valid.' });
    if (invite.optedOutAt) return res.status(410).json({ message: 'This questionnaire is closed.' });

    const settings = await AppSettings.getSettings();
    if (settings.cbatSurveyEnabled === false) {
      return res.status(410).json({ message: 'This questionnaire has closed.' });
    }

    const updates = sanitiseAnswers(req.body);
    const complete = req.body?.complete === true;
    if (complete) updates.completedAt = new Date();

    const response = await SurveyResponse.findOneAndUpdate(
      { inviteId: invite._id },
      {
        $set: updates,
        $setOnInsert: {
          inviteId: invite._id,
          userId: invite.userId?._id ?? invite.userId,
          campaign: invite.campaign,
          startedAt: new Date(),
        },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );

    // Record the pass on the account itself.
    //
    // Either answer counts: passing for a different role than the one applied
    // for is still passing the CBAT, and the badge is about the test, not the
    // posting. The evidence is the same as the existing admin route's — the
    // user's own word — so this writes the same flag, tagged with how it got
    // there. Never unset here: an account marked by an admin must not be
    // cleared by a later "no" on a form.
    // `isTest` is checked here rather than at the top: a dry run has to behave
    // exactly like the real thing on screen (the badge still appears, so the
    // closing screen can be reviewed), and differ only in what it writes.
    const claimsPass = updates.passedForRole === 'yes' || updates.passedAnyRole === 'yes';
    if (claimsPass && !invite.isTest) {
      await User.updateOne(
        { _id: invite.userId?._id ?? invite.userId, cbatPassed: { $ne: true } },
        { cbatPassed: true, cbatPassedAt: new Date(), cbatPassedSource: 'questionnaire' },
      );
    }

    // "Not yet" defers rather than ends. The invite is stamped with the date
    // before which they must not be contacted again, which is exactly the
    // promise the questionnaire makes to them on screen — so it is set here,
    // from their answer, rather than left to a later sweep that might not run.
    //
    // Deliberately NOT gated on `complete`: this branch is where someone stops,
    // and a deferral that only landed on a finished run would never be written.
    let deferredUntil = invite.deferredUntil;
    const saysNotYet = updates.satTest === false;
    const answeredBooking = 'testBookedFor' in updates || 'testBookedUnknown' in updates;
    if (saysNotYet || (answeredBooking && response.satTest === false)) {
      deferredUntil = deferralFor({ bookedFor: response.testBookedFor ?? null });
      invite.deferredUntil = deferredUntil;
      await invite.save();
    }

    if (complete && !invite.completedAt) {
      // A "not yet" run is finished from the respondent's point of view, but it
      // is not an answer to the questionnaire — marking it complete would take
      // them off the list permanently, which is the opposite of the intent.
      if (response.satTest === false) {
        await invite.save();
      } else {
        invite.completedAt = new Date();
        invite.responseId  = response._id;
        await invite.save();
      }
    }

    res.json({
      status: 'success',
      data: { response, badgeAwarded: claimsPass, deferredUntil: deferredUntil ?? null },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/survey/:token/opt-out — stop emailing this person.
//
// Honoured IMMEDIATELY and UNCONDITIONALLY, with no question to answer first
// and nothing to confirm. That ordering is the whole design: an opt-out that
// depends on the recipient supplying anything is not an opt-out. The reason,
// and the one question we would like answered, are collected afterwards by
// PATCH below, from someone who has already been let go — which is both the
// lawful order and, in practice, the one that gets answered more often, because
// replying visibly costs them nothing.
router.post('/:token/opt-out', throttle, async (req, res) => {
  try {
    const invite = await loadInvite(req.params.token);
    if (!invite) return res.status(404).json({ message: 'This link is not valid.' });

    const userId = invite.userId?._id ?? invite.userId;
    const now = new Date();

    if (!invite.optedOutAt) {
      invite.optedOutAt = now;
      await invite.save();
    }

    // Same rule as the pass flag: a dry run shows the page but must not actually
    // unsubscribe the admin walking through it.
    if (!invite.isTest) {
      await User.updateOne(
        { _id: userId, 'researchEmailOptOut.at': null },
        { researchEmailOptOut: { at: now, reason: null, campaign: invite.campaign } },
      );
    }

    res.json({ status: 'success', data: { name: nameFor(invite.userId), optedOutAt: now } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/survey/:token/opt-out — the optional questions asked *after* the
// opt-out has already been applied. Declining to answer changes nothing.
router.patch('/:token/opt-out', throttle, async (req, res) => {
  try {
    const invite = await loadInvite(req.params.token);
    if (!invite) return res.status(404).json({ message: 'This link is not valid.' });
    if (!invite.optedOutAt) {
      return res.status(400).json({ message: 'Not opted out.' });
    }

    const userId = invite.userId?._id ?? invite.userId;
    const reason = OPT_OUT_REASONS.includes(req.body?.reason) ? req.body.reason : null;
    const passed = PASS_ANSWERS.includes(req.body?.passedForRole) ? req.body.passedForRole : null;
    const satTest = req.body?.satTest === true ? true : req.body?.satTest === false ? false : null;

    if (reason && !invite.isTest) {
      await User.updateOne({ _id: userId }, { 'researchEmailOptOut.reason': reason });
    }

    if (passed || satTest !== null) {
      await SurveyResponse.findOneAndUpdate(
        { inviteId: invite._id },
        {
          $set: {
            ...(passed ? { passedForRole: passed } : {}),
            ...(satTest !== null ? { satTest } : {}),
            optOutReason: reason,
          },
          $setOnInsert: {
            inviteId: invite._id,
            userId,
            campaign: invite.campaign,
            startedAt: new Date(),
          },
        },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      );

      if (passed === 'yes' && !invite.isTest) {
        await User.updateOne(
          { _id: userId, cbatPassed: { $ne: true } },
          { cbatPassed: true, cbatPassedAt: new Date(), cbatPassedSource: 'questionnaire' },
        );
      }
    }

    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
