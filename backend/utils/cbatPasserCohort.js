'use strict';

/**
 * "Who has probably sat their real CBAT by now?"
 *
 * There is no event for sitting the real test — it happens at a selection
 * centre, nowhere near us, and for a non-RAF candidate it is not even called a
 * CBAT. So the cohort is inferred from a shape in the data: someone who trained
 * hard and then stopped. Two independent signals do the work.
 *
 * HOW MANY GAMES THEY FINISHED — counted from the per-game result collections,
 * never from GameSessionCbatStart. Opening a game writes a start; finishing it
 * writes a result. Counting results therefore excludes abandoned sessions by
 * construction rather than by guessing at a duration, which is exactly the
 * "opened then abandoned" case we must not mistake for training.
 *
 * WHEN THEY LAST TOUCHED ANYTHING — the dormancy gate. Note this is a WIDER
 * signal than the one above: it includes abandoned starts and the plain
 * heartbeat (`lastSeen`), because someone opening the app daily without
 * finishing anything is still very much here, and almost certainly has not sat
 * their test yet. Using completions alone here would call them dormant.
 *
 * The two dates are deliberately NOT the same field, and which one is used
 * where matters:
 *
 *   lastActivityAt (starts + results + lastSeen)  →  decides dormancy
 *   lastPlayedAt   (results only)                 →  groups the list by day
 *
 * The list groups by lastPlayedAt because the question an admin is asking of
 * that grouping is "roughly when was this person's CBAT?", and the last run
 * they actually completed answers it far better than a stray heartbeat from
 * someone who opened the app a fortnight later to look at a leaderboard.
 */

const User                 = require('../models/User');
const GameSessionCbatStart = require('../models/GameSessionCbatStart');
const SurveyInvite         = require('../models/SurveyInvite');
const { CBAT_GAMES }       = require('../constants/cbatGames');
const { ymdInTz }          = require('../constants/activity');
const {
  SURVEY_CAMPAIGN,
  DEFAULT_MIN_COMPLETIONS,
  DEFAULT_DORMANT_DAYS,
  WARM_BAND_DAYS,
  isExcludedAccount,
} = require('../constants/survey');

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {object}  opts
 * @param {number} [opts.minCompletions]  finished runs required (default 10)
 * @param {number} [opts.dormantDays]     days of silence required (default 21)
 * @param {Date}   [opts.now]             injectable clock, for tests
 * @param {string} [opts.campaign]
 */
