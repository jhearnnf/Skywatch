const mongoose = require('mongoose');

const problemReportUpdateSchema = new mongoose.Schema({
  adminUserId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  time:          { type: Date, default: Date.now },
  description:   { type: String, required: true, trim: true },
  isUserVisible: { type: Boolean, default: false },
  // The two delivery channels are independent — an update can go out as both an
  // email and an in-app notification. Rows written before `notificationSent`
  // existed have no value for it; read them as `!emailSent`, which is exactly
  // the either/or the route used to enforce.
  emailSent:        { type: Boolean, default: false },
  notificationSent: { type: Boolean, default: false },
});

const problemReportSchema = new mongoose.Schema({
  userId:            { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  time:              { type: Date, default: Date.now },
  pageReported:      { type: String, required: true, trim: true },
  description:       { type: String, required: true, trim: true },
  solved:            { type: Boolean, default: false },
  intelligenceBrief: { type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief', default: null },
  updates:           [problemReportUpdateSchema],

  // Reported chat messages land in this same queue so admins watch one list
  // rather than two, but they are a different kind of thing from a bug report:
  // moderation, not triage. `kind` keeps them filterable in Admin › Intel ›
  // Reports so a flood of one never buries the other.
  kind: { type: String, enum: ['bug', 'chat_message'], default: 'bug' },

  // Set only when kind === 'chat_message'. chatMessageId lets the admin row
  // link straight to the message in its transcript; reportedUserId is the
  // author being reported (distinct from userId, the reporter).
  chatMessageId:      { type: mongoose.Schema.Types.ObjectId, ref: 'ChatMessage', default: null },
  chatConversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatConversation', default: null },
  reportedUserId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // What the reporter's client said it was running, from the same
  // { platform, version, build } the heartbeat reports. Without it a report
  // from the app cannot be read against a store release, and "is this fixed in
  // the current build?" has no answer. No enum here: the only writer runs the
  // payload through sanitiseClientInfo(), which allows nothing else through.
  // Null on reports filed before this was captured, and on any client that
  // could not say.
  clientPlatform: { type: String, default: null },
  clientVersion:  { type: String, default: null },
  clientBuild:    { type: String, default: null },

  // The last few pages before the form, oldest first, as labels rather than
  // paths — the raw pathnames carry record ids, and the report queue is no more
  // the place to keep those than the presence strip is. Same table does both:
  // backend/constants/presenceLocations.js. Empty on older reports.
  routeTrail: { type: [String], default: [] },
});

problemReportSchema.index({ solved: 1, time: -1 });
problemReportSchema.index({ intelligenceBrief: 1 });
problemReportSchema.index({ kind: 1, solved: 1, time: -1 });
// One report per user per message — re-reporting is a no-op rather than a way
// to spam the queue.
problemReportSchema.index(
  { userId: 1, chatMessageId: 1 },
  { unique: true, partialFilterExpression: { kind: 'chat_message' } },
);

module.exports = mongoose.model('ProblemReport', problemReportSchema);
