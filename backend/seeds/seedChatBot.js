'use strict';

/**
 * Ensure the chat bots' accounts exist, and the Medals feed they post into.
 *
 * Bots are real User rows so every chat surface — DMs, the sender map, avatars,
 * name colours, the admin transcript — works without special-casing a synthetic
 * sender. The trade for that is remembering they are not people: they are
 * excluded from the leaderboard and the homepage showcase, they can never sign
 * in, and only admins may message them.
 *
 * Idempotent: matched on the reserved email, so renaming a bot in the admin
 * panel is not undone on the next boot.
 */

const User = require('../models/User');
const ChatConversation = require('../models/ChatConversation');

const BOTS = {
  guide: {
    email: 'bot@skywatch.invalid',
    botKey: 'guide',
    displayName: 'Guide Bot',
    botDescription: 'Answers questions from the CBAT community guide',
    botAnswersDms: true,
  },
  medal: {
    email: 'medalbot@skywatch.invalid',
    botKey: 'medal',
    displayName: 'Medal Bot',
    botDescription: 'Posts podium finishes to the Medals channel',
    // A poster, not a correspondent. Nothing to ask it.
    botAnswersDms: false,
  },
};

const MEDALS_CHANNEL_SLUG = 'medals';

async function ensureBot({ email, botKey, displayName, botDescription, botAnswersDms }) {
  const existing = await User.findOne({ email }).select('_id isBot');
  if (existing) {
    // Keep the flags in step on a row that predates them. Everything downstream
    // keys off isBot (a bot without it would be DM-able by anyone), off
    // botAnswersDms (a poster without it would answer DMs it has no answers
    // for), and off botKey (without it the bot falls back to a generic avatar),
    // so these are repaired rather than left as the seed found them.
    await User.updateOne({ _id: existing._id }, {
      $set: { isBot: true, botKey, botDescription, botAnswersDms },
    });
    return existing._id;
  }

  // No password and no googleId: nothing can authenticate as this account.
  // displayNameLower reserves the name against the case-insensitive uniqueness
  // check, so a user cannot take it and impersonate the bot.
  const bot = await User.create({
    email,
    isBot:            true,
    botKey,
    botDescription,
    botAnswersDms,
    displayName,
    displayNameLower: displayName.toLowerCase(),
    hideFromShowcase: true,
    communityNotificationsEnabled: false,
  });
  return bot._id;
}

async function seedChatBot() {
  const guideBotId = await ensureBot(BOTS.guide);
  const medalBotId = await ensureBot(BOTS.medal);

  // The Medals feed. Created once and keyed on the slug ever having existed, so
  // an admin who archives or deletes it is not overruled on the next deploy.
  //
  // Notifications are OFF by default here, deliberately: a podium finish posts
  // on its own and a badge for every one of them would train people to ignore
  // the dot, which would cost it its meaning in every other channel too.
  const everExisted = await ChatConversation.exists({
    type: 'channel', 'channel.slug': MEDALS_CHANNEL_SLUG,
  });
  if (!everExisted) {
    await ChatConversation.create({
      type: 'channel',
      isArchived: false,
      channel: {
        name:          'Medals',
        slug:          MEDALS_CHANNEL_SLUG,
        description:   'Podium finishes across the CBAT leaderboards.',
        emoji:         '🎖️',
        order:         1,
        postPolicy:    'bot',
        postBotUserId: medalBotId,
        notifyMembers: false,
      },
    });
  } else {
    // Keep the feed pointed at the live bot even if the row predates it.
    await ChatConversation.updateOne(
      { type: 'channel', 'channel.slug': MEDALS_CHANNEL_SLUG, 'channel.postBotUserId': null },
      { $set: { 'channel.postPolicy': 'bot', 'channel.postBotUserId': medalBotId } },
    );
  }

  return { guideBotId, medalBotId };
}

module.exports = seedChatBot;
module.exports.BOTS = BOTS;
module.exports.MEDALS_CHANNEL_SLUG = MEDALS_CHANNEL_SLUG;
// Back-compat with the first version of this seed, which exported one bot.
module.exports.BOT_EMAIL = BOTS.guide.email;
module.exports.BOT_DISPLAY_NAME = BOTS.guide.displayName;