async function buildCbatPasserCohort({
  minCompletions = DEFAULT_MIN_COMPLETIONS,
  dormantDays    = DEFAULT_DORMANT_DAYS,
  now            = new Date(),
  campaign       = SURVEY_CAMPAIGN,
} = {}) {
  // Coarse exclusions run in the database; the by-name/by-address list runs in
  // JS via isExcludedAccount, so there is one readable place to look when
  // someone asks why an account is missing.
  const users = await User.find(
    {
      isAdmin:  { $ne: true },
      isBot:    { $ne: true },
      isBanned: { $ne: true },
      'researchEmailOptOut.at': null,
    },
    'agentNumber email displayName isTester cbatPassed cbatPassedAt lastSeen createdAt subscriptionTier',
  ).lean();

  const candidates = users.filter(u => !isExcludedAccount(u));
  if (!candidates.length) return emptyCohort({ minCompletions, dormantDays });

  const userIds = candidates.map(u => u._id);
  const cbatConfigs = Object.values(CBAT_GAMES);

  // One $group per registry entry, exactly as enrichUsersWithStats does — the
  // same shape already runs on every Admin › Users load, so the cost is known.
  // modeFilter MUST be spread: entries like plane-turn-2d/3d share one
  // collection and would otherwise each count the other's rows.
  const [startRows, ...perGameRows] = await Promise.all([
    GameSessionCbatStart.aggregate([
      { $match: { userId: { $in: userIds } } },
      { $group: { _id: '$userId', lastAt: { $max: '$startedAt' } } },
    ]),
    ...cbatConfigs.map(cfg => cfg.Model.aggregate([
      { $match: { ...(cfg.modeFilter ?? {}), userId: { $in: userIds } } },
      { $group: { _id: '$userId', count: { $sum: 1 }, lastAt: { $max: '$createdAt' } } },
    ])),
  ]);

  const completions   = new Map(); // userId -> finished runs
  const lastPlayed    = new Map(); // userId -> ms of last FINISHED run
  const lastActivity  = new Map(); // userId -> ms of last anything

  const bumpActivity = (id, at) => {
    if (!at) return;
    const ms = new Date(at).getTime();
    if (Number.isNaN(ms)) return;
    if (!lastActivity.has(id) || ms > lastActivity.get(id)) lastActivity.set(id, ms);
  };

  for (const row of startRows) bumpActivity(row._id.toString(), row.lastAt);

  for (const rows of perGameRows) {
    for (const row of rows) {
      const id = row._id.toString();
      completions.set(id, (completions.get(id) ?? 0) + row.count);
      if (row.lastAt) {
        const ms = new Date(row.lastAt).getTime();
        if (!Number.isNaN(ms) && (!lastPlayed.has(id) || ms > lastPlayed.get(id))) {
          lastPlayed.set(id, ms);
        }
        bumpActivity(id, row.lastAt);
      }
    }
  }

  // Invites for this campaign, so the list can show who has already been mailed.
  const invites = await SurveyInvite.find({ campaign }).lean();
  const inviteByUser = new Map(invites.map(i => [i.userId.toString(), i]));

  const nowMs   = now.getTime();
  const dormant = Math.max(0, Number(dormantDays) || 0);
  const minRuns = Math.max(0, Number(minCompletions) || 0);

  const rows = [];
  for (const u of candidates) {
    const id    = u._id.toString();
    const runs  = completions.get(id) ?? 0;
    if (runs < minRuns) continue;

    // lastSeen joins the activity signal here rather than in the loops above so
    // that someone with no CBAT rows at all still gets a sensible date — though
    // they cannot reach this line anyway, having failed the completions gate.
    bumpActivity(id, u.lastSeen);

    const activityMs = lastActivity.get(id);
    const playedMs   = lastPlayed.get(id);
    if (!activityMs || !playedMs) continue; // no usable dates — cannot place them

    const daysDormant = Math.floor((nowMs - activityMs) / DAY_MS);
    if (daysDormant < WARM_BAND_DAYS) continue; // still clearly active

    const invite = inviteByUser.get(id) ?? null;

    rows.push({
      _id:          u._id,
      agentNumber:  u.agentNumber,
      displayName:  u.displayName ?? null,
      email:        u.email,
      isTester:     !!u.isTester,
      cbatPassed:   !!u.cbatPassed,
      completions:  runs,
      lastPlayedAt:   new Date(playedMs),
      lastActivityAt: new Date(activityMs),
      daysDormant,
      // 'ready' is mailable in bulk; 'warm' is listed but held back, because
      // 14–20 days of quiet is as likely to be a holiday as a finished CBAT.
      band: daysDormant >= dormant ? 'ready' : 'warm',
      invite: invite && {
        sentAt:        invite.sentAt ?? null,
        openedAt:      invite.openedAt ?? null,
        completedAt:   invite.completedAt ?? null,
        optedOutAt:    invite.optedOutAt ?? null,
        sendError:     invite.sendError ?? null,
        deferredUntil: invite.deferredUntil ?? null,
        sendCount:     invite.sendCount ?? 0,
      },
      // Whether they can be sent to right now — never invited, a failed send
      // worth retrying, or a "not yet" whose deferral has expired. Computed from
      // the model's own rule so the list and the sender cannot disagree.
      mailable: SurveyInvite.isMailable(invite, now),
    });
  }

  // Group by the day of the last FINISHED run — see the header for why this is
  // lastPlayedAt and not lastActivityAt.
  const byDay = new Map();
  for (const row of rows) {
    const day = ymdInTz(row.lastPlayedAt);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(row);
  }

  const groups = [...byDay.entries()]
    .map(([day, list]) => ({
      day,
      users: list.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt),
    }))
    .sort((a, b) => (a.day < b.day ? 1 : -1)); // most recent day first

  const ready     = rows.filter(r => r.band === 'ready');
  const emailed   = rows.filter(r => r.invite?.sentAt);
  const responded = rows.filter(r => r.invite?.completedAt);
  const deferred  = rows.filter(r => r.invite?.deferredUntil && r.invite.deferredUntil > now);

  return {
    thresholds: { minCompletions: minRuns, dormantDays: dormant, warmBandDays: WARM_BAND_DAYS },
    groups,
    totals: {
      candidates: rows.length,
      ready:      ready.length,
      warm:       rows.length - ready.length,
      emailed:    emailed.length,
      responded:  responded.length,
      // Told us they have not sat it yet; held until their date comes round.
      deferred:   deferred.length,
      // What "Send to next 50" has left to draw from.
      remaining:  ready.filter(r => r.mailable).length,
    },
  };
}

function emptyCohort({ minCompletions, dormantDays }) {
  return {
    thresholds: { minCompletions, dormantDays, warmBandDays: WARM_BAND_DAYS },
    groups: [],
    totals: { candidates: 0, ready: 0, warm: 0, emailed: 0, responded: 0, deferred: 0, remaining: 0 },
  };
}

// The next batch to mail: 'ready' band only, mailable, oldest last-played first
// so the people furthest past their test are cleared first.
//
// Someone whose deferral has just expired sorts by that same last-played date,
// which puts them near the front — correct, since they have been waiting since
// before everyone else on the list.
function selectNextBatch(cohort, size) {
  return cohort.groups
    .flatMap(g => g.users)
    .filter(u => u.band === 'ready' && u.mailable)
    .sort((a, b) => a.lastPlayedAt - b.lastPlayedAt)
    .slice(0, size);
}

module.exports = { buildCbatPasserCohort, selectNextBatch, DAY_MS };
