const router = require('express').Router();
const { protect, adminOnly } = require('../middleware/auth');
const User = require('../models/User');
const IntelligenceBriefRead = require('../models/IntelligenceBriefRead');
const GameSessionQuizAttempt = require('../models/GameSessionQuizAttempt');
const GameSessionOrderOfBattleResult = require('../models/GameSessionOrderOfBattleResult');
const GameSessionWhereAircraftResult = require('../models/GameSessionWhereAircraftResult');
const GameSessionFlashcardRecallResult = require('../models/GameSessionFlashcardRecallResult');
const AptitudeSyncUsage = require('../models/AptitudeSyncUsage');
const GameSessionCbatStart = require('../models/GameSessionCbatStart');
const GameSessionCbatTutorial = require('../models/GameSessionCbatTutorial');
const { CBAT_GAMES } = require('../constants/cbatGames');

// Games whose names render greyed on the Reports page — tutorial/practice modes
// that aren't the scored test. The frontend dims any perGame/legend/axis label
// whose key is in `practiceKeys` (built from these + the tutorial entries).
const PRACTICE_GAME_KEYS = ['plane-turn-2d', 'plane-turn-3d'];

// In-app tutorials surfaced on the Reports page. `key` is a display-only pseudo
// game key; `gameKey` is the real CBAT game the tutorial belongs to (what the
// GameSessionCbatTutorial rows store).
const TUTORIAL_GAMES = [
  { key: 'target-tutorial', gameKey: 'target', label: 'Target (tutorial)' },
];

// Timezone for the day/hour activity heatmap. The audience is UK-based, and
// "what time of day" only reads correctly in local time (a UTC grid smears
// peaks by an hour under BST), so starts are bucketed in Europe/London rather
// than UTC like the daily charts.
const ACTIVITY_TZ = 'Europe/London';

router.use(protect, adminOnly);

// ── Helpers ───────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUtcDay(d = new Date()) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function windowStart(window) {
  const now = new Date();
  if (window === 'today') return startOfUtcDay(now);
  if (window === '7d')    return new Date(now.getTime() - 7  * DAY_MS);
  if (window === '30d')   return new Date(now.getTime() - 30 * DAY_MS);
  return new Date(0); // all-time
}

function windowDays(window) {
  if (window === 'today') return 1;
  if (window === '7d')    return 7;
  if (window === '30d')   return 30;
  return null; // all-time → variable
}

// The fixed-length period immediately before the selected window, used for
// "compare to previous period". Returns null for all-time (no prior period).
function priorWindow(window) {
  const days = windowDays(window);
  if (!days) return null;
  const end = windowStart(window);                          // prior ends where current begins
  const start = new Date(end.getTime() - days * DAY_MS);    // …and is the same length
  return { start, end };
}

// Relative change, matching the existing signupsDelta semantics. null when there's
// no prior baseline to divide by (avoids a misleading +100% / Infinity).
function relDelta(curr, prev) {
  if (prev == null || prev === 0) return null;
  return (curr - prev) / prev;
}

function ymd(date) {
  const x = new Date(date);
  return x.toISOString().slice(0, 10);
}

