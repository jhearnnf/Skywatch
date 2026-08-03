// Discord medal broadcasts.
//
// When a player takes 1st, 2nd or 3rd on a CBAT game's all-time leaderboard, we
// post a celebration into the SkyWatch Discord. Only medals — ordinary scores
// stay on the site's Recent Scores feed, so the channel is worth having
// notifications on for.
//
// Three things this must never do:
//   • Break a score submission. Every entry point is fire-and-forget and
//     swallows its own errors; Discord being down is not the player's problem.
//   • Leak an email address. The channel is as public as the server it sits in,
//     so agents are named exactly as the leaderboard names them — display name,
//     else agent number.
//   • Let a display name reach into Discord. Names are user-controlled, so they
//     are markdown-escaped and every post disables mention parsing. Otherwise a
//     player called "@everyone" pings the whole server on every medal.
//
// Off unless BOTH the DISCORD_WEBHOOK_URL env var is set and an admin has turned
// on the kill switch (AppSettings.discordBroadcastEnabled). With either missing
// this module does nothing and costs nothing — the enable check runs before any
// ranking work.

const AppSettings = require('../models/AppSettings');
const User = require('../models/User');
const { CBAT_GAMES } = require('../constants/cbatGames');
const { rankOnPaddedBoard, isBetterScore } = require('./cbatBoardRank');

const MEDALS = {
  1: { emoji: '🥇', word: 'Gold', place: '1st', colour: 0xf5c542 },
  2: { emoji: '🥈', word: 'Silver', place: '2nd', colour: 0xc7d2de },
  3: { emoji: '🥉', word: 'Bronze', place: '3rd', colour: 0xcd7f32 },
};

// A replayed offline score can arrive days after it was set (the outbox stamps
// playedAt and cbatResult.js backdates createdAt). Celebrating it as news would
// be wrong, and the site's own Recent Scores feed uses the same 24h horizon.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const POST_TIMEOUT_MS = 5000;

// Field label for the score line, keyed by the registry's primaryField so a new
// game inherits a sensible label without touching this file.
const SCORE_LABEL = {
  totalScore: 'Score',
  correctCount: 'Correct',
  correctTurns: 'Correct turns',
  totalRotations: 'Rotations',
  correctPercentage: 'Accuracy',
};

let settingsCache = { value: null, at: 0 };
const SETTINGS_TTL_MS = 60 * 1000;

// Tests clear the database between cases, which would otherwise be masked by the
// cache above.
function resetDiscordCache() {
  settingsCache = { value: null, at: 0 };
}

function webhookUrl() {
  return (process.env.DISCORD_WEBHOOK_URL || '').trim();
}

async function broadcastEnabled() {
  const now = Date.now();
  if (settingsCache.value !== null && now - settingsCache.at < SETTINGS_TTL_MS) {
    return settingsCache.value;
  }
  const s = await AppSettings.findOne().select('discordBroadcastEnabled').lean();
  const enabled = s?.discordBroadcastEnabled === true;
  settingsCache = { value: enabled, at: now };
  return enabled;
}

