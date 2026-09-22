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

// Every field is optional: the client sends what its browser will tell it and
// the route keeps only what sanitiseReportEnvironment() admits.
const reportEnvironmentSchema = new mongoose.Schema({
  userAgent:         String,
  uaPlatform:        String,
  uaPlatformVersion: String,
  uaModel:           String,
  uaArchitecture:    String,
  uaBitness:         String,
  uaMobile:          Boolean,
  uaBrands:          { type: [{ brand: String, version: String, _id: false }], default: undefined },
  screenWidth:       Number,
  screenHeight:      Number,
  viewportWidth:     Number,
  viewportHeight:    Number,
  dpr:               Number,
  orientation:       String,
  touchPoints:       Number,
  language:          String,
  timezone:          String,
  online:            Boolean,
  connection:        String,
  cores:             Number,
  memory:            Number,
  webglVendor:       String,
  webglRenderer:     String,
  theme:             String,
  displayMode:       String,
  fullscreen:        Boolean,
  gamepads:          { type: [String], default: undefined },
}, { _id: false });

const problemReportSchema = new mongoose.Schema({
  userId:            { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  time:              { type: Date, default: Date.now },
  pageReported:      { type: String, required: true, trim: true },
  description:       { type: String, required: true, trim: true },
  // A one-line summary written by the model just after filing (utils/
  // reportTitle.js). Null until it lands, and on any report where the call
  // failed; readers fall back to an excerpt of the description.
  title:             { type: String, default: null, trim: true },
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

  // The device the report was filed from — OS, browser, screen, GPU and so on
  // — as the client read it, plus the request's User-Agent header stamped by
  // the server. Stored raw and described at read time
  // (utils/reportEnvironment.js), so a better parser applies to every report
  // already in the queue. Absent on reports filed before this was captured.
  environment: { type: reportEnvironmentSchema, default: undefined },

  // When the reporter last opened this report in the Community rail. A
  // user-visible update newer than this is an unread reply; see
  // utils/reportTickets.js. Null until they first look.
  userSeenAt: { type: Date, default: null },
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
