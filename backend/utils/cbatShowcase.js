// The landing page's proof wall: for a few CBAT games, one real player's score
// history and how far they've come since their first runs.
//
// Nothing here is generated or padded — unlike the leaderboards, which top up a
// quiet board with demo rows (utils/cbatFakeLeaderboard.js), a panel is either a
// real player's real runs or it is omitted. The page says "real players", so a
// synthetic line would be a lie rather than a placeholder.
//
// SELECTION. Per game: rank every player by their best score (the same ordering
// the all-time board uses), take the top POOL_SIZE, shuffle, and walk that
// shuffled list until one player has a chartable history. So the wall shows a
// different player on every page load rather than the same three forever, and
// the pool is small enough that everyone in it is worth showing.
//
// WHO IS EXCLUDED. Admin and banned accounts, anyone who has opted out
// (`hideFromShowcase`), plus EXCLUDED_DISPLAY_NAMES — the dev account plays
// partial runs while testing, which litter its history with zero scores and
// make the chart read as a player falling apart.
//
// WHAT QUALIFIES. A candidate needs MIN_ATTEMPTS runs and a first-vs-last
// improvement of at least MIN_IMPROVEMENT_PCT. That second filter is a
// selection rule, not a data edit: every number shown is that player's own, but
// the wall is deliberately showing players who improved, because that is the
// claim the section makes. Players who plateaued or dipped are skipped, not
// rewritten.
//
// WHAT IT DELIBERATELY DOES NOT RETURN. This is the one place CBAT scores leave
// the members-only side of the app — every leaderboard route is behind
// `protect`, and this one is open to the internet and its crawlers. So it is
// minimised to what the claim actually needs:
//   • no display name — players are named by agent number only, the same
//     fallback the in-app boards use for a player who hasn't set a name;
//   • no timestamps — a dated series is an activity log (which evenings someone
//     plays, how long their sessions run) and the wall only ever needed "this
//     took time", so it ships `spanDays` and an order, not clock times;
//   • no account id (see buildCbatShowcase).
// Run counts and scores stay: they are what make the percentage checkable, and
// neither identifies anyone on its own.

const { CBAT_GAMES } = require('../constants/cbatGames');

// The games the wall draws from, in the order the panels are rendered.
const SHOWCASE_GAME_KEYS = ['target', 'dpt', 'flag'];

const POOL_SIZE = 10;        // "top ten on the leaderboard"
// Ranked rows are fetched before the exclusions can be applied (they need the
// joined user doc), so over-fetch and let a dropped row be replaced by the next
// real player rather than shrinking the pool.
const POOL_OVERFETCH = 40;

const TREND_WINDOW = 5;      // runs averaged at each end for the improvement figure
// Two disjoint windows of TREND_WINDOW. At fewer runs the "first five" and
// "last five" share runs, which quietly flattens the improvement it claims to
// measure.
const MIN_ATTEMPTS = TREND_WINDOW * 2;
const MIN_IMPROVEMENT_PCT = 5;

const MAX_HISTORY = 200;     // runs read per candidate — "since the beginning" needs the earliest
const MAX_SERIES_POINTS = 60; // points sent to the client; beyond this a card-sized chart is mush
const MAX_CANDIDATE_READS = 4; // history reads per game before giving up on a panel

const EXCLUDED_DISPLAY_NAMES = ['skywatch_dev'];

// This is a public, uncached-by-the-browser endpoint on the busiest page, so the
// expensive halves are memoised: the ranked pool and each candidate's history.
// The random pick happens per request on top of the cached pool, so a refresh
// still swaps the player without touching Mongo.
const CACHE_TTL_MS = 5 * 60 * 1000;
const poolCache = new Map();    // gameKey -> { at, pool }
const historyCache = new Map(); // `${gameKey}:${userId}` -> { at, history }

