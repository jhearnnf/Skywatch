'use strict';

/**
 * Name the difficulty on medal messages already posted to the Medals channel.
 *
 * Messages used to be built from the registry label, which says "(Easier)" on
 * the Easier half of a split game and nothing at all on the Hard half. So the
 * channel reads "took Gold on FLAG (Easier)" one line and "took Gold on FLAG"
 * the next, which looks like one board rather than two. Detection now qualifies
 * both halves (cbatLabelWithDifficulty), but posted history still doesn't.
 *
 * Safe to backfill because the old messages are unambiguous: before the change,
 * a bare "FLAG" could only have come from the `flag` key — the Easier one always
 * carried its suffix. So a bare label maps to Hard and nothing else.
 *
 * Only rewrites the game name between " on " and " with ", which is exactly
 * where buildMedalMessage puts it, so a display name that happens to contain a
 * game's name is untouched.
 *
 * Idempotent: a message already saying "(Hard)" no longer matches.
 */

const ChatConversation = require('../models/ChatConversation');
const ChatMessage      = require('../models/ChatMessage');
const { CBAT_GAMES }   = require('../constants/cbatGames');

const MEDALS_CHANNEL_SLUG = 'medals';

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// [{ from: / on FLAG with /, to: ' on FLAG (Hard) with ' }, …] — one per split
// game, derived from the registry so a new split game is covered by its entry.
function hardLabelRewrites() {
  return Object.keys(CBAT_GAMES)
    .filter(key => key.endsWith('-easier'))
    .map(key => CBAT_GAMES[key.replace(/-easier$/, '')])
    .filter(Boolean)
    .map(cfg => ({
      pattern: new RegExp(` on ${escapeRegex(cfg.label)} with `),
      replacement: ` on ${cfg.label} (Hard) with `,
    }));
}

async function labelMedalDifficulty({ logger = console } = {}) {
  const channel = await ChatConversation.findOne({
    type: 'channel', 'channel.slug': MEDALS_CHANNEL_SLUG,
  }).select('_id').lean();
  if (!channel) return { scanned: 0, fixed: 0 };

  const rewrites = hardLabelRewrites();
  const messages = await ChatMessage.find({ conversationId: channel._id })
    .select('_id body').lean();

  let fixed = 0;
  for (const m of messages) {
    let next = m.body;
    for (const { pattern, replacement } of rewrites) {
      next = next.replace(pattern, replacement);
    }
    if (next === m.body) continue;
    await ChatMessage.updateOne({ _id: m._id }, { $set: { body: next } });
    fixed += 1;
  }

  if (fixed) {
    logger?.log?.(`[migration] labelMedalDifficulty: qualified ${fixed} medal message(s)`);
  }
  return { scanned: messages.length, fixed };
}

module.exports = labelMedalDifficulty;
