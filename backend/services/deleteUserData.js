const mongoose = require('mongoose');

const User = require('../models/User');
const { destroyAsset } = require('../utils/cloudinary');

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
  'AppOpen',
  'AptitudeSyncUsage',
  'CbatMatfPrint',
  'CbatMockAssessment',
  'CbatScoreSheet',
  'GameSessionCaseFileResult',
  'GameSessionCbatActResult',
  'GameSessionCbatAnglesResult',
  'GameSessionCbatAntResult',
  'GameSessionCbatAntPractiseResult',
  'GameSessionCbatAntHardResult',
  'GameSessionCbatCodeDuplicatesResult',
  'GameSessionCbatCutResult',
  'GameSessionCbatCutEasierResult',
  'GameSessionCbatDADResult',
  'GameSessionCbatDptResult',
  'GameSessionCbatDptEasierResult',
  'GameSessionCbatDptHardResult',
  'GameSessionCbatFlagResult',
  'GameSessionCbatFlagEasierResult',
  'GameSessionCbatClanResult',
  'GameSessionCbatClanEasierResult',
  'GameSessionCbatInstrumentsResult',
  'GameSessionCbatInstrumentsOrientationResult',
  'GameSessionCbatInstrumentsPractiseResult',
  'GameSessionCbatMatfResult',
  'GameSessionCbatMatfEasierResult',
  'GameSessionCbatNumericalOpsResult',
  'GameSessionCbatNumericalOpsEasierResult',
  'GameSessionCbatPlaneTurnResult',
  'GameSessionCbatRttResult',
  'GameSessionCbatRttEasierResult',
  'GameSessionCbatSatResult',
  'GameSessionCbatSatEasierResult',
  'GameSessionCbatSitResult',
  'GameSessionCbatSitEasierResult',
  'GameSessionCbatSltResult',
  'GameSessionCbatSltEasierResult',
  'GameSessionCbatSmaResult',
  'GameSessionCbatSmaEasierResult',
  'GameSessionCbatStart',
  'GameSessionCbatSymbolsResult',
  'GameSessionCbatTargetResult',
  'GameSessionCbatTrace1Result',
  'GameSessionCbatTrace2Result',
  'GameSessionCbatTutorial',
  'GameSessionCbatVigilanceResult',
  'GameSessionCbatVigilanceHardResult',
  'GameSessionCbatVigilancePractiseResult',
  'GameSessionCbatVisualisation2DResult',
  'GameSessionCbatVisualisation3DResult',
  'GameSessionCbatVltResult',
  'GameSessionCbatVltEasierResult',
  'GameSessionFlashcardRecallResult',
  'GameSessionOrderOfBattleResult',
  'GameSessionQuizAttempt',
  'GameSessionQuizResult',
  'GameSessionWhereAircraftResult',
  'GameSessionWheresThatAircraftResult',
  'IntelligenceBriefRead',
  'ProblemReport',
  // The outcome questionnaire is NOT here: it is kept, de-identified. See
  // step 2b of deleteUserAndData.
  'UserNotification',
];

// First of the month, UTC. What a kept row's dates are coarsened to, so a
// timestamp cannot be matched back to the person (a send batch, a chat message
// saying "just did it") once the id is gone. Monthly trends survive.
const toMonth = (d) => (d ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)) : d);

function monthsOf(doc, fields) {
  const out = {};
  for (const f of fields) if (doc[f]) out[f] = toMonth(new Date(doc[f]));
  return out;
}

