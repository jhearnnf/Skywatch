'use strict';

/**
 * The in-app half of medal announcements: posting a podium finish into the
 * Medals channel as the Medal Bot.
 *
 * The sibling of medals.js, which owns detection (detectCbatMedal); this module
 * owns only the "what it says and where it lands" part.
 *
 * Three things it must never do:
 *   • Break a score submission. Every entry point is fire-and-forget.
 *   • Leak an email address. Agents are named exactly as the leaderboard names
 *     them — display name, else agent number.
 *   • Notify anyone. The channel ships with notifications off: a badge on every
 *     podium finish would train people to ignore the dot, costing it its
 *     meaning in every other channel too. Admins can turn it on per channel.
 */

const ChatConversation = require('../models/ChatConversation');
const ChatMessage      = require('../models/ChatMessage');

const MEDALS_CHANNEL_SLUG = 'medals';

// Cached briefly: this is consulted on every CBAT score submission, and the
// answer changes only when an admin edits the channel.
const CACHE_MS = 60_000;
let cache = { at: 0, channel: null };

function resetChatMedalsCache() {
  cache = { at: 0, channel: null };
}

// The live Medals channel, or null. A channel with no bot assigned is treated
// as off rather than posted into as somebody else.
async function medalsChannel() {
  if (Date.now() - cache.at < CACHE_MS) return cache.channel;
  const channel = await ChatConversation.findOne({
    type: 'channel',
    isArchived: false,
    'channel.slug': MEDALS_CHANNEL_SLUG,
    'channel.postBotUserId': { $ne: null },
  }).lean();
  cache = { at: Date.now(), channel: channel ?? null };
  return cache.channel;
}

async function chatMedalsEnabled() {
  return Boolean(await medalsChannel());
}

function ordinalPlace(rank) {
  return { 1: '1st', 2: '2nd', 3: '3rd' }[rank] ?? `${rank}th`;
}

// Plain sentence, no markdown: the chat renders text, and the medal emoji is
// carried by the message rather than by formatting.
function buildMedalMessage({ medal, gameLabel, agent, score, previousRank }) {
  const moved = previousRank && previousRank > 0
    ? ` Up from ${ordinalPlace(previousRank)}.`
    : '';
  return `${medal.emoji} ${agent} took ${medal.word} on ${gameLabel} with ${score}.${moved}`;
}

/**
 * Post one medal into the Medals channel.
 * @param {Object} detail from detectCbatMedal()
 */
async function postMedalToChannel(detail) {
  try {
    const channel = await medalsChannel();
    if (!channel) return null;

    const body = buildMedalMessage(detail);
    const botId = channel.channel.postBotUserId;

    const message = await ChatMessage.create({
      conversationId:    channel._id,
      senderUserId:      botId,
      senderRole:        'user',
      body,
      senderDisplayName: 'Medal Bot',
    });

    // Mirrors appendMessage() in routes/chat.js. Not imported from there
    // because that module is an Express router — requiring it from a util that
    // a score submission reaches would drag the whole route tree into the
    // request path and risk a cycle.
    await ChatConversation.updateOne(
      { _id: channel._id },
      {
        $set: { lastMessageAt: message.createdAt, lastMessageSenderRole: 'user' },
        $inc: { messageCount: 1 },
      },
    );

    return message;
  } catch (err) {
    console.error(`[medals] channel post failed: ${err.message}`);
    return null;
  }
}

module.exports = {
  postMedalToChannel,
  chatMedalsEnabled,
  buildMedalMessage,
  resetChatMedalsCache,
  MEDALS_CHANNEL_SLUG,
};
