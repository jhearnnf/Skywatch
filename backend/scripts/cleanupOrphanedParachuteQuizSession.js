/**
 * One-off cleanup: removes orphaned quiz session data for
 * user osmightymanos@hotmail.co.uk on the brief
 * "UK's Largest Military Parachute Drop in Over a Decade".
 *
 * The brief's quiz questions were regenerated, which deleted the
 * GameQuizQuestion docs but left the user's GameSessionQuizAttempt +
 * GameSessionQuizResult rows behind (causing a 0-questions breakdown in
 * game history). This script deletes those rows and reverses any quiz
 * AirstarLog entries tied to that brief for this user.
 *
 * Usage:
 *   node scripts/cleanupOrphanedParachuteQuizSession.js           (dry run)
 *   node scripts/cleanupOrphanedParachuteQuizSession.js --apply   (perform deletion)
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

const User                       = require('../models/User');
const IntelligenceBrief          = require('../models/IntelligenceBrief');
const GameSessionQuizAttempt     = require('../models/GameSessionQuizAttempt');
const GameSessionQuizResult      = require('../models/GameSessionQuizResult');
const AirstarLog                 = require('../models/AirstarLog');

const TARGET_EMAIL = 'osmightymanos@hotmail.co.uk';
const TARGET_BRIEF_TITLE = "UK's Largest Military Parachute Drop in Over a Decade";

async function run() {
  const apply = process.argv.includes('--apply');
  console.log(`Mode: ${apply ? 'APPLY (will modify DB)' : 'DRY RUN (no changes)'}\n`);

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const user = await User.findOne({ email: TARGET_EMAIL }).select('_id email totalAirstars cycleAirstars');
  if (!user) { console.error(`User ${TARGET_EMAIL} not found`); return mongoose.disconnect(); }

  const brief = await IntelligenceBrief.findOne({ title: TARGET_BRIEF_TITLE }).select('_id title');
  if (!brief) { console.error(`Brief "${TARGET_BRIEF_TITLE}" not found`); return mongoose.disconnect(); }

  console.log(`User:  ${user.email}  (${user._id})`);
  console.log(`       totalAirstars=${user.totalAirstars}, cycleAirstars=${user.cycleAirstars}`);
  console.log(`Brief: ${brief.title}  (${brief._id})\n`);

  // Find all attempts by this user on this brief
  const attempts = await GameSessionQuizAttempt.find({
    userId: user._id,
    intelBriefId: brief._id,
  }).select('_id gameSessionId difficulty status won createdAt');

  console.log(`Quiz attempts for this user + brief: ${attempts.length}`);
  for (const a of attempts) {
    console.log(`  - ${a.gameSessionId}  difficulty=${a.difficulty}  status=${a.status}  won=${a.won}  ${a.createdAt?.toISOString?.() ?? ''}`);
  }

  // Find all quiz results for this user tied to those session IDs
  const sessionIds = attempts.map(a => a.gameSessionId).filter(Boolean);
  const results = await GameSessionQuizResult.find({
    userId: user._id,
    gameSessionId: { $in: sessionIds },
  }).select('_id questionId gameSessionId isCorrect');

  console.log(`\nQuiz per-question results for those sessions: ${results.length}`);

  // Aggregate quiz airstar logs for this user + brief
  const coinLogs = await AirstarLog.find({
    userId: user._id,
    briefId: brief._id,
    reason: 'quiz',
  }).select('_id amount label createdAt');

  const coinsToReverse = coinLogs.reduce((sum, l) => sum + (l.amount ?? 0), 0);
  console.log(`\nQuiz AirstarLog entries for this user + brief: ${coinLogs.length}  (total=${coinsToReverse} coins)`);
  for (const l of coinLogs) {
    console.log(`  - ${l.amount} coins  "${l.label}"  ${l.createdAt?.toISOString?.() ?? ''}`);
  }

  // Brief-read coins should be LEFT ALONE — log them so we can verify
  const readCoinLogs = await AirstarLog.countDocuments({
    userId: user._id,
    briefId: brief._id,
    reason: 'brief_read',
  });
  console.log(`\nBrief-read AirstarLog entries for this user + brief (left untouched): ${readCoinLogs}`);

  const newTotal = Math.max(0, (user.totalAirstars ?? 0) - coinsToReverse);
  const newCycle = Math.max(0, (user.cycleAirstars ?? 0) - coinsToReverse);
  console.log(`\nProjected balance after reversal:`);
  console.log(`  totalAirstars: ${user.totalAirstars} → ${newTotal}`);
  console.log(`  cycleAirstars: ${user.cycleAirstars} → ${newCycle}`);

  if (!apply) {
    console.log(`\n(dry run) Nothing deleted. Re-run with --apply to perform cleanup.`);
    return mongoose.disconnect();
  }

  console.log(`\n── APPLYING CHANGES ──`);

  user.totalAirstars = newTotal;
  user.cycleAirstars = newCycle;
  await user.save();
  console.log(`User balances updated.`);

  const attemptDel = await GameSessionQuizAttempt.deleteMany({
    userId: user._id,
    intelBriefId: brief._id,
  });
  console.log(`Deleted ${attemptDel.deletedCount} GameSessionQuizAttempt row(s).`);

  const resultDel = await GameSessionQuizResult.deleteMany({
    userId: user._id,
    gameSessionId: { $in: sessionIds },
  });
  console.log(`Deleted ${resultDel.deletedCount} GameSessionQuizResult row(s).`);

  const coinDel = await AirstarLog.deleteMany({
    userId: user._id,
    briefId: brief._id,
    reason: 'quiz',
  });
  console.log(`Deleted ${coinDel.deletedCount} quiz AirstarLog row(s).`);

  console.log(`\nDone.`);
  return mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
