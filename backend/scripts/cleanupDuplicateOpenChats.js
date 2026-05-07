/**
 * One-shot cleanup: collapse duplicate open chats per user.
 *
 * Pre-fix, a React StrictMode race could create two `status:'open'` conversations
 * for the same user. Going forward, the partial unique index on
 * { userId, status:'open' } prevents this — but pre-existing duplicates still
 * sit in the DB. This script keeps the most-recently-active open chat per user
 * and closes the rest with a 'system' system-message.
 *
 *   Dry run (default — no writes):
 *     node backend/scripts/cleanupDuplicateOpenChats.js
 *
 *   Apply for real:
 *     node backend/scripts/cleanupDuplicateOpenChats.js --apply
 *
 * Safe to re-run. Closes only `status:'open'` duplicates; never touches a
 * conversation that already has the only open slot, and never touches closed ones.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose         = require('mongoose');
const ChatConversation = require('../models/ChatConversation');
const ChatMessage      = require('../models/ChatMessage');

const APPLY = process.argv.includes('--apply');

async function run() {
  if (!process.env.MONGODB_URI) {
    console.error('Missing MONGODB_URI in environment.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected. Mode: ${APPLY ? 'APPLY (writes enabled)' : 'DRY RUN (no writes)'}`);

  // Find userIds with more than one open conversation
  const groups = await ChatConversation.aggregate([
    { $match: { status: 'open' } },
    { $group: { _id: '$userId', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]);

  console.log(`Users with duplicate open chats: ${groups.length}`);
  if (groups.length === 0) {
    await mongoose.disconnect();
    return;
  }

  let totalToClose = 0;
  let totalClosed  = 0;
  let totalSysMsg  = 0;

  for (const group of groups) {
    const userId = group._id;

    // Order: most recently active first; ties broken by createdAt (newest wins)
    const open = await ChatConversation
      .find({ userId, status: 'open' })
      .sort({ lastMessageAt: -1, createdAt: -1 });

    const [keep, ...drop] = open;
    totalToClose += drop.length;

    console.log(
      `\nUser ${userId} — ${open.length} open chats. ` +
      `Keep ${keep._id} (lastMessageAt=${keep.lastMessageAt?.toISOString() ?? 'null'}). ` +
      `Close ${drop.length}: ${drop.map(d => d._id).join(', ')}`,
    );

    if (!APPLY) continue;

    for (const convo of drop) {
      const sysMsg = await ChatMessage.create({
        conversationId: convo._id,
        senderUserId:   null,
        senderRole:     'system',
        body:           'Auto-closed: duplicate open chat consolidated by Skywatch.',
      });
      await ChatConversation.findByIdAndUpdate(convo._id, {
        status:                'closed',
        closedAt:              sysMsg.createdAt,
        closedBy:              'system',
        closedByUserId:        null,
        lastMessageAt:         sysMsg.createdAt,
        lastMessageSenderRole: 'system',
        userLastReadAt:        sysMsg.createdAt,
        adminLastReadAt:       sysMsg.createdAt,
      });
      totalClosed += 1;
      totalSysMsg += 1;
    }
  }

  console.log('\n──────── Summary ────────');
  console.log(`Users with duplicates : ${groups.length}`);
  console.log(`Conversations to close: ${totalToClose}`);
  if (APPLY) {
    console.log(`Conversations closed  : ${totalClosed}`);
    console.log(`System messages added : ${totalSysMsg}`);
  } else {
    console.log('No writes performed (dry run). Re-run with --apply to commit.');
  }

  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
