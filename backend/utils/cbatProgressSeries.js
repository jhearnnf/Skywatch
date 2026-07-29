// One user's chronological score series for one CBAT game.
//
// Shared by the player-facing GET /api/games/cbat/:gameKey/progress (post-game sparkline +
// leaderboard "You" tab) and the admin Users panel's per-user score graph. Both draw the same
// chart from the same numbers, so the window/trend rules live here rather than in two routes
// that would eventually disagree about what "improving" means.
//
// Only finished runs exist in the result collections (starts live in GameSessionCbatStart), so
// the series is finished attempts only — which is what "am I improving?" wants.
//
// `attempts` is the true lifetime count, NOT series.length: the series is capped at `limit`
// (most recent), so a user with 200 runs still sees "200 attempts" under a 50-point chart.
// firstAvg/lastAvg are computed over the returned window for the same reason — they describe the
// chart being looked at.

const PROGRESS_TREND_WINDOW = 5;   // attempts averaged at each end for the first-vs-last delta
const PROGRESS_MIN_FOR_TREND = 6;  // fewer than this and the delta is noise, so we omit it
// Two points is a line between two dots — it implies a trend that isn't there yet, so nothing is
// charted below three runs. The player-facing "You" tab uses the same floor.
const PROGRESS_MIN_FOR_CHART = 3;
const PROGRESS_DEFAULT_LIMIT = 50;
const PROGRESS_MAX_LIMIT = 200;

// Clamps a caller-supplied ?limit into the range the chart can actually render.
function parseProgressLimit(raw) {
  return Math.min(parseInt(raw, 10) || PROGRESS_DEFAULT_LIMIT, PROGRESS_MAX_LIMIT);
}

// cfg is a CBAT_GAMES entry. Returns { attempts, series, best, firstAvg, lastAvg } — the same
// shape whether or not the user has ever played (empty series, nulls throughout).
async function buildCbatProgress(cfg, userId, limit = PROGRESS_DEFAULT_LIMIT) {
  const query = { ...(cfg.modeFilter ?? {}), userId };

  // Take the most recent `limit` (descending + limit uses the { userId: 1, createdAt: -1 } index
  // every result model carries), then flip to chronological for plotting.
  const recent = await cfg.Model.find(query)
    .select(`${cfg.primaryField} totalTime createdAt`)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  const series = recent.reverse().map(s => ({
    score: s[cfg.primaryField],
    time: s.totalTime ?? null,
    at: s.createdAt,
  }));

  if (!series.length) {
    return { attempts: 0, series: [], best: null, firstAvg: null, lastAvg: null };
  }

  const attempts = await cfg.Model.countDocuments(query);
  const scores = series.map(p => p.score);
  const best = cfg.sortDir === 1 ? Math.min(...scores) : Math.max(...scores);

  // Averaged ends of the window — a rolling comparison that survives one fluke run at either end.
  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const hasTrend = series.length >= PROGRESS_MIN_FOR_TREND;

  return {
    attempts,
    series,
    best,
    firstAvg: hasTrend ? avg(scores.slice(0, PROGRESS_TREND_WINDOW)) : null,
    lastAvg:  hasTrend ? avg(scores.slice(-PROGRESS_TREND_WINDOW))  : null,
  };
}

module.exports = {
  buildCbatProgress,
  parseProgressLimit,
  PROGRESS_TREND_WINDOW,
  PROGRESS_MIN_FOR_TREND,
  PROGRESS_MIN_FOR_CHART,
};
