/**
 * Hard-delete chats that were closed by the system (i.e. duplicates auto-closed
 * by `cleanupDuplicateOpenChats.js`). Deletes both the ChatConversation docs
 * and every ChatMessage referencing them.
 *
 *   Dry run (default — no writes):
 *     node backend/scripts/deleteSystemClosedChats.js
 *
 *   Apply for real:
 *     node backend/scripts/deleteSystemClosedChats.js --apply
 *
 * Targets only `closedBy: 'system'` — never touches user-closed or admin-closed
 * conversations, and never touches open ones. Safe to re-run.
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

  const targets = await ChatConversation.find({ closedBy: 'system' })
    .select('_id userId closedAt lastMessageAt');
  console.log(`System-closed conversations found: ${targets.length}`);

  if (targets.length === 0) {
    await mongoose.disconnect();
    return;
  }

  const ids = targets.map(c => c._id);
  const msgCount = await ChatMessage.countDocuments({ conversationId: { $in: ids } });

  for (const c of targets) {
    console.log(
      `  conv ${c._id} — userId=${c.userId} closedAt=${c.closedAt?.toISOString() ?? 'null'}`,
    );
  }
  console.log(`Messages attached to those conversations: ${msgCount}`);

  if (!APPLY) {
    console.log('\nDry run — no writes performed. Re-run with --apply to commit.');
    await mongoose.disconnect();
    return;
  }

  const msgRes  = await ChatMessage.deleteMany({ conversationId: { $in: ids } });
  const convRes = await ChatConversation.deleteMany({ _id: { $in: ids } });

  console.log('\n──────── Summary ────────');
  console.log(`Conversations deleted: ${convRes.deletedCount}`);
  console.log(`Messages deleted    : ${msgRes.deletedCount}`);

  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