// ── Admin-authored content that merely records who touched it ────────────────
// The doc belongs to the app, not the user — a brief reel still exists after the
// admin who published it leaves. Null the ref, keep the content.
const AUTHORSHIP_REFS = [
  // The erasure register outlives everyone in it by design — but an admin who
  // later deletes their own account stops being the named actor on the rows
  // they signed. The row (and its reason) stays; the byline goes.
  ['AccountDeletion',    ['adminUserId']],
  // The bot's guide is app content that outlives whoever uploaded it.
  ['BotKnowledge',       ['uploadedByUserId']],
  ['BriefReel',          ['generatedBy', 'publishedBy']],
  // Clipper is admin tooling: a script and its source footage are app content
  // that outlive whichever admin queued them.
  ['ClipperScript',      ['createdBy']],
  ['ClipperSource',      ['ingestedBy']],
  ['ChatConversation',   ['closedByUserId', 'archivedByUserId']],
  ['ChatMessage',        ['deletedByUserId']],
  // reportedUserId: a chat report outlives the account that was reported — the
  // moderation record is the point of it — but must not keep pointing at them.
  ['ProblemReport',      ['adminUserId', 'reportedUserId']],
  ['User',               ['chatBannedByUserId']],
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
 * Writes an AccountDeletion row afterwards — the erasure register that lets us
 * demonstrate this ran, holding no personal data. See models/AccountDeletion.js.
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {Object}  [context]
 * @param {'self'|'admin'} [context.initiatedBy='self'] who asked for the deletion
 * @param {string|mongoose.Types.ObjectId} [context.adminUserId] acting admin
 * @param {string}  [context.reason] the admin's stated reason
 * @returns {Promise<{ deleted: Object<string, number> }>} per-collection counts
 */
async function deleteUserAndData(userId, context = {}) {
  const id = new mongoose.Types.ObjectId(String(userId));
  const deleted = {};

  // 1. Chat — messages hang off conversations, so clear children first.
  //
  //    Support threads and DMs are deleted outright, messages included. A DM is
  //    a private 1:1 thread: once one side is gone it has no owner left who can
  //    meaningfully consent to it being kept, so it goes rather than leaving the
  //    other participant holding half a conversation with a deleted account.
  //    Reported content survives this independently — a chat ProblemReport
  //    copies the offending message body into its own description precisely so
  //    the moderation record does not depend on the message still existing.
  //
  //    Channel messages are KEPT but de-identified. Deleting them would tear
  //    holes in a shared conversation that other users are still reading. Both
  //    identifying fields have to go: the sender ref and the display-name
  //    snapshot stored alongside it.
  const ChatConversation = model('ChatConversation');
  const ChatMessage      = model('ChatMessage');
  const ChatRead         = model('ChatRead');

  const ownConversations = await ChatConversation.find({
    $or: [{ userId: id }, { participantIds: id }],
  }).select('_id').lean();
  const conversationIds = ownConversations.map((c) => c._id);

  if (conversationIds.length) {
    const msgs = await ChatMessage.deleteMany({ conversationId: { $in: conversationIds } });
    deleted.ChatMessage = msgs.deletedCount;
    await ChatRead.deleteMany({ conversationId: { $in: conversationIds } });
  }
  const convos = await ChatConversation.deleteMany({
    $or: [{ userId: id }, { participantIds: id }],
  });
  deleted.ChatConversation = convos.deletedCount;

  const reads = await ChatRead.deleteMany({ userId: id });
  deleted.ChatRead = reads.deletedCount;

  await ChatMessage.updateMany(
    { senderUserId: id },
    { $set: { senderUserId: null, senderDisplayName: null } },
  );

  // 2. Rows that exist only for this user.
  for (const modelName of OWNED_BY_USER) {
    const res = await model(modelName).deleteMany({ userId: id });
    deleted[modelName] = res.deletedCount;
  }

  // 2b. The outcome questionnaire: kept, de-identified.
  //
  //     These answers are scarce and the campaign exists to gather them, so
  //     deleting them with the account quietly rewrote the results page and
  //     the Stats tiles every time somebody left. The questionnaire tells
  //     respondents up front that their answers are kept anonymously after
  //     account deletion (Survey.jsx, Privacy.jsx), which is what makes keeping
  //     the free text defensible. A request to remove one is handled by hand.
  //
  //     What goes: the account id (swapped for a placeholder that points at no
  //     user, one per erased account so "people" counts still count them once),
  //     the mailed address, the token (so the old link stops working), and
  //     every exact timestamp, coarsened to the month. Deferral and send-error
  //     state goes too: there is nobody left to re-mail.
  //
  //     Written through the raw collection: Mongoose would otherwise refuse to
  //     touch the immutable `createdAt` and stamp `updatedAt` with today, which
  //     is itself a timestamp tying the row to the deletion.
  //
  //     Score sheets are not kept: they are named documents and go with the
  //     User in step 6b. `resultImagesUploaded` survives as a count.
  const SurveyInvite   = model('SurveyInvite');
  const SurveyResponse = model('SurveyResponse');
  const invites   = await SurveyInvite.find({ userId: id }).lean();
  const responses = await SurveyResponse.find({ userId: id }).lean();
  if (invites.length || responses.length) {
    const placeholder = new mongoose.Types.ObjectId();
    for (const inv of invites) {
      await SurveyInvite.collection.updateOne({ _id: inv._id }, { $set: {
        userId: placeholder,
        erased: true,
        token: `erased:${SurveyInvite.newToken()}`,
        sentToEmail: null,
        sendError: null,
        brokenLinkAt: null,
        deferredUntil: null,
        ...monthsOf(inv, ['sentAt', 'openedAt', 'completedAt', 'optedOutAt', 'createdAt', 'updatedAt']),
      } });
    }
    for (const r of responses) {
      await SurveyResponse.collection.updateOne({ _id: r._id }, { $set: {
        userId: placeholder,
        erased: true,
        ...monthsOf(r, [
          'startedAt', 'completedAt', 'lastSeenAt', 'testBookedFor',
          'resultImagesConsentAt', 'createdAt', 'updatedAt',
        ]),
      } });
    }
  }
  deleted.SurveyInvite   = invites.length;
  deleted.SurveyResponse = responses.length;

  // 2c. Case Files "I want the next chapter" votes: kept, de-identified, for
  //     the same reason as 2b. A vote is a tally, not a person, and deleting it
  //     would shrink the admin count every time somebody left. Placeholder id
  //     rather than null because (userId, caseSlug, chapterSlug) is unique, and
  //     dates to the month.
  const CaseFileInterest = model('CaseFileInterest');
  const votes = await CaseFileInterest.find({ userId: id }).lean();
  if (votes.length) {
    const placeholder = new mongoose.Types.ObjectId();
    for (const v of votes) {
      await CaseFileInterest.collection.updateOne({ _id: v._id }, { $set: {
        userId: placeholder,
        ...monthsOf(v, ['createdAt', 'updatedAt']),
      } });
    }
  }
  deleted.CaseFileInterest = votes.length;

  // 3. Their view records — and any free-text "have your say" answer — inside
  //    admin-authored announcements. The announcement itself is app content.
  await model('UpdateNotification').updateMany(
    { 'viewedBy.userId': id },
    { $pull: { viewedBy: { userId: id } } },
  );

  //    Their id also has to come out of any notification aimed specifically at
  //    them. Order matters: an empty targetUsers means "everyone", so a notice
  //    written for this one person would start broadcasting the moment their id
  //    was pulled. Those are disabled first, then emptied — an admin can review
  //    and re-enable, which is the recoverable direction to fail in.
  await model('UpdateNotification').updateMany(
    { targetUsers: { $all: [id], $size: 1 } },
    { $set: { enabled: false } },
  );
  await model('UpdateNotification').updateMany(
    { targetUsers: id },
    { $pull: { targetUsers: id } },
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

  // 5b. The donation funnel keeps its shape, and loses the person.
  //
  //     Deleting the row would be simpler but would quietly rewrite history:
  //     the page counts PEOPLE ASKED, and somebody who was asked was still
  //     asked after they close their account. Nulling `userId` alone is not
  //     enough either — for a signed-in visit `visitKey` IS the account id, so
  //     the identifier would survive in the column the row is keyed on.
  //
  //     So both go, and the row becomes exactly what an anonymous visit already
  //     looks like in this collection. Nothing reads `visitKey` back to anyone;
  //     it exists only to fold repeat visits into one row, and a fresh random
  //     value keeps doing that job for a row that will never be visited again.
  //
  //     A signed-in donor's money lives on User.donationPrompt, which is about
  //     to be deleted, and with it the Stats donation total. So it moves onto
  //     their (now anonymous) visit row as `paidPence`, exactly where an
  //     anonymous donor's gift is recorded, and the admin total, which already
  //     sums both places, stays right. Their first visit takes it; a donor with
  //     no visit row at all gets one minted for the purpose. Dates go to the
  //     month, as in step 2b.
  const DonationPageVisit = model('DonationPageVisit');
  const donor = await User.findById(id).select('donationPrompt').lean();
  const donatedAt = donor?.donationPrompt?.donatedAt ?? null;
  const donatedPence = Math.max(0, donor?.donationPrompt?.donatedTotalPence ?? 0);

  const visits = await DonationPageVisit.find({ userId: id }).sort({ arrivedAt: 1 }).lean();
  for (const [i, visit] of visits.entries()) {
    const payment = donatedAt && i === 0
      ? { paidAt: toMonth(new Date(donatedAt)), paidPence: (visit.paidPence ?? 0) + donatedPence }
      : {};
    await DonationPageVisit.collection.updateOne({ _id: visit._id }, { $set: {
      userId: null,
      visitKey: `erased:${new mongoose.Types.ObjectId()}`,
      ...monthsOf(visit, ['arrivedAt', 'checkoutStartedAt', 'paidAt', 'createdAt', 'updatedAt']),
      ...payment,
    } });
  }
  if (donatedAt && !visits.length) {
    const month = toMonth(new Date(donatedAt));
    await DonationPageVisit.collection.insertOne({
      visitKey: `erased:${new mongoose.Types.ObjectId()}`,
      userId: null,
      arrivedAt: month,
      checkoutStartedAt: null,
      checkoutCount: 0,
      paidAt: month,
      paidPence: donatedPence,
      createdAt: month,
      updatedAt: month,
    });
  }
  deleted.DonationPageVisit = visits.length;

  // 6. The account itself, last. The returned doc is the only chance to read
  //    the email — it's needed to derive the register's pseudonymous ref, and a
  //    moment later there is nowhere left to read it from.
  const res = await User.findByIdAndDelete(id);
  deleted.User = res ? 1 : 0;

  // 6b. Score sheets live on Cloudinary, not in Mongo, so deleting the account
  //     document only removes the reference. The bytes are somebody's exam
  //     paper with their name on it, handed over under a promise on the
  //     questionnaire screen and restated in the privacy policy, so they have to
  //     go with the account rather than sit on unreferenced.
  //
  //     Non-fatal, for the same reason as the register write below: the erasure
  //     from our own systems is the obligation and it has already succeeded. A
  //     Cloudinary outage must not turn a completed deletion into a 500 the
  //     caller retries.
  for (const image of res?.cbatResultImages ?? []) {
    if (!image.publicId) continue;
    await destroyAsset(image.publicId, {
      // Questionnaire uploads are authenticated assets and do not exist at the
      // default delivery type; naming the wrong one is a silent no-op.
      type: image.source === 'questionnaire' ? 'authenticated' : 'upload',
    }).catch(() => {});
  }

  // 7. Record that this happened. Only when there was actually an account to
  //    erase — a repeat call against a missing id must not mint a second row.
  if (res) await recordDeletion(res, deleted, context);

  return { deleted };
}

/**
 * Write the erasure-register row. Deliberately non-fatal: the erasure is the
 * legal obligation and it has already succeeded by this point, so a failure
 * here must not turn a completed deletion into a 500 the caller might retry.
 * It does not pass silently either — a SystemLog surfaces it in Admin ▸ Intel,
 * where an admin can note the gap by hand.
 */
async function recordDeletion(deletedUser, deleted, context) {
  const AccountDeletion = model('AccountDeletion');
  try {
    const createdAt = deletedUser.createdAt;
    const accountAgeDays = createdAt
      ? Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000))
      : null;

    await AccountDeletion.create({
      userRef:        AccountDeletion.refFor(deletedUser.email),
      initiatedBy:    context.initiatedBy === 'admin' ? 'admin' : 'self',
      adminUserId:    context.adminUserId || null,
      reason:         context.reason || '',
      accountAgeDays,
      recordsErased:  Object.values(deleted).reduce((sum, n) => sum + (n || 0), 0),
      breakdown:      Object.fromEntries(Object.entries(deleted).filter(([, n]) => n > 0)),
    });
  } catch (err) {
    try {
      await model('SystemLog').create({
        type: 'account_deletion_log_failure',
        failureReason: err.message,
        details: { initiatedBy: context.initiatedBy || 'self' },
      });
    } catch { /* the log about the log failing is where we stop */ }
  }
}

module.exports = { deleteUserAndData, OWNED_BY_USER, AUTHORSHIP_REFS };
