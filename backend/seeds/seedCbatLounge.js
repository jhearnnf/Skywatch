'use strict';

/**
 * The CBAT Lounge — the room behind the mini chat on the CBAT games hub.
 *
 * A real channel rather than a page-local message store, so it costs no new
 * model, shows up in Community like any other room, and inherits moderation,
 * reporting, mentions and the guide bot for free. The widget on /cbat is just a
 * second, smaller view of it.
 *
 * Two settings are deliberate:
 *
 *   • notifyMembers: false. This room is meant to be chatty, and it already has
 *     its own unread dot on the widget. Letting it badge the Community nav item
 *     as well would keep that dot permanently lit, which is how a dot stops
 *     meaning anything anywhere else. Same reasoning as the Medals feed.
 *   • order: 2. After Announcements (0) and General (1) in the rail — it is a
 *     side room, not the main one.
 *
 * Idempotent, and keyed on the slug EVER having existed rather than on it being
 * live right now: an admin who archives or deletes the room is not overruled on
 * the next deploy. Same guard as the Medals channel in seedChatBot.js.
 */

const ChatConversation = require('../models/ChatConversation');

const LOUNGE_SLUG = 'cbat-lounge';

async function seedCbatLounge() {
  const everExisted = await ChatConversation.exists({
    type: 'channel', 'channel.slug': LOUNGE_SLUG,
  });
  if (everExisted) return { created: false };

  await ChatConversation.create({
    type: 'channel',
    isArchived: false,
    channel: {
      name:          'CBAT Lounge',
      slug:          LOUNGE_SLUG,
      description:   'Live chat alongside the CBAT games. Ask @Guide Bot a quick question.',
      emoji:         '🛩️',
      order:         2,
      postPolicy:    'everyone',
      notifyMembers: false,
    },
  });
  return { created: true };
}

module.exports = seedCbatLounge;
module.exports.LOUNGE_SLUG = LOUNGE_SLUG;
