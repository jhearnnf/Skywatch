// A member's problem reports as "support tickets" in the Community rail.
//
// A reply to a report used to reach its author as a one-off toast that popped
// up bottom-centre on whatever page they happened to be on — including a CBAT
// test in progress — and was gone once dismissed. Now the report itself is
// listed in the rail, with the team's replies under it, for as long as it is
// open. The author can find it again, and nothing has to interrupt them.
//
// Shown while the ticket is open, and after it is resolved until the author
// has seen the last reply — otherwise "we've fixed it" is the one update they
// would never get. Once a resolved ticket has been seen it leaves the rail;
// the section is for things still in flight, not a history.
//
// Reported chat messages share the ProblemReport collection but are a
// moderation matter, not a ticket the reporter follows, so they are excluded.

const ProblemReport = require('../models/ProblemReport');

const MAX_TICKETS = 20;
const EXCERPT_LEN = 80;

function visibleUpdates(report) {
  return (report.updates ?? []).filter(u => u.isUserVisible);
}

function unseenUpdates(report) {
  const seenAt = report.userSeenAt ? new Date(report.userSeenAt).getTime() : 0;
  return visibleUpdates(report).filter(u => new Date(u.time).getTime() > seenAt);
}

// Open, or resolved with a reply the author has not read yet.
function isListed(report) {
  return !report.solved || unseenUpdates(report).length > 0;
}

function excerpt(text) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > EXCERPT_LEN ? `${s.slice(0, EXCERPT_LEN - 1).trimEnd()}…` : s;
}

function serialiseTicket(report) {
  const updates = visibleUpdates(report)
    .map(u => ({ _id: u._id, time: u.time, description: u.description }))
    .sort((a, b) => new Date(a.time) - new Date(b.time));
  const unread = unseenUpdates(report).length;
  const last = updates[updates.length - 1] ?? null;
  return {
    _id:          report._id,
    // The model's one-line summary when it has landed; the opening of the
    // report itself until then.
    title:        report.title || excerpt(report.description),
    description:  report.description,
    pageReported: report.pageReported,
    time:         report.time,
    solved:       Boolean(report.solved),
    updates,
    unread:       unread > 0,
    unreadCount:  unread,
    // The rail sorts and stamps rows by their latest activity, which for a
    // ticket is the last reply, or the report itself before there is one.
    lastActivityAt: last?.time ?? report.time,
    preview:      last ? { body: last.description } : null,
  };
}

async function listTickets(userId) {
  const reports = await ProblemReport.find({ userId, kind: { $ne: 'chat_message' } })
    .sort({ time: -1 })
    .limit(MAX_TICKETS)
    .lean();
  return reports
    .filter(isListed)
    .map(serialiseTicket)
    .sort((a, b) => new Date(b.lastActivityAt) - new Date(a.lastActivityAt));
}

// Replies waiting to be read, across every listed ticket. What the Community
// badge counts for tickets.
async function unreadTicketReplies(userId) {
  const tickets = await listTickets(userId);
  return tickets.reduce((n, t) => n + t.unreadCount, 0);
}

module.exports = { listTickets, unreadTicketReplies, serialiseTicket, isListed, MAX_TICKETS };
