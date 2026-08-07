'use strict';

/**
 * A daily ceiling on what the guide bot may spend.
 *
 * The per-user and per-channel rate limits in routes/chat.js bound a BURST —
 * one person cannot hold down Enter and empty the account in a minute. They do
 * not bound a day: a busy channel of ordinary users, each within their quota,
 * has no ceiling at all. At the measured ~$0.0168 a reply that adds up quickly,
 * and the first sign of it would be a dead OpenRouter key taking every other AI
 * feature in the app down with it.
 *
 * So this is a blast-radius limit, not a cost optimiser. Retrieval
 * (utils/cbatGuideRetrieval.js) is what makes replies cheap; this is what stops
 * a bad day becoming a bill.
 *
 * Counted from OpenRouterUsageLog, which already records the real dollar cost
 * OpenRouter reports per call, tagged by feature — so the ceiling is measured
 * against actual spend rather than an estimate that could drift from it.
 */

const OpenRouterUsageLog = require('../models/OpenRouterUsageLog');

const FEATURE = 'chatbot';

// Deliberately low. At post-retrieval prices this is on the order of a couple
// of hundred replies a day, well above real use and far below anything that
// would matter on the bill.
const DEFAULT_DAILY_LIMIT_USD = 2;

// Aggregating on every message would put a scan in front of every reply. The
// window is short because the cost of being stale is bounded: see the overshoot
// note on noteBotSpend below.
const CACHE_MS = 30_000;

let cache = { day: null, at: 0, spent: 0 };

function dailyLimitUsd() {
  const raw = Number(process.env.CHATBOT_DAILY_USD_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DAILY_LIMIT_USD;
}

// UTC, so the reset point is the same wherever the process runs and does not
// move twice a year.
function dayStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

const dayKey = (now) => dayStart(now).toISOString().slice(0, 10);

/**
 * What the bot has cost so far today, in USD.
 */
async function spentToday(now = new Date()) {
  const key = dayKey(now);
  if (cache.day === key && Date.now() - cache.at < CACHE_MS) return cache.spent;

  const [row] = await OpenRouterUsageLog.aggregate([
    { $match: { feature: FEATURE, createdAt: { $gte: dayStart(now) } } },
    { $group: { _id: null, spent: { $sum: '$costUsd' } } },
  ]);

  cache = { day: key, at: Date.now(), spent: row?.spent ?? 0 };
  return cache.spent;
}

/**
 * Add a just-incurred cost to the cached figure.
 *
 * The usage log is written fire-and-forget after the model call, so within one
 * cache window a burst of replies would otherwise all read the same stale total
 * and none of them would see the ceiling coming. This keeps the running figure
 * honest between refreshes; the aggregate is still the source of truth on the
 * next one.
 */
function noteBotSpend(usd) {
  if (!Number.isFinite(usd) || usd <= 0) return;
  if (!cache.day) return;   // nothing cached yet; the next read aggregates anyway
  cache.spent += usd;
}

/**
 * Has the bot spent its allowance for today?
 *
 * Never throws: a database hiccup must not silence the bot, so an error here
 * answers "not over budget" and leaves the rate limiters as the guard.
 */
async function overDailyBudget(now = new Date()) {
  try {
    return (await spentToday(now)) >= dailyLimitUsd();
  } catch {
    return false;
  }
}

// Tests need a clean slate between cases.
function _resetCacheForTests() {
  cache = { day: null, at: 0, spent: 0 };
}

module.exports = {
  FEATURE,
  DEFAULT_DAILY_LIMIT_USD,
  dailyLimitUsd,
  dayStart,
  spentToday,
  noteBotSpend,
  overDailyBudget,
  _resetCacheForTests,
};
