'use strict';

/**
 * Backfills ChatMessage.replyTo.userId — the author of the message a reply is
 * replying to.
 *
 * Context: replies used to snapshot only the parent's display name and an
 * excerpt, which is everything the quote needs to RENDER. The Community badge
 * now counts "unread replies aimed at me", which needs the parent's author id,
 * and resolving that live would mean loading every parent message on every
 * poll. So it is snapshotted at send time like the rest of replyTo — and every
 * reply written before that has to be filled in once, here.
 *
 * A reply whose parent has since been hard-deleted keeps a null userId: there
 * is no author left to attribute it to. Those rows are marked done with a
 * sentinel-free `$set: { 'replyTo.userId': null }` so they are not re-examined
 * on the next boot — the query below only matches documents where the field is
 * absent, not documents where it is present and null.
 *
 * Idempotent: re-running matches zero docs after the first apply.
 *
 * Called automatically from server.js on every boot; safe to keep there.
 */
async function backfillReplyToUserId({ ChatMessage, logger = console } = {}) {
  const Model = ChatMessage || require('../models/ChatMessage');

  const pending = await Model.find({
    'replyTo.messageId': { $ne: null },
    'replyTo.userId':    { $exists: false },
  }).select('replyTo.messageId').lean();

  if (!pending.length) return { scanned: 0, filled: 0 };

  const parentIds = [...new Set(pending.map(m => String(m.replyTo.messageId)))];
  const parents = await Model.find({ _id: { $in: parentIds } })
    .select('senderUserId').lean();
  const authorOf = new Map(parents.map(p => [String(p._id), p.senderUserId ?? null]));

  const ops = pending.map(m => ({
    updateOne: {
      filter: { _id: m._id },
      update: { $set: { 'replyTo.userId': authorOf.get(String(m.replyTo.messageId)) ?? null } },
    },
  }));

  await Model.bulkWrite(ops, { ordered: false });

  const filled = ops.filter(o => o.updateOne.update.$set['replyTo.userId']).length;
  logger.log?.(
    `[migration] backfillReplyToUserId: filled ${filled} of ${ops.length} legacy replies`
  );
  return { scanned: ops.length, filled };
}

module.exports = backfillReplyToUserId;
