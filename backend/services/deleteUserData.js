const mongoose = require('mongoose');

const User = require('../models/User');

// Resolve by requiring the model file rather than mongoose.model(name): requiring
// registers the schema as a side effect, so this works even when no route has
// pulled the model in yet (notably under Jest, where each suite loads its own
// slice of the app).
const model = (name) => require(`../models/${name}`);

// ── Collections wholly owned by one user ─────────────────────────────────────
// Every doc keyed by `userId` here exists only because that user played/read/
// reported something. Deleting the user deletes the row outright.
//
// ⚠ Adding a model with a `userId` ref to a User? Add it here too, or the row
// outlives the account. The deleteUserData test asserts this list covers every
// model in backend/models that refs 'User' — it fails loudly on omissions.
const OWNED_BY_USER = [
  'AirstarLog',
  'AptitudeSyncUsage',
  'GameSessionCaseFileResult',
  'GameSessionCbatActResult',
  'GameSessionCbatAnglesResult',
  'GameSessionCbatAntResult',
  'GameSessionCbatCodeDuplicatesResult',
  'GameSessionCbatDADResult',
  'GameSessionCbatDptResult',
  'GameSessionCbatFlagResult',
  'GameSessionCbatInstrumentsResult',
  'GameSessionCbatNumericalOpsResult',
  'GameSessionCbatPlaneTurnResult',
  'GameSessionCbatSatResult',
  'GameSessionCbatStart',
  'GameSessionCbatSymbolsResult',
  'GameSessionCbatTargetResult',
  'GameSessionCbatTrace1Result',
  'GameSessionCbatTrace2Result',
  'GameSessionCbatTutorial',
  'GameSessionCbatVisualisation2DResult',
  'GameSessionCbatVisualisation3DResult',
  'GameSessionFlashcardRecallResult',
  'GameSessionOrderOfBattleResult',
  'GameSessionQuizAttempt',
  'GameSessionQuizResult',
  'GameSessionWhereAircraftResult',
  'GameSessionWheresThatAircraftResult',
  'IntelligenceBriefRead',
  'ProblemReport',
  'UserNotification',
];

// ── Admin-authored content that merely records who touched it ────────────────
// The doc belongs to the app, not the user — a brief reel still exists after the
// admin who published it leaves. Null the ref, keep the content.
const AUTHORSHIP_REFS = [
  ['BriefReel',          ['generatedBy', 'publishedBy']],
  ['ChatConversation',   ['closedByUserId']],
  ['ProblemReport',      ['adminUserId']],
  ['SocialAccount',      ['connectedBy']],
  ['SocialPost',         ['createdBy']],
  ['UpdateNotification', ['createdBy']],
];

/**
 * Erase a user and every trace of them, for GDPR / Play account-deletion.
 *
 * Three dispositions, by what the data actually is:
 *   delete    — rows that exist only because of this user
 *   anonymise — audit/ops rows that must survive, minus the identifying ref
 *   redact    — required fields that can't be nulled (EmailLog.recipientEmail)
 *
 * Not transactional: a standalone mongod has no multi-doc transactions, and the
 * deployment is single-node. Ordering therefore matters — the User doc goes
 * last, so a mid-way failure leaves the account intact and retryable rather than
 * a live login pointing at half-erased data.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @returns {Promise<{ deleted: Object<string, number> }>} per-collection counts
 */
async function deleteUserAndData(userId) {
  const id = new mongoose.Types.ObjectId(String(userId));
  const deleted = {};

  // 1. Chat — messages hang off conversations, so clear children first.
  //    Any message this user sent inside someone *else's* conversation (i.e.
  //    they were an admin replying) is kept but de-identified: deleting it
  //    would tear holes in another user's support thread.
  const ChatConversation = model('ChatConversation');
  const ChatMessage      = model('ChatMessage');

  const ownConversations = await ChatConversation.find({ userId: id }).select('_id').lean();
  const conversationIds  = ownConversations.map((c) => c._id);

  if (conversationIds.length) {
    const msgs = await ChatMessage.deleteMany({ conversationId: { $in: conversationIds } });
    deleted.ChatMessage = msgs.deletedCount;
  }
  const convos = await ChatConversation.deleteMany({ userId: id });
  deleted.ChatConversation = convos.deletedCount;

  await ChatMessage.updateMany({ senderUserId: id }, { $set: { senderUserId: null } });

  // 2. Rows that exist only for this user.
  for (const modelName of OWNED_BY_USER) {
    const res = await model(modelName).deleteMany({ userId: id });
    deleted[modelName] = res.deletedCount;
  }

  // 3. Their view records — and any free-text "have your say" answer — inside
  //    admin-authored announcements. The announcement itself is app content.
  await model('UpdateNotification').updateMany(
    { 'viewedBy.userId': id },
    { $pull: { viewedBy: { userId: id } } },
  );

  // 4. Audit + ops trails: keep the event, drop the person.
  await model('SystemLog').updateMany({ userId: id }, { $set: { userId: null } });
  await model('AdminAction').updateMany({ userId: id },       { $set: { userId: null } });
  await model('AdminAction').updateMany({ targetUserId: id }, { $set: { targetUserId: null } });

  // recipientEmail is `required`, so it takes a placeholder rather than null.
  await model('EmailLog').updateMany(
    { recipientUserId: id },
    { $set: { recipientUserId: null, recipientEmail: 'deleted-user@removed.invalid' } },
  );

  // 5. Admin-authored content keeps its body, loses its byline.
  for (const [modelName, fields] of AUTHORSHIP_REFS) {
    for (const field of fields) {
      await model(modelName).updateMany({ [field]: id }, { $set: { [field]: null } });
    }
  }

  // 6. The account itself, last.
  const res = await User.findByIdAndDelete(id);
  deleted.User = res ? 1 : 0;

  return { deleted };
}

module.exports = { deleteUserAndData, OWNED_BY_USER, AUTHORSHIP_REFS };
