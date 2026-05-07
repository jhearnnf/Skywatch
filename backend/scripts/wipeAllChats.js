/**
 * Hard-delete every ChatConversation and ChatMessage in the database.
 * Full clean slate — open and closed alike, every user.
 *
 *   Dry run (default — no writes):
 *     node backend/scripts/wipeAllChats.js
 *
 *   Apply for real:
 *     node backend/scripts/wipeAllChats.js --apply
 *
 * No undo. Run only when you genuinely want zero chat data on the platform.
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

  const [convoCount, msgCount] = await Promise.all([
    ChatConversation.countDocuments(),
    ChatMessage.countDocuments(),
  ]);
  console.log(`Chat conversations: ${convoCount}`);
  console.log(`Chat messages    : ${msgCount}`);

  if (convoCount === 0 && msgCount === 0) {
    console.log('Nothing to delete.');
    await mongoose.disconnect();
    return;
  }

  if (!APPLY) {
    console.log('\nDry run — no writes performed. Re-run with --apply to wipe.');
    await mongoose.disconnect();
    return;
  }

  const msgRes   = await ChatMessage.deleteMany({});
  const convoRes = await ChatConversation.deleteMany({});

  console.log('\n──────── Summary ────────');
  console.log(`Messages deleted     : ${msgRes.deletedCount}`);
  console.log(`Conversations deleted: ${convoRes.deletedCount}`);

  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
