'use strict';

/**
 * Support tickets: one thread per problem.
 *
 * A problem report and a support chat used to be two separate things — a
 * one-way form with admin notes, and a two-way thread — that did the same
 * job. A report now opens a support thread (utils/supportTickets.js), and
 * this brings the reports filed before that across:
 *
 *   1. Drops `uniq_open_support_per_user`. A user with two problems has two
 *      open tickets; the index that allowed one is gone from the schema and
 *      is dropped here in case syncIndexes() has not run.
 *   2. Every bug report with no thread gets one, seeded with the report as
 *      the reporter's first message and each reply the team chose to show
 *      them as a SkyWatch Support message, at their original times. Resolved
 *      reports get a closed thread. Read markers are set so nothing that was
 *      already read comes back as unread.
 *   3. Every support thread with no title gets an excerpt of its first user
 *      message, so the rail has something to show. No model calls at boot;
 *      scripts/backfillReportTitles.js writes proper titles on request.
 *
 * Idempotent: keyed on `conversationId` being unset (2) and `title` being
 * unset (3). Reported chat messages are moderation records, never tickets.
 */

const ChatConversation = require('../models/ChatConversation');
const ChatMessage      = require('../models/ChatMessage');
const ChatRead         = require('../models/ChatRead');
const ProblemReport    = require('../models/ProblemReport');
const { excerptTitle } = require('../utils/reportTitle');

const LEGACY_INDEX = 'uniq_open_support_per_user';

async function dropLegacyIndex(logger) {
  const collection = ChatConversation.collection;
  let indexes = [];
  try {
    indexes = await collection.indexes();
  } catch (err) {
    if (err?.codeName === 'NamespaceNotFound') return false;
    throw err;
  }
  if (!indexes.some(i => i.name === LEGACY_INDEX)) return false;
  logger?.log?.(`[migration] supportTickets: dropping "${LEGACY_INDEX}" (one ticket per problem now)`);
  try {
    await collection.dropIndex(LEGACY_INDEX);
    return true;
  } catch (err) {
    if (err?.codeName === 'IndexNotFound') return false;
    throw err;
  }
}

async function threadForReport(report) {
  const visible = (report.updates ?? [])
    .filter(u => u.isUserVisible && u.description)
    .sort((a, b) => new Date(a.time) - new Date(b.time));

  const convo = await ChatConversation.create({
    type: 'support',
    userId: report.userId,
    startedByRole: 'user',
    reportId: report._id,
    hasReport: true,
    title: report.title || excerptTitle(report.description),
    status: report.solved ? 'closed' : 'open',
    closedAt: report.solved ? (visible[visible.length - 1]?.time ?? report.time) : null,
    closedBy: report.solved ? 'admin' : null,
    lastMessageAt: report.time,
    lastMessageSenderRole: 'user',
    messageCount: 0,
  });

  const rows = [
    { conversationId: convo._id, senderUserId: report.userId, senderRole: 'user', body: report.description, createdAt: report.time },
    ...visible.map(u => ({
      conversationId: convo._id, senderUserId: u.adminUserId ?? null, senderRole: 'admin', body: u.description, createdAt: u.time,
    })),
  ];
  // Timestamps are the originals, so insertMany rather than create() and its
  // default-now createdAt.
  await ChatMessage.insertMany(rows);

  const last = rows[rows.length - 1];
  await ChatConversation.updateOne({ _id: convo._id }, {
    $set: {
      messageCount: rows.length,
      lastMessageAt: last.createdAt,
      lastMessageSenderRole: last.senderRole,
      adminLastReadAt: last.createdAt,
    },
  });

  // The reporter has seen everything up to the last reply if they opened the
  // report in the short-lived ticket pane (userSeenAt), or nothing since
  // their own report otherwise. The old reply toast marked itself read on
  // dismissal but left no per-report trace, so a reply from before this
  // migration comes back unread once — better than a reply silently lost.
  const seenAt = report.userSeenAt ? new Date(report.userSeenAt) : new Date(report.time);
  await ChatRead.findOneAndUpdate(
    { userId: report.userId, conversationId: convo._id },
    { $set: { lastReadAt: seenAt } },
    { upsert: true },
  );

  await ProblemReport.updateOne({ _id: report._id }, { $set: { conversationId: convo._id } });
  return convo;
}

async function supportTickets({ logger = console } = {}) {
  const result = { droppedIndex: false, threaded: 0, titled: 0 };

  result.droppedIndex = await dropLegacyIndex(logger);

  // The blank-ticket index (models/ChatConversation.js) has a partial filter
  // the old schema never declared; make sure it exists before anything relies
  // on it. syncIndexes also drops the legacy one if dropLegacyIndex missed it.
  await ChatConversation.syncIndexes();

  const reports = await ProblemReport.find({
    kind: { $ne: 'chat_message' },
    userId: { $ne: null },
    $or: [{ conversationId: { $exists: false } }, { conversationId: null }],
  }).lean();
  for (const report of reports) {
    await threadForReport(report);
    result.threaded += 1;
  }

  const untitled = await ChatConversation.find({
    type: 'support',
    $or: [{ title: { $exists: false } }, { title: null }, { title: '' }],
    messageCount: { $gt: 0 },
  }).select('_id').lean();
  for (const { _id } of untitled) {
    const first = await ChatMessage.findOne({ conversationId: _id, senderRole: 'user' })
      .sort({ createdAt: 1 }).select('body').lean();
    if (!first?.body) continue;
    await ChatConversation.updateOne({ _id }, { $set: { title: excerptTitle(first.body) } });
    result.titled += 1;
  }

  if (result.threaded || result.titled || result.droppedIndex) {
    logger?.log?.(`[migration] supportTickets: ${result.threaded} report(s) threaded, ${result.titled} thread(s) titled`);
  }
  return result;
}

module.exports = supportTickets;
