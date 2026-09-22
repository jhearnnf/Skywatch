// A support ticket is a support conversation. This is the one place that
// opens, resolves and reopens them, and keeps the linked problem report's
// `solved` flag in step with the thread's status.
//
// Two ways in. A problem report opens a ticket with the report as its first
// message and the report document linked for context (page, device, brief).
// "Message the team" opens one with no report; the first message the user
// types names it. Either way the reporter and the team talk in the thread,
// unread is the chat's own unread, and resolving it closes the thread.
//
// Reported chat messages are not tickets. They share the ProblemReport
// collection as a moderation record and never get a thread.

const ChatConversation = require('../models/ChatConversation');
const ProblemReport    = require('../models/ProblemReport');
const { appendMessage, closeConversation, reopenConversation } = require('./chatWrite');
const { scheduleTicketTitle, excerptTitle } = require('./reportTitle');

// A ticket opened by "Message the team" that nobody has typed into yet.
// Opening the composer twice must not leave two of these behind, so a second
// open lands on the first; a ticket with a message or a report is a real one
// and never coalesced into.
function findBlankTicket(userId) {
  return ChatConversation.findOne({
    type: 'support', userId, status: 'open', hasReport: false, messageCount: 0,
  });
}

async function openTicket({ user, body = null, report = null, startedByRole = 'user' }) {
  const text = String(body ?? '').trim();
  if (!text && !report) {
    const blank = await findBlankTicket(user._id);
    if (blank) return { conversation: blank, created: false };
  }

  let conversation;
  try {
    conversation = await ChatConversation.create({
      type: 'support',
      userId: user._id,
      startedByRole,
      reportId: report?._id ?? null,
      hasReport: Boolean(report),
      title: report?.title || (text ? excerptTitle(text) : null),
    });
  } catch (err) {
    // Lost the race for the one blank ticket (uniq_blank_ticket_per_user):
    // the winner's is the one to use.
    if (err?.code === 11000 && !text && !report) {
      const blank = await findBlankTicket(user._id);
      if (blank) return { conversation: blank, created: false };
    }
    throw err;
  }

  if (text) {
    await appendMessage({
      conversation,
      senderUserId: user._id,
      senderRole: 'user',
      senderDisplayName: user.displayName ?? null,
      body: text,
    });
  }

  if (report) {
    await ProblemReport.updateOne({ _id: report._id }, { $set: { conversationId: conversation._id } });
  }

  if (text) {
    scheduleTicketTitle({
      conversationId: conversation._id,
      reportId: report?._id ?? null,
      description: text,
      pageReported: report?.pageReported ?? null,
    });
  }

  return { conversation, created: true };
}

// The first message a user types into a blank ticket names it. Called by the
// message route; a no-op on anything that already has a title.
function nameTicketFromFirstMessage(conversation, body) {
  if (conversation.type !== 'support' || conversation.title) return;
  const text = String(body ?? '').trim();
  if (!text) return;
  ChatConversation.updateOne({ _id: conversation._id }, { $set: { title: excerptTitle(text) } }).catch(() => {});
  scheduleTicketTitle({ conversationId: conversation._id, reportId: null, description: text, pageReported: null });
}

async function syncReportSolved(conversation, solved) {
  if (!conversation.reportId) return;
  await ProblemReport.updateOne({ _id: conversation.reportId }, { $set: { solved } });
}

async function resolveTicket(conversation, { byRole, byUserId, body }) {
  if (conversation.status === 'closed') return conversation;
  const updated = await closeConversation(conversation, { byRole, byUserId, body });
  await syncReportSolved(conversation, true);
  return updated;
}

async function reopenTicket(conversation, { byRole, byUserId, body }) {
  if (conversation.status === 'open') return conversation;
  const updated = await reopenConversation(conversation, { byRole, byUserId, body });
  await syncReportSolved(conversation, false);
  return updated;
}

// The thread for a report, opening one if the report predates tickets and the
// boot migration has not reached it. Seeds the report text as the first
// message so the thread reads the same as a freshly filed one.
async function ticketForReport(report, reporter) {
  if (report.conversationId) {
    const existing = await ChatConversation.findById(report.conversationId);
    if (existing) return existing;
  }
  const { conversation } = await openTicket({ user: reporter, body: report.description, report });
  return conversation;
}

module.exports = { openTicket, nameTicketFromFirstMessage, resolveTicket, reopenTicket, ticketForReport, findBlankTicket };