function cacheGet(cache, key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(cache, key, value) {
  // Sweep on write — the maps are tiny (games × POOL_SIZE) and this keeps a
  // long-lived process from holding histories for players who left the board.
  const now = Date.now();
  for (const [k, v] of cache) if (now - v.at > CACHE_TTL_MS) cache.delete(k);
  cache.set(key, { at: now, value });
}

// Exposed for tests, which need a clean slate between cases.
function clearShowcaseCache() {
  poolCache.clear();
  historyCache.clear();
}

// The top POOL_SIZE players on one game's all-time board, best score first.
async function loadPool(cfg, gameKey) {
  const cached = cacheGet(poolCache, gameKey);
  if (cached) return cached;

  const modeFilter = cfg.modeFilter ?? null;
  const pool = await cfg.Model.aggregate([
    ...(modeFilter ? [{ $match: modeFilter }] : []),
    {
      $group: {
        _id: '$userId',
        best: { [cfg.bestOp]: `$${cfg.primaryField}` },
        attempts: { $sum: 1 },
      },
    },
    { $sort: { best: cfg.sortDir } },
    { $limit: POOL_OVERFETCH },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
    // $unwind drops results whose account has been deleted.
    { $unwind: '$user' },
    {
      $match: {
        'user.isAdmin': { $ne: true },
        'user.isBanned': { $ne: true },
        // A player's own objection, set from Profile › Settings. `$ne: true`
        // rather than `false` so accounts predating the field are included.
        'user.hideFromShowcase': { $ne: true },
        // Matched on the lowercased name rather than displayNameLower, which is
        // only written by the rename route and so is absent on some accounts.
        $expr: {
          $not: [{ $in: [{ $toLower: { $ifNull: ['$user.displayName', ''] } }, EXCLUDED_DISPLAY_NAMES] }],
        },
      },
    },
    { $limit: POOL_SIZE },
    // displayName is used by the exclusion $match above but deliberately not
    // projected — it must not travel any further than this pipeline.
    {
      $project: {
        _id: 0,
        userId: '$_id',
        best: 1,
        attempts: 1,
        agentNumber: '$user.agentNumber',
      },
    },
  ]);

  cacheSet(poolCache, gameKey, pool);
  return pool;
}

// One player's runs on one game, oldest first — the whole history, because the
// improvement figure is measured against where they started.
async function loadHistory(cfg, gameKey, userId) {
  const key = `${gameKey}:${userId}`;
  const cached = cacheGet(historyCache, key);
  if (cached) return cached;

  const rows = await cfg.Model.find({ ...(cfg.modeFilter ?? {}), userId })
    .select(`${cfg.primaryField} createdAt`)
    .sort({ createdAt: 1 })
    .limit(MAX_HISTORY)
    .lean();

  const history = rows.map(r => ({ score: r[cfg.primaryField], at: r.createdAt }));
  cacheSet(historyCache, key, history);
  return history;
}

// Evenly thins a long history down to `max` points, always keeping the first and
// last run — those two are what the improvement figure compares.
function downsample(series, max = MAX_SERIES_POINTS) {
  if (series.length <= max) return series;
  const step = (series.length - 1) / (max - 1);
  const out = [];
  for (let i = 0; i < max; i++) out.push(series[Math.round(i * step)]);
  return out;
}

const average = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

// The improvement reading for one history, or null when there isn't an honest
// one to give. Sign is normalised so a positive percentage always means "got
// better", including on a lower-is-better game.
function readImprovement(cfg, history) {
  if (history.length < MIN_ATTEMPTS) return null;

  const scores = history.map(p => p.score);
  const firstAvg = average(scores.slice(0, TREND_WINDOW));
  const lastAvg = average(scores.slice(-TREND_WINDOW));

  // A baseline of zero has no percentage, and a negative one inverts the
  // arithmetic — going from -20 to 100 is not "600% better" in any sense a
  // visitor would read correctly. Both are skipped rather than shown.
  if (firstAvg <= 0) return null;

  const lowerIsBetter = cfg.sortDir === 1;
  const gain = lowerIsBetter ? firstAvg - lastAvg : lastAvg - firstAvg;
  const improvementPct = Math.round((gain / firstAvg) * 100);
  if (improvementPct < MIN_IMPROVEMENT_PCT) return null;

  return {
    improvementPct,
    firstAvg: Math.round(firstAvg),
    lastAvg: Math.round(lastAvg),
  };
}

// Fisher-Yates. `random` is injectable so tests can pin the pick.
function shuffle(arr, random) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// One panel for one game, or null when nobody in the pool qualifies.
//
// `taken` holds the players already on the wall. A wall of three panels reads as
// three people improving, so an unseen player is tried before a repeat — but a
// repeat is still better than a missing panel, since the top of a small board is
// genuinely the same handful of people.
async function buildPanel(gameKey, random, taken) {
  const cfg = CBAT_GAMES[gameKey];
  if (!cfg) return null;

  const eligible = (await loadPool(cfg, gameKey)).filter(p => p.attempts >= MIN_ATTEMPTS);
  const pool = shuffle(eligible, random);
  const candidates = [
    ...pool.filter(p => !taken.has(String(p.userId))),
    ...pool.filter(p => taken.has(String(p.userId))),
  ].slice(0, MAX_CANDIDATE_READS);

  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop -- candidates are tried in order; the first qualifier wins
    const history = await loadHistory(cfg, gameKey, candidate.userId);
    const improvement = readImprovement(cfg, history);
    if (!improvement) continue;

    return {
      gameKey,
      userId: candidate.userId,
      name: `Agent ${candidate.agentNumber || '???'}`,
      attempts: candidate.attempts,
      best: candidate.best,
      lowerIsBetter: cfg.sortDir === 1,
      // How long the improvement took, in whole days — the only thing the wall
      // says about time. The client rounds it to weeks or months before showing
      // it, and no individual run carries a date.
      spanDays: Math.round((new Date(history[history.length - 1].at) - new Date(history[0].at)) / 86400000),
      ...improvement,
      series: downsample(history).map(p => ({ score: p.score })),
    };
  }

  return null;
}

// The wall. Games with no qualifying player are simply absent — the page renders
// however many panels it gets. Built one game at a time so each panel knows who
// the earlier ones already used; the reads behind it are cached, so the cost of
// giving up the parallelism is a few cache hits.
async function buildCbatShowcase({ gameKeys = SHOWCASE_GAME_KEYS, random = Math.random } = {}) {
  const taken = new Set();
  const panels = [];

  for (const gameKey of gameKeys) {
    // eslint-disable-next-line no-await-in-loop -- each panel depends on who the previous ones picked
    const panel = await buildPanel(gameKey, random, taken);
    if (!panel) continue;
    taken.add(String(panel.userId));
    // userId is internal — the wall names players, it doesn't identify accounts.
    const { userId, ...publicPanel } = panel;
    panels.push(publicPanel);
  }

  return panels;
}

module.exports = {
  buildCbatShowcase,
  clearShowcaseCache,
  SHOWCASE_GAME_KEYS,
  MIN_ATTEMPTS,
  MIN_IMPROVEMENT_PCT,
  TREND_WINDOW,
  POOL_SIZE,
};
