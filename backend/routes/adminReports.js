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
const { CBAT_GAMES } = require('../constants/cbatGames');

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
async function dailyCount(Model, dateField, since, extraMatch = {}) {
  const match = { ...extraMatch, ...(since ? { [dateField]: { $gte: since } } : {}) };
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
async function dailyDistinctUsers(Model, dateField, userField, since, extraMatch = {}) {
  const match = { ...extraMatch, ...(since ? { [dateField]: { $gte: since } } : {}) };
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
async function activityStreams(since) {
  const cbatStreams = await Promise.all(
    Object.values(CBAT_GAMES).map(g => dailyDistinctUsers(g.Model, 'createdAt', 'userId', since, g.modeFilter ?? {}))
  );
  const [quiz, boo, wta, flash, apt, briefs] = await Promise.all([
    dailyDistinctUsers(GameSessionQuizAttempt,         'timeStarted', 'userId', since),
    dailyDistinctUsers(GameSessionOrderOfBattleResult, 'createdAt',   'userId', since),
    dailyDistinctUsers(GameSessionWhereAircraftResult, 'createdAt',   'userId', since),
    dailyDistinctUsers(GameSessionFlashcardRecallResult,'createdAt',  'userId', since),
    dailyDistinctUsers(AptitudeSyncUsage,              'createdAt',   'userId', since),
    dailyDistinctUsers(IntelligenceBriefRead,          'createdAt',   'userId', since),
  ]);
  return [...cbatStreams, quiz, boo, wta, flash, apt, briefs];
}

// CBAT-only event streams (used by /cbat).
async function cbatStreams(since) {
  return Promise.all(
    Object.entries(CBAT_GAMES).map(async ([key, g]) => ({
      key,
      label: g.label,
      events: await dailyDistinctUsers(g.Model, 'createdAt', 'userId', since, g.modeFilter ?? {}),
      // also need raw count per day (sessions, not distinct-users)
      sessionsByDay: await dailyCount(g.Model, 'createdAt', since, g.modeFilter ?? {}),
    }))
  );
}

// ── GET /api/admin/reports/snapshot ───────────────────────────────────────────
// Time-period-fixed metrics that should NOT change with the window picker.
// Includes DAU (today), WAU (7d), MAU (30d), DAU 30d sparkline, signup source
// (all-time), subscription tiers (current snapshot), totals.

router.get('/snapshot', async (_req, res) => {
  try {
    const now = new Date();
    const sparkStart = new Date(now.getTime() - 29 * DAY_MS); // 30 days inclusive of today

    const [totalUsers, signupSourceAgg, subTierAgg] = await Promise.all([
      User.countDocuments(),
      User.aggregate([
        { $group: { _id: { $cond: [{ $ifNull: ['$googleId', false] }, 'google', 'email'] }, count: { $sum: 1 } } },
      ]),
      User.aggregate([
        { $group: { _id: '$subscriptionTier', count: { $sum: 1 } } },
      ]),
    ]);

    const streams = await activityStreams(sparkStart);
    const dailyMap = mergeDailyDistinctUsers(streams);

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
    const now = new Date();
    const wStart = windowStart(window);

    const [signupsInWindow, prevSignups] = await Promise.all([
      User.countDocuments({ createdAt: { $gte: wStart } }),
      (() => {
        const days = windowDays(window);
        if (!days) return Promise.resolve(0);
        const priorStart = new Date(wStart.getTime() - days * DAY_MS);
        return User.countDocuments({ createdAt: { $gte: priorStart, $lt: wStart } });
      })(),
    ]);

    // Activity streams limited to window for active-in-window calc.
    const streams = await activityStreams(wStart);
    const dailyMap = mergeDailyDistinctUsers(streams);
    const activeInWindow = (() => {
      const set = new Set();
      for (const users of dailyMap.values()) for (const u of users) set.add(u);
      return set.size;
    })();
    const totalUsers = await User.countDocuments();

    // Daily signups for window (zero-filled).
    const signupsByDay = await dailyCount(User, 'createdAt', wStart);
    const dailySignups = (window === 'all'
      ? Array.from(signupsByDay.entries()).sort().map(([date, count]) => ({ date, count }))
      : emptyDailyBuckets(wStart, now).map(b => ({
          date: b.date,
          count: signupsByDay.get(b.date) ?? 0,
        }))
    );

    // Activation: cohort = signups in window, % who played CBAT within 24h of signup.
    const newUsers = await User.find({ createdAt: { $gte: wStart } }).select('_id createdAt').lean();
    let activated = 0;
    if (newUsers.length > 0) {
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
      for (const u of newUsers) {
        const first = earliestPlay.get(String(u._id));
        if (first && (first - u.createdAt) <= DAY_MS) activated++;
      }
    }
    const activationRate = newUsers.length ? activated / newUsers.length : 0;

    res.json({
      status: 'success',
      data: {
        window,
        headlines: {
          signupsInWindow,
          signupsDelta: prevSignups > 0 ? (signupsInWindow - prevSignups) / prevSignups : null,
          activeInWindow,
          activeRate: totalUsers ? activeInWindow / totalUsers : 0,
          activationRate,
          newUsersInWindow: newUsers.length,
          activatedUsersInWindow: activated,
        },
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
    const now = new Date();
    const wStart = windowStart(window);

    // Per-game streams + sessions-by-day.
    const games = await cbatStreams(wStart);

    // Total sessions and unique players in window.
    const playerSet = new Set();
    let totalSessions = 0;
    for (const g of games) {
      for (const cnt of g.sessionsByDay.values()) totalSessions += cnt;
      for (const ev of g.events) playerSet.add(ev.userId);
    }
    const uniquePlayers = playerSet.size;

    // Daily sessions stacked by game (zero-filled).
    const gameKeys = games.map(g => g.key);
    const stackedDaily = emptyDailyBuckets(wStart, now, gameKeys);
    for (const g of games) {
      for (const row of stackedDaily) {
        row[g.key] = g.sessionsByDay.get(row.date) ?? 0;
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
      return {
        key: g.key,
        label: g.label,
        sessions,
        players,
        avgPerPlayer: players ? sessions / players : 0,
        starts,
        abandonPct,
      };
    }));
    perGame.sort((a, b) => b.sessions - a.sessions);

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
        dailySessions: stackedDaily,
        gameKeys,
        gameLabels: Object.fromEntries(games.map(g => [g.key, g.label])),
        sessionsPerPlayerBuckets,
        perGame,
      },
    });
  } catch (err) {
    console.error('[reports/cbat] error:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