// Neutralise Discord markdown in user-controlled text and flatten it to one line.
//
// Only characters that are special *inline* are escaped. `#`, `>` and `-` are
// markdown only at the start of a line, and a name always lands mid-sentence, so
// escaping them would just print stray backslashes in ordinary names like
// "Top-Gun". `[` and `]` are in the set on purpose: embed descriptions render
// [text](url) as a real link, so a display name could otherwise become a
// clickable link to anywhere.
function escapeMarkdown(text) {
  return String(text)
    .replace(/[\\*_~`|[\]]/g, m => `\\${m}`)
    .replace(/\s+/g, ' ')
    .trim();
}

// Exactly what the leaderboard shows: display name, else agent number. Never email.
function agentLabel(user) {
  if (user?.displayName) return escapeMarkdown(user.displayName);
  if (user?.agentNumber) return `Agent ${escapeMarkdown(user.agentNumber)}`;
  return 'An agent';
}

function formatScore(primaryField, value) {
  if (value === null || value === undefined) return '—';
  if (primaryField === 'correctPercentage') return `${Math.round(value)}%`;
  return Number(value).toLocaleString('en-GB');
}

function formatTime(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function ordinal(n) {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

// Resolve a result document back to its CBAT_GAMES key. Several games share one
// Model (plane-turn 2d/3d), so the registry's modeFilter is matched against the
// document's own fields rather than against anything the caller passes in.
function gameKeyForResult(Model, doc) {
  for (const [gameKey, cfg] of Object.entries(CBAT_GAMES)) {
    if (cfg.Model !== Model) continue;
    const filter = cfg.modeFilter ?? {};
    if (Object.entries(filter).every(([k, v]) => doc[k] === v)) return [gameKey, cfg];
  }
  return [null, null];
}

function buildMedalPayload({ medal, gameLabel, gameKey, agent, score, time, primaryField, previousRank }) {
  const fields = [
    { name: SCORE_LABEL[primaryField] || 'Score', value: formatScore(primaryField, score), inline: true },
  ];
  const timeText = formatTime(time);
  if (timeText) fields.push({ name: 'Time', value: timeText, inline: true });
  if (previousRank) {
    fields.push({ name: 'Previous position', value: ordinal(previousRank), inline: true });
  }

  const clientUrl = (process.env.CLIENT_URL || '').replace(/\/$/, '');

  return {
    username: 'SkyWatch',
    // Display names are user-controlled; escaping handles markdown, this handles pings.
    allowed_mentions: { parse: [] },
    content: `${medal.emoji} New ${medal.word.toLowerCase()} medal on ${gameLabel}`,
    embeds: [
      {
        title: `${medal.emoji} ${medal.word} medal — ${gameLabel}`,
        description: `**${agent}** is now ${medal.place} on the ${gameLabel} all-time leaderboard.`,
        color: medal.colour,
        ...(clientUrl ? { url: `${clientUrl}/cbat/${gameKey}/leaderboard?period=all-time` } : {}),
        fields,
        footer: { text: 'SkyWatch' },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

async function postToDiscord(payload) {
  const url = webhookUrl();
  if (!url) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`[discord] webhook returned ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[discord] webhook post failed: ${err.message}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Decide whether a freshly saved CBAT result earned a NEW medal, and post it.
//
// "New" is three conditions, all required:
//   1. the result is the player's new personal best on that game — the board is
//      best-per-user, so a run that doesn't beat their own best changes nothing;
//   2. its board position is top 3;
//   3. that position is better than the one their previous best held — otherwise
//      a player who already owns 1st would be re-announced every time they beat
//      their own score.
//
// Returns the payload it posted (or null), which is what the tests assert on.
// Never throws: the caller is a score submission.
async function announceCbatMedal(Model, doc) {
  try {
    if (!webhookUrl()) return null;
    if (!(await broadcastEnabled())) return null;

    const [gameKey, cfg] = gameKeyForResult(Model, doc);
    if (!cfg) return null;

    const achievedAt = doc.createdAt ? new Date(doc.createdAt).getTime() : Date.now();
    if (Date.now() - achievedAt > MAX_AGE_MS) return null;

    const score = doc[cfg.primaryField];
    const time = doc.totalTime;
    if (score === null || score === undefined) return null;

    const modeFilter = cfg.modeFilter ?? {};

    // The player's best BEFORE this run. Excluding by _id rather than by date
    // keeps backdated offline replays honest — an old score syncing in is
    // compared against everything else the player has, not just earlier rows.
    const [previousBest] = await Model.find({
      ...modeFilter,
      userId: doc.userId,
      _id: { $ne: doc._id },
    })
      .sort({ [cfg.primaryField]: cfg.sortDir, totalTime: 1 })
      .limit(1)
      .lean();

    if (previousBest && !isBetterScore(cfg, score, time, previousBest[cfg.primaryField], previousBest.totalTime)) {
      return null; // not a personal best — their board row is unchanged
    }

    const rank = await rankOnPaddedBoard(gameKey, cfg, { score, time, excludeUserId: doc.userId });
    const medal = MEDALS[rank];
    if (!medal) return null;

    let previousRank = null;
    if (previousBest) {
      previousRank = await rankOnPaddedBoard(gameKey, cfg, {
        score: previousBest[cfg.primaryField],
        time: previousBest.totalTime,
        excludeUserId: doc.userId,
      });
      if (previousRank <= rank) return null; // already held this medal or better
    }

    const user = await User.findById(doc.userId).select('displayName agentNumber').lean();

    const payload = buildMedalPayload({
      medal,
      gameLabel: cfg.label,
      gameKey,
      agent: agentLabel(user),
      score,
      time,
      primaryField: cfg.primaryField,
      previousRank,
    });

    await postToDiscord(payload);
    return payload;
  } catch (err) {
    console.error(`[discord] medal announcement failed: ${err.message}`);
    return null;
  }
}

module.exports = {
  announceCbatMedal,
  postToDiscord,
  resetDiscordCache,
  agentLabel,
  escapeMarkdown,
  gameKeyForResult,
  MEDALS,
};