// Build a zero-filled daily bucket array between `start` and `end` (inclusive).
function emptyDailyBuckets(start, end, extraKeys = []) {
  const out = [];
  const cur = startOfUtcDay(start);
  const stop = startOfUtcDay(end);
  while (cur <= stop) {
    const row = { date: ymd(cur), count: 0 };
    for (const k of extraKeys) row[k] = 0;
    out.push(row);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

// Mongo aggregation: group events by UTC day, return [{ date, count }].
// extraMatch lets callers narrow the collection (e.g. cfg.modeFilter to scope
// shared-model registry entries like plane-turn-2d vs plane-turn-3d).
async function dailyCount(Model, dateField, since, extraMatch = {}, until = null) {
  const dateCond = {};
  if (since)  dateCond.$gte = since;
  if (until)  dateCond.$lt  = until;
  const match = { ...extraMatch, ...(Object.keys(dateCond).length ? { [dateField]: dateCond } : {}) };
  const rows = await Model.aggregate([
    { $match: match },
    { $group: {
      _id: { $dateToString: { format: '%Y-%m-%d', date: `$${dateField}`, timezone: 'UTC' } },
      count: { $sum: 1 },
    }},
  ]);
  const map = new Map();
  for (const r of rows) map.set(r._id, r.count);
  return map;
}

// Mongo aggregation: per UTC day, count distinct userIds.
async function dailyDistinctUsers(Model, dateField, userField, since, extraMatch = {}, until = null) {
  const dateCond = {};
  if (since)  dateCond.$gte = since;
  if (until)  dateCond.$lt  = until;
  const match = { ...extraMatch, ...(Object.keys(dateCond).length ? { [dateField]: dateCond } : {}) };
  const rows = await Model.aggregate([
    { $match: match },
    { $group: {
      _id: {
        date: { $dateToString: { format: '%Y-%m-%d', date: `$${dateField}`, timezone: 'UTC' } },
        user: `$${userField}`,
      },
    }},
  ]);
  // rows is one row per (day, user); just return as array of {date, userId}
  return rows.map(r => ({ date: r._id.date, userId: String(r._id.user) }));
}

// Merge multiple event streams into per-day distinct-user counts.
function mergeDailyDistinctUsers(streams) {
  const byDay = new Map(); // date → Set<userId>
  for (const stream of streams) {
    for (const ev of stream) {
      if (!ev.userId) continue;
      let set = byDay.get(ev.date);
      if (!set) { set = new Set(); byDay.set(ev.date, set); }
      set.add(ev.userId);
    }
  }
  return byDay;
}

// All event streams that count as "user activity" for DAU.
async function activityStreams(since, until = null) {
  const cbatStreams = await Promise.all(
    Object.values(CBAT_GAMES).map(g => dailyDistinctUsers(g.Model, 'createdAt', 'userId', since, g.modeFilter ?? {}, until))
  );
  const [quiz, boo, wta, flash, apt, briefs] = await Promise.all([
    dailyDistinctUsers(GameSessionQuizAttempt,         'timeStarted', 'userId', since, {}, until),
    dailyDistinctUsers(GameSessionOrderOfBattleResult, 'createdAt',   'userId', since, {}, until),
    dailyDistinctUsers(GameSessionWhereAircraftResult, 'createdAt',   'userId', since, {}, until),
    dailyDistinctUsers(GameSessionFlashcardRecallResult,'createdAt',  'userId', since, {}, until),
    dailyDistinctUsers(AptitudeSyncUsage,              'createdAt',   'userId', since, {}, until),
    dailyDistinctUsers(IntelligenceBriefRead,          'createdAt',   'userId', since, {}, until),
  ]);
  return [...cbatStreams, quiz, boo, wta, flash, apt, briefs];
}

// CBAT-only event streams (used by /cbat).
async function cbatStreams(since, until = null) {
  return Promise.all(
    Object.entries(CBAT_GAMES).map(async ([key, g]) => ({
      key,
      label: g.label,
      events: await dailyDistinctUsers(g.Model, 'createdAt', 'userId', since, g.modeFilter ?? {}, until),
      // also need raw count per day (sessions, not distinct-users)
      sessionsByDay: await dailyCount(g.Model, 'createdAt', since, g.modeFilter ?? {}, until),
    }))
  );
}

// Tutorial / practice-mode usage per game, with a per-step drop-off funnel.
// Kept separate from score-result streams: tutorials are a learning aid and are
// deliberately excluded from the engagement headlines (sessions, retention,
// activation). Volume is low, so reading the rows and reducing in JS is simplest.
async function tutorialUsage(since) {
  return Promise.all(TUTORIAL_GAMES.map(async (t) => {
    const docs = await GameSessionCbatTutorial
      .find({ gameKey: t.gameKey, startedAt: { $gte: since } })
      .select('userId furthestStep totalSteps completed startedAt')
      .lean();

    const sessions = docs.length;
    const players = new Set(docs.map(d => String(d.userId))).size;
    const completed = docs.filter(d => d.completed).length;
    const totalSteps = docs.reduce((m, d) => Math.max(m, d.totalSteps || 0), 0);

    // reached[step] = playthroughs whose furthest section is at least `step`.
    const funnel = [];
    for (let step = 0; step < totalSteps; step++) {
      funnel.push({ step, reached: docs.filter(d => (d.furthestStep || 0) >= step).length });
    }
    // dropOff = reached this step but not the next (the final step's "next" is completion).
    for (let i = 0; i < funnel.length; i++) {
      const next = i + 1 < funnel.length ? funnel[i + 1].reached : completed;
      funnel[i].dropOff = Math.max(0, funnel[i].reached - next);
    }

    const dayMap = new Map();
    for (const d of docs) dayMap.set(ymd(d.startedAt), (dayMap.get(ymd(d.startedAt)) ?? 0) + 1);

    return {
      key: t.key,
      label: t.label,
      gameKey: t.gameKey,
      sessions,
      players,
      avgPerPlayer: players ? sessions / players : 0,
      starts: sessions,
      completed,
      completionRate: sessions ? completed / sessions : 0,
      abandonPct: sessions ? 1 - completed / sessions : 0,
      totalSteps,
      funnel,
      sessionsByDay: dayMap,
    };
  }));
}

// Day-of-week × hour-of-day session-start counts for the activity heatmap.
// Grid is 7 rows (index 0 = Monday, via $isoDayOfWeek) × 24 hour columns,
// bucketed in ACTIVITY_TZ. Sourced from GameSessionCbatStart (every start,
// including abandoned sessions) — the broadest "when do people use Skywatch"
// signal. Respects the window (since = window start).
async function activityHeatmap(since, until = null) {
  const dateCond = {};
  if (since) dateCond.$gte = since;
  if (until) dateCond.$lt  = until;
  const match = Object.keys(dateCond).length ? { startedAt: dateCond } : {};
  const rows = await GameSessionCbatStart.aggregate([
    { $match: match },
    { $group: {
      _id: {
        dow:  { $isoDayOfWeek: { date: '$startedAt', timezone: ACTIVITY_TZ } }, // 1=Mon..7=Sun
        hour: { $hour:         { date: '$startedAt', timezone: ACTIVITY_TZ } }, // 0..23
      },
      count: { $sum: 1 },
    }},
  ]);
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  let max = 0;
  let total = 0;
  for (const r of rows) {
    const row = r._id.dow - 1;      // 0 = Monday
    const hour = r._id.hour;
    if (row < 0 || row > 6 || hour < 0 || hour > 23) continue;
    grid[row][hour] = r.count;
    total += r.count;
    if (r.count > max) max = r.count;
  }
  return { timezone: ACTIVITY_TZ, grid, max, total };
}

// Activation for a signup cohort: of users who registered in [start, end),
// the share who played any CBAT game within 24h of signing up.
async function computeActivation(start, end = null) {
  const createdAt = { $gte: start, ...(end ? { $lt: end } : {}) };
  const newUsers = await User.find({ createdAt }).select('_id createdAt').lean();
  if (newUsers.length === 0) return { rate: 0, cohort: 0, activated: 0 };

  const userIdsObj = newUsers.map(u => u._id);
  const cbatDocs = await Promise.all(
    Object.values(CBAT_GAMES).map(g => g.Model.find({
      ...(g.modeFilter ?? {}),
      userId: { $in: userIdsObj },
    }).select('userId createdAt').lean())
  );
  const earliestPlay = new Map();
  for (const docs of cbatDocs) {
    for (const d of docs) {
      const k = String(d.userId);
      if (!earliestPlay.has(k) || d.createdAt < earliestPlay.get(k)) earliestPlay.set(k, d.createdAt);
    }
  }
  let activated = 0;
  for (const u of newUsers) {
    const first = earliestPlay.get(String(u._id));
    if (first && (first - u.createdAt) <= DAY_MS) activated++;
  }
  return { rate: activated / newUsers.length, cohort: newUsers.length, activated };
}

// ── GET /api/admin/reports/snapshot ───────────────────────────────────────────
// Time-period-fixed metrics that should NOT change with the window picker.
// Includes DAU (today), WAU (7d), MAU (30d), DAU 30d sparkline, signup source
// (all-time), subscription tiers (current snapshot), totals.

router.get('/snapshot', async (_req, res) => {
  try {
    const now = new Date();
    const sparkStart = new Date(now.getTime() - 29 * DAY_MS); // 30 days inclusive of today
    const testStart  = new Date(now.getTime() - 6  * DAY_MS); // 7 days inclusive of today

    const [totalUsers, signupSourceAgg, subTierAgg, testerDocs] = await Promise.all([
      User.countDocuments(),
      User.aggregate([
        { $group: { _id: { $cond: [{ $ifNull: ['$googleId', false] }, 'google', 'email'] }, count: { $sum: 1 } } },
      ]),
      User.aggregate([
        { $group: { _id: '$subscriptionTier', count: { $sum: 1 } } },
      ]),
      User.find({ isTester: true }).select('_id').lean(),
    ]);

    const streams = await activityStreams(sparkStart);
    const dailyMap = mergeDailyDistinctUsers(streams);

    // Test usage — distinct tester accounts who played any CBAT game per day over
    // the last 7 days. Fixed 7-day window (independent of the report window picker).
    const testerIds = new Set(testerDocs.map(u => String(u._id)));
    let testUsage = emptyDailyBuckets(testStart, now).map(b => ({ date: b.date, count: 0 }));
    if (testerIds.size) {
      const testerCbatStreams = await Promise.all(
        Object.values(CBAT_GAMES).map(g =>
          dailyDistinctUsers(g.Model, 'createdAt', 'userId', testStart, g.modeFilter ?? {})
        )
      );
      const testerByDay = mergeDailyDistinctUsers(testerCbatStreams); // date → Set<userId>
      testUsage = emptyDailyBuckets(testStart, now).map(b => {
        const users = testerByDay.get(b.date);
        let count = 0;
        if (users) for (const u of users) if (testerIds.has(u)) count++;
        return { date: b.date, count };
      });
    }

    const dailyDau = emptyDailyBuckets(sparkStart, now).map(b => ({
      date: b.date,
      count: dailyMap.get(b.date)?.size ?? 0,
    }));

    // DAU/WAU/MAU from event streams.
    const todayKey = ymd(startOfUtcDay(now));
    const dau = dailyMap.get(todayKey)?.size ?? 0;
    const wau = (() => {
      const set = new Set();
      const cutoff = new Date(now.getTime() - 7 * DAY_MS);
      for (const [date, users] of dailyMap.entries()) {
        if (new Date(date) >= startOfUtcDay(cutoff)) for (const u of users) set.add(u);
      }
      return set.size;
    })();
    const mau = (() => {
      const set = new Set();
      for (const users of dailyMap.values()) for (const u of users) set.add(u);
      return set.size;
    })();

    const signupSource = { google: 0, email: 0 };
    for (const r of signupSourceAgg) signupSource[r._id] = r.count;

    const subscription = { free: 0, trial: 0, silver: 0, gold: 0 };
    for (const r of subTierAgg) if (r._id in subscription) subscription[r._id] = r.count;

    res.json({
      status: 'success',
      data: {
        headlines: { dau, wau, mau, totalUsers },
        dailyDau,
        signupSource,
        subscription,
        testUsage,
      },
    });
  } catch (err) {
    console.error('[reports/snapshot] error:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ── GET /api/admin/reports/window?window=7d|30d|today|all ─────────────────────
// Window-bound metrics. Refetched on window change.

router.get('/window', async (req, res) => {
  try {
    const window = req.query.window || '7d';
    const compare = req.query.compare === '1' || req.query.compare === 'true';
    const now = new Date();
    const wStart = windowStart(window);
    const prior = priorWindow(window);              // null for all-time
    const wantCompare = compare && !!prior;

    const [signupsInWindow, prevSignups] = await Promise.all([
      User.countDocuments({ createdAt: { $gte: wStart } }),
      prior
        ? User.countDocuments({ createdAt: { $gte: prior.start, $lt: prior.end } })
        : Promise.resolve(0),
    ]);

    // Activity streams limited to window for active-in-window calc.
    const distinctInRange = (dailyMap) => {
      const set = new Set();
      for (const users of dailyMap.values()) for (const u of users) set.add(u);
      return set.size;
    };
    const streams = await activityStreams(wStart);
    const activeInWindow = distinctInRange(mergeDailyDistinctUsers(streams));
    const totalUsers = await User.countDocuments();

    // Daily signups for window (zero-filled). When comparing, overlay the prior
    // period's signups aligned by day-offset (prior day 1 → current day 1).
    const signupsByDay = await dailyCount(User, 'createdAt', wStart);
    const dailySignups = (window === 'all'
      ? Array.from(signupsByDay.entries()).sort().map(([date, count]) => ({ date, count }))
      : emptyDailyBuckets(wStart, now).map(b => ({
          date: b.date,
          count: signupsByDay.get(b.date) ?? 0,
        }))
    );
    if (wantCompare) {
      const priorSignupsByDay = await dailyCount(User, 'createdAt', prior.start, {}, prior.end);
      const priorBuckets = emptyDailyBuckets(prior.start, new Date(prior.end.getTime() - DAY_MS));
      dailySignups.forEach((row, i) => {
        const pb = priorBuckets[i];
        row.prev = pb ? (priorSignupsByDay.get(pb.date) ?? 0) : 0;
      });
    }

    // Activation: cohort = signups in window, % who played CBAT within 24h of signup.
    const activation = await computeActivation(wStart);

    // Prior-period metrics for the comparison badges.
    let comparison = null;
    if (wantCompare) {
      const [priorStreams, priorActivation] = await Promise.all([
        activityStreams(prior.start, prior.end),
        computeActivation(prior.start, prior.end),
      ]);
      const prevActive = distinctInRange(mergeDailyDistinctUsers(priorStreams));
      comparison = {
        period:      { start: wStart, end: now },
        priorPeriod: { start: prior.start, end: prior.end },
        signups:    { prev: prevSignups,        delta: relDelta(signupsInWindow, prevSignups) },
        active:     { prev: prevActive,         delta: relDelta(activeInWindow, prevActive) },
        activation: { prev: priorActivation.rate, delta: relDelta(activation.rate, priorActivation.rate) },
      };
    }

    res.json({
      status: 'success',
      data: {
        window,
        headlines: {
          signupsInWindow,
          signupsDelta: relDelta(signupsInWindow, prevSignups),
          activeInWindow,
          activeRate: totalUsers ? activeInWindow / totalUsers : 0,
          activationRate: activation.rate,
          newUsersInWindow: activation.cohort,
          activatedUsersInWindow: activation.activated,
        },
        comparison,
        dailySignups,
      },
    });
  } catch (err) {
    console.error('[reports/window] error:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ── GET /api/admin/reports/cbat?window=7d|30d|today|all ───────────────────────

router.get('/cbat', async (req, res) => {
  try {
    const window = req.query.window || '7d';
    const compare = req.query.compare === '1' || req.query.compare === 'true';
    const now = new Date();
    const wStart = windowStart(window);
    const prior = priorWindow(window);              // null for all-time
    const wantCompare = compare && !!prior;

    // Per-game streams + sessions-by-day, plus tutorial/practice usage and the
    // day/hour activity heatmap.
    const [games, tutorials, heatmap] = await Promise.all([
      cbatStreams(wStart),
      tutorialUsage(wStart),
      activityHeatmap(wStart),
    ]);

    // Total sessions and unique players in window — scored games only; tutorials
    // are a learning aid and stay out of the engagement headlines.
    const playerSet = new Set();
    let totalSessions = 0;
    for (const g of games) {
      for (const cnt of g.sessionsByDay.values()) totalSessions += cnt;
      for (const ev of g.events) playerSet.add(ev.userId);
    }
    const uniquePlayers = playerSet.size;

    // Daily sessions stacked by game (zero-filled) — scored games + tutorials,
    // so the tutorial series shows on the chart (greyed in the legend client-side).
    const gameKeys = games.map(g => g.key);
    const stackedKeys = [...gameKeys, ...tutorials.map(t => t.key)];
    // All-time: clamp the bucket start to the first day with real activity, so the
    // chart isn't a ~55-year empty span (windowStart('all') is the epoch) that
    // squashes the real bars into an invisible sliver at the right edge.
    let bucketStart = wStart;
    if (window === 'all') {
      const allDates = [
        ...games.flatMap(g => [...g.sessionsByDay.keys()]),
        ...tutorials.flatMap(t => [...t.sessionsByDay.keys()]),
      ].sort();
      bucketStart = allDates.length ? new Date(`${allDates[0]}T00:00:00Z`) : now;
    }
    const stackedDaily = emptyDailyBuckets(bucketStart, now, stackedKeys);
    for (const g of games) {
      for (const row of stackedDaily) {
        row[g.key] = g.sessionsByDay.get(row.date) ?? 0;
      }
    }
    for (const t of tutorials) {
      for (const row of stackedDaily) {
        row[t.key] = t.sessionsByDay.get(row.date) ?? 0;
      }
    }

    // Sessions-per-player distribution (over window).
    // Need per-user session counts across ALL CBAT games.
    const perUserCountsAgg = await Promise.all(
      Object.values(CBAT_GAMES).map(g => g.Model.aggregate([
        { $match: { ...(g.modeFilter ?? {}), createdAt: { $gte: wStart } } },
        { $group: { _id: '$userId', count: { $sum: 1 } } },
      ]))
    );
    const perUser = new Map(); // userId → totalSessions
    for (const rows of perUserCountsAgg) {
      for (const r of rows) {
        const k = String(r._id);
        perUser.set(k, (perUser.get(k) ?? 0) + r.count);
      }
    }
    const totalUsers = await User.countDocuments();
    const buckets = { '0': 0, '1': 0, '2-4': 0, '5-9': 0, '10+': 0 };
    let activeWithCbat = 0;
    for (const cnt of perUser.values()) {
      activeWithCbat++;
      if (cnt === 1) buckets['1']++;
      else if (cnt <= 4) buckets['2-4']++;
      else if (cnt <= 9) buckets['5-9']++;
      else buckets['10+']++;
    }
    buckets['0'] = Math.max(0, totalUsers - activeWithCbat);
    const sessionsPerPlayerBuckets = Object.entries(buckets).map(([bucket, users]) => ({ bucket, users }));

    // D1 / D7 retention: of users whose first-EVER CBAT session is in window,
    // % who played another CBAT session ≥24h (D1) or ≥7d (D7) later.
    const firstSessionByUser = new Map(); // userId → earliest createdAt across all CBAT
    const allFirstAgg = await Promise.all(
      Object.values(CBAT_GAMES).map(g => g.Model.aggregate([
        ...(g.modeFilter ? [{ $match: g.modeFilter }] : []),
        { $group: { _id: '$userId', first: { $min: '$createdAt' }, last: { $max: '$createdAt' } } },
      ]))
    );
    const userLast = new Map();
    for (const rows of allFirstAgg) {
      for (const r of rows) {
        const k = String(r._id);
        if (!firstSessionByUser.has(k) || r.first < firstSessionByUser.get(k)) firstSessionByUser.set(k, r.first);
        if (!userLast.has(k) || r.last > userLast.get(k)) userLast.set(k, r.last);
      }
    }
    let cohort = 0, retainedD1 = 0, retainedD7 = 0;
    for (const [userId, first] of firstSessionByUser.entries()) {
      if (first < wStart) continue;
      cohort++;
      const last = userLast.get(userId);
      if (last && (last - first) >= DAY_MS)        retainedD1++;
      if (last && (last - first) >= 7 * DAY_MS)    retainedD7++;
    }
    const d1Retention = cohort ? retainedD1 / cohort : 0;
    const d7Retention = cohort ? retainedD7 / cohort : 0;

    // ── Prior-period comparison (gated behind compare + a prior period existing) ──
    // Reuses the all-time first/last maps above for retention, so only the
    // windowed session streams need an extra fetch.
    let comparison = null;
    let prevSessionsByGame = new Map();
    if (wantCompare) {
      const priorGames = await cbatStreams(prior.start, prior.end);
      const prevPlayerSet = new Set();
      const prevDailyTotal = new Map();      // date → total sessions across games
      let prevTotalSessions = 0;
      for (const g of priorGames) {
        let gTotal = 0;
        for (const [date, cnt] of g.sessionsByDay) {
          gTotal += cnt;
          prevTotalSessions += cnt;
          prevDailyTotal.set(date, (prevDailyTotal.get(date) ?? 0) + cnt);
        }
        prevSessionsByGame.set(g.key, gTotal);
        for (const ev of g.events) prevPlayerSet.add(ev.userId);
      }

      // Prior cohort retention — same definition, prior signup-of-first-play window.
      let pCohort = 0, pD1 = 0, pD7 = 0;
      for (const [userId, first] of firstSessionByUser.entries()) {
        if (first < prior.start || first >= prior.end) continue;
        pCohort++;
        const last = userLast.get(userId);
        if (last && (last - first) >= DAY_MS)     pD1++;
        if (last && (last - first) >= 7 * DAY_MS) pD7++;
      }
      const prevD1 = pCohort ? pD1 / pCohort : 0;
      const prevD7 = pCohort ? pD7 / pCohort : 0;

      // Overlay prior daily totals onto the current buckets, aligned by day-offset.
      const priorBuckets = emptyDailyBuckets(prior.start, new Date(prior.end.getTime() - DAY_MS));
      stackedDaily.forEach((row, i) => {
        const pb = priorBuckets[i];
        row._prevTotal = pb ? (prevDailyTotal.get(pb.date) ?? 0) : 0;
      });

      comparison = {
        period:      { start: wStart, end: now },
        priorPeriod: { start: prior.start, end: prior.end },
        totalSessions: { prev: prevTotalSessions,    delta: relDelta(totalSessions, prevTotalSessions) },
        uniquePlayers: { prev: prevPlayerSet.size,   delta: relDelta(uniquePlayers, prevPlayerSet.size) },
        d1Retention:   { prev: prevD1,               delta: relDelta(d1Retention, prevD1) },
        d7Retention:   { prev: prevD7,               delta: relDelta(d7Retention, prevD7) },
      };
    }

    // Per-game table: sessions, unique players, avg per player, abandon %.
    const perGame = await Promise.all(games.map(async g => {
      const sessions = Array.from(g.sessionsByDay.values()).reduce((s, n) => s + n, 0);
      const players = new Set(g.events.map(e => e.userId)).size;
      // Abandon % = (starts - results) / starts within window.
      const cfg = CBAT_GAMES[g.key];
      const [starts, results] = await Promise.all([
        GameSessionCbatStart.countDocuments({ gameKey: g.key, startedAt: { $gte: wStart } }),
        cfg.Model.countDocuments({ ...(cfg.modeFilter ?? {}), createdAt: { $gte: wStart } }),
      ]);
      const abandoned = Math.max(0, starts - results);
      const abandonPct = starts ? abandoned / starts : 0;
      const prevSessions = wantCompare ? (prevSessionsByGame.get(g.key) ?? 0) : null;
      return {
        key: g.key,
        label: g.label,
        sessions,
        players,
        avgPerPlayer: players ? sessions / players : 0,
        starts,
        abandonPct,
        ...(wantCompare ? { prevSessions, sessionsDelta: relDelta(sessions, prevSessions) } : {}),
      };
    }));
    // Append tutorial rows (Abandon % = didn't finish the tutorial) so they sit
    // in the per-game table alongside the real games, greyed client-side.
    for (const t of tutorials) {
      perGame.push({
        key: t.key,
        label: t.label,
        sessions: t.sessions,
        players: t.players,
        avgPerPlayer: t.avgPerPlayer,
        starts: t.starts,
        abandonPct: t.abandonPct,
        isTutorial: true,
      });
    }
    perGame.sort((a, b) => b.sessions - a.sessions);

    // Keys whose names render greyed on the Reports page (tutorial + practice).
    const practiceKeys = [...tutorials.map(t => t.key), ...PRACTICE_GAME_KEYS];

    res.json({
      status: 'success',
      data: {
        window,
        headlines: {
          totalSessions,
          uniquePlayers,
          d1Retention,
          d7Retention,
          cohortSize: cohort,
          totalUsers,
        },
        comparison,
        dailySessions: stackedDaily,
        gameKeys: stackedKeys,
        gameLabels: {
          ...Object.fromEntries(games.map(g => [g.key, g.label])),
          ...Object.fromEntries(tutorials.map(t => [t.key, t.label])),
        },
        practiceKeys,
        activityHeatmap: heatmap,
        sessionsPerPlayerBuckets,
        perGame,
        tutorials: tutorials.map(t => ({
          key: t.key,
          label: t.label,
          gameKey: t.gameKey,
          sessions: t.sessions,
          players: t.players,
          completed: t.completed,
          completionRate: t.completionRate,
          totalSteps: t.totalSteps,
          funnel: t.funnel,
        })),
      },
    });
  } catch (err) {
    console.error('[reports/cbat] error:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
