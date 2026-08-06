'use strict';

/**
 * Strip Discord markdown escaping out of medal messages already posted to the
 * in-app Medals channel.
 *
 * agentLabel() used to escape markdown at labelling time, for Discord's
 * benefit. The chat feed renders plain text, so a display name like
 * SkyWatch_Dev reached the channel as "SkyWatch\_Dev". The escaping now happens
 * at the Discord sink instead, but messages posted before that fix still carry
 * the backslashes.
 *
 * Only unescapes the characters escapeMarkdown() ever inserted, and only where
 * a backslash directly precedes one of them — so a name that genuinely contains
 * a backslash is left alone.
 *
 * Idempotent: a second run finds nothing to change.
 */

const ChatConversation = require('../models/ChatConversation');
const ChatMessage      = require('../models/ChatMessage');

const MEDALS_CHANNEL_SLUG = 'medals';

// The exact set escapeMarkdown() escapes: \ * _ ~ ` | [ ]
const ESCAPED = /\\([\\*_~`|[\]])/g;

async function unescapeMedalMessages({ logger = console } = {}) {
  const channel = await ChatConversation.findOne({
    type: 'channel', 'channel.slug': MEDALS_CHANNEL_SLUG,
  }).select('_id').lean();
  if (!channel) return { scanned: 0, fixed: 0 };

  const messages = await ChatMessage.find({
    conversationId: channel._id,
    body: { $regex: '\\\\' },
  }).select('_id body').lean();

  let fixed = 0;
  for (const m of messages) {
    const next = m.body.replace(ESCAPED, '$1');
    if (next === m.body) continue;
    await ChatMessage.updateOne({ _id: m._id }, { $set: { body: next } });
    fixed += 1;
  }

  if (fixed) {
    logger?.log?.(`[migration] unescapeMedalMessages: fixed ${fixed} medal message(s)`);
  }
  return { scanned: messages.length, fixed };
}

module.exports = unescapeMedalMessages;
