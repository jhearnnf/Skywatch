'use strict';

/**
 * Upgrade the chat collection from "support threads only" to the three-type
 * model (support / dm / channel).
 *
 * Three jobs, all idempotent:
 *
 *  1. Backfill `type: 'support'` and `messageCount` on pre-existing
 *     conversations. Every document that existed before this change was a
 *     support thread by definition.
 *
 *  2. Replace the legacy `{ userId: 1 }` partial unique index. Its filter was
 *     `{ status: 'open' }` with no type clause — harmless when every row was a
 *     support thread, but fatal now: channels and DMs all carry `userId: null`,
 *     so the second one inserted would collide with the first on the null key.
 *     The schema's replacement adds `type: 'support'` to the filter. Mongoose
 *     will not rebuild an index whose options have drifted, so the stale one
 *     has to be dropped explicitly before syncIndexes().
 *
 *  3. Seed the starting channels — "Announcements" (admin-post-only) above
 *     "General" — on a database that has none, and backfill Announcements onto
 *     an install that predates it. Both are keyed so that deliberately removing
 *     a channel stays removed rather than being resurrected on the next deploy.
 */

const ChatConversation = require('../models/ChatConversation');
const ChatMessage      = require('../models/ChatMessage');

const LEGACY_INDEX_NAME = 'userId_1';
const EXPECTED_INDEX_NAME = 'uniq_open_support_per_user';

// The legacy index is any unique index on userId whose partial filter lacks the
// type clause. Matching on the filter rather than the name means a differently
// named legacy index is still caught.
function isLegacyOpenChatIndex(index) {
  if (!index || index.unique !== true) return false;
  const keys = Object.keys(index.key ?? {});
  if (keys.length !== 1 || keys[0] !== 'userId') return false;
  const filter = index.partialFilterExpression;
  if (!filter) return false;
  return filter.status === 'open' && filter.type === undefined;
}

async function chatChannelsUpgrade({ logger = console } = {}) {
  const collection = ChatConversation.collection;
  const result = { typed: 0, counted: 0, policied: 0, droppedIndex: false, seededChannel: false, seededAnnouncements: false };

  // ── 1. Backfill type ───────────────────────────────────────────────────────
  const typed = await ChatConversation.updateMany(
    { type: { $exists: false } },
    { $set: { type: 'support' } },
  );
  result.typed = typed.modifiedCount ?? 0;

  // ── 2. Reconcile the unique index ──────────────────────────────────────────
  let indexes = [];
  try {
    indexes = await collection.indexes();
  } catch (err) {
    // Fresh database — nothing to drop, syncIndexes() below builds everything.
    if (err?.codeName !== 'NamespaceNotFound') throw err;
  }

  for (const index of indexes) {
    if (index.name === EXPECTED_INDEX_NAME) continue;
    if (!isLegacyOpenChatIndex(index)) continue;
    logger?.log?.(
      `[migration] chatChannelsUpgrade: dropping legacy "${index.name}" ` +
      `(partial=${JSON.stringify(index.partialFilterExpression)})`,
    );
    try {
      await collection.dropIndex(index.name);
      result.droppedIndex = true;
    } catch (err) {
      if (err?.codeName !== 'IndexNotFound') throw err;
    }
  }

  // Older deployments may also carry a plain `userId_1` with no filter at all.
  if (indexes.some(i => i.name === LEGACY_INDEX_NAME && i.unique && !i.partialFilterExpression)) {
    try {
      await collection.dropIndex(LEGACY_INDEX_NAME);
      result.droppedIndex = true;
    } catch (err) {
      if (err?.codeName !== 'IndexNotFound') throw err;
    }
  }

  await ChatConversation.syncIndexes();

  // ── 3. Backfill messageCount ───────────────────────────────────────────────
  // Only for rows that have never had it — the field drives the unread rule, so
  // a conversation stuck at 0 would silently never show a badge.
  const needsCount = await ChatConversation
    .find({ messageCount: { $exists: false } })
    .select('_id').lean();

  for (const convo of needsCount) {
    const count = await ChatMessage.countDocuments({ conversationId: convo._id });
    await ChatConversation.updateOne({ _id: convo._id }, { $set: { messageCount: count } });
    result.counted += 1;
  }

  // ── 3b. adminOnly -> postPolicy ────────────────────────────────────────────
  // The boolean could only say "staff or everyone". A bot feed is a third case,
  // so it becomes an enum; this maps the old field across. Keyed on postPolicy
  // being absent, so an admin who later relaxes a channel is not re-restricted
  // on the next boot.
  const policied = await ChatConversation.updateMany(
    { type: 'channel', 'channel.postPolicy': { $exists: false }, 'channel.adminOnly': true },
    { $set: { 'channel.postPolicy': 'admin' } },
  );
  const openPolicied = await ChatConversation.updateMany(
    { type: 'channel', 'channel.postPolicy': { $exists: false } },
    { $set: { 'channel.postPolicy': 'everyone' } },
  );
  result.policied = (policied.modifiedCount ?? 0) + (openPolicied.modifiedCount ?? 0);

  // The old boolean is now derived on read and must not linger as a second
  // source of truth.
  await ChatConversation.updateMany(
    { type: 'channel', 'channel.adminOnly': { $exists: true } },
    { $unset: { 'channel.adminOnly': 1 } },
  );

  // ── 4. Seed the starting channels ──────────────────────────────────────────
  // Only on a database with no channels at all, so an admin who deliberately
  // archives every channel doesn't find them resurrected on the next deploy.
  //
  // Announcements sits above General on a negative order and is admin-post-only
  // — it is a noticeboard, not a conversation.
  const anyChannel = await ChatConversation.exists({ type: 'channel' });
  if (!anyChannel) {
    await ChatConversation.create([
      {
        type: 'channel',
        isArchived: false,
        channel: {
          name:        'Announcements',
          slug:        'announcements',
          description: 'Updates from the SkyWatch team.',
          emoji:       '📢',
          order:       -1,
          postPolicy:  'admin',
        },
      },
      {
        type: 'channel',
        isArchived: false,
        channel: {
          name:        'General',
          slug:        'general',
          description: 'Anything and everything.',
          emoji:       '💬',
          order:       0,
          postPolicy:  'everyone',
        },
      },
    ]);
    result.seededChannel = true;
  }

  // ── 5. Add Announcements to a database that predates it ────────────────────
  // Separate from the seed above: an existing install already has General, so
  // the "no channels at all" guard would skip it forever. Keyed on the slug
  // having never existed, live or archived, so deleting it stays permanent.
  const everHadAnnouncements = await ChatConversation.exists({
    type: 'channel', 'channel.slug': 'announcements',
  });
  if (!everHadAnnouncements) {
    await ChatConversation.create({
      type: 'channel',
      isArchived: false,
      channel: {
        name:        'Announcements',
        slug:        'announcements',
        description: 'Updates from the SkyWatch team.',
        emoji:       '📢',
        order:       -1,
        postPolicy:  'admin',
      },
    });
    result.seededAnnouncements = true;
  }

  if (result.typed || result.droppedIndex || result.counted || result.policied || result.seededChannel || result.seededAnnouncements) {
    logger?.log?.(
      `[migration] chatChannelsUpgrade: typed=${result.typed} counted=${result.counted} ` +
      `droppedIndex=${result.droppedIndex} policied=${result.policied} seededChannel=${result.seededChannel} ` +
      `seededAnnouncements=${result.seededAnnouncements}`,
    );
  }

  return result;
}

module.exports = chatChannelsUpgrade;
