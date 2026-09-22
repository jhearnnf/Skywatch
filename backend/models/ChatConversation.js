const mongoose = require('mongoose');

// One collection backs all three kinds of chat, discriminated by `type`:
//
//   'support'  — the original user↔"SkyWatch Help Team" thread. `userId` is the
//                user; admins are not participants (any admin can read/reply via
//                the shared `adminLastReadAt`). Has an open/closed lifecycle.
//   'dm'       — a 1:1 thread between two users. `participantIds` holds both,
//                sorted, and `participantKey` dedupes them at the DB level.
//   'channel'  — a public room every logged-in user can read and post in.
//                Metadata lives under `channel`; admins create and archive them.
//
// Keeping all three in one collection is what makes the admin transcript view
// uniform: one query shape reads any conversation, and ChatMessage needs only a
// single parent pointer.
//
// The open/closed fields (`status`, `closedAt`, `closedBy`, `closedByUserId`,
// `startedByRole`) are SUPPORT-ONLY. Channels and DMs have no such lifecycle —
// they are archived (channels) or simply persist (DMs).
const chatConversationSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['support', 'dm', 'channel'],
    default: 'support',
    required: true,
  },

  // ── support ────────────────────────────────────────────────────────────────
  // Was `required: true` when this model only held support chats. Now nullable
  // so channels and DMs can share the collection; the route layer requires it
  // for type 'support'.
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  status:   { type: String, enum: ['open', 'closed'], default: 'open' },
  closedAt: { type: Date, default: null },
  closedBy: { type: String, enum: ['user', 'admin', 'system', null], default: null },
  closedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  startedByRole: { type: String, enum: ['user', 'admin'], default: 'user' },

  // A support thread IS a support ticket. `title` is the one line the rail
  // and the admin queue show for it (from the model, or the opening message
  // until that lands; utils/reportTitle.js). `reportId` links the problem
  // report it was opened from, which carries the structured context (page,
  // device environment, brief) a chat cannot; null for a thread the user
  // simply started. A user can have any number of open tickets, one per
  // problem — the old one-open-thread-per-user index was dropped by
  // migrations/supportTickets.js.
  title:     { type: String, trim: true, maxlength: 80, default: null },
  reportId:  { type: mongoose.Schema.Types.ObjectId, ref: 'ProblemReport', default: null },
  // Same fact as `reportId != null`, kept as a boolean because the
  // blank-ticket index below needs an equality it can filter on (a partial
  // index can test neither null nor $exists: false).
  hasReport: { type: Boolean, default: false },

  // ── dm ─────────────────────────────────────────────────────────────────────
  // Exactly two ids, sorted ascending so the pair has one canonical form.
  participantIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  // "<idA>_<idB>" from the sorted pair. Unique+sparse, so two users racing to
  // open a DM with each other can't end up with two threads — the loser of the
  // race hits E11000 and re-resolves, same pattern as the support chat.
  participantKey: { type: String, default: null },

  // Set when one participant is a bot. Denormalised so the per-message post
  // check is a field read rather than a User lookup on every send, and so a
  // thread can be recognised as a bot thread without resolving participants.
  botUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // ── channel ────────────────────────────────────────────────────────────────
  channel: {
    name:        { type: String, trim: true, maxlength: 40,  default: null },
    slug:        { type: String, trim: true, lowercase: true, default: null },
    description: { type: String, trim: true, maxlength: 200, default: null },
    emoji:       { type: String, trim: true, maxlength: 8,   default: null },
    order:       { type: Number, default: 0 },

    // Who may post. Everyone reads either way — this is only about writing.
    //   'everyone' — an ordinary conversation
    //   'admin'    — a noticeboard the SkyWatch team writes (Announcements)
    //   'bot'      — a feed exactly one bot writes (Medals). Users interact
    //                with it through reactions rather than replies.
    // Replaces the old `adminOnly` boolean, which could not express the third
    // case; migrations/chatChannelsUpgrade.js maps the old field across. The
    // API still returns a derived `adminOnly` for "you cannot post here",
    // computed from this rather than stored, so there is one source of truth.
    postPolicy:    { type: String, enum: ['everyone', 'admin', 'bot'], default: 'everyone' },
    postBotUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Whether messages here count towards the Community unread dot. A feed
    // that posts on every podium finish would otherwise badge the navbar all
    // day and train people to ignore it — which would cost the dot its meaning
    // everywhere else, not just here.
    notifyMembers: { type: Boolean, default: true },

    audience:     { type: String, enum: ['public', 'cbat-cohort'], default: 'public' },
    cohortKey:    { type: String, default: null },
    cohortDate:   { type: String, default: null },
    cohortRegion: { type: String, default: null },

  },

  // Archiving hides a channel from users while keeping every message readable
  // by admins — the whole point of archive-over-delete. Permanent removal is a
  // separate, explicit purge that only works on an already-archived channel.
  isArchived:         { type: Boolean, default: false },
  archivedAt:         { type: Date, default: null },
  archivedByUserId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // ── shared ─────────────────────────────────────────────────────────────────
  lastMessageAt:         { type: Date, default: Date.now },
  lastMessageSenderRole: { type: String, enum: ['user', 'admin', 'system'], default: 'system' },

  // Incremented by appendMessage. Exists so "has this conversation ever been
  // spoken in?" is answerable without touching ChatMessage — `lastMessageAt`
  // defaults to the creation time, so on its own it would make a brand-new
  // empty DM look like it had unread traffic.
  messageCount: { type: Number, default: 0 },

  // Support-only, and deliberately SHARED across admins: any admin reading the
  // thread clears it for the whole team. Per-user read state for every type
  // (including the user side of support) lives in the ChatRead collection —
  // a single field on the conversation cannot express "read" for a channel
  // with many readers.
  adminLastReadAt: { type: Date, default: null },
}, { timestamps: true });

chatConversationSchema.index({ type: 1, lastMessageAt: -1 });
chatConversationSchema.index({ userId: 1, status: 1, lastMessageAt: -1 });
chatConversationSchema.index({ status: 1, lastMessageAt: -1 });
chatConversationSchema.index({ status: 1, lastMessageSenderRole: 1, adminLastReadAt: 1 });
chatConversationSchema.index({ participantIds: 1, lastMessageAt: -1 });

// There is deliberately NO "one open support thread per user" index any more:
// every problem report opens its own ticket, and a user with two problems has
// two. The index that used to enforce it (`uniq_open_support_per_user`) is
// dropped on boot by migrations/supportTickets.js; chatChannelsUpgrade.js
// must not recreate it.
chatConversationSchema.index({ reportId: 1 }, { sparse: true });

// At most one BLANK ticket per user: opened by "Message the team" (or an
// admin) and not yet typed into. Two concurrent opens must land on the same
// empty thread rather than leave two behind; the loser of the race hits
// E11000 and re-reads (utils/supportTickets.js). The moment a message or a
// report is attached the row leaves the index, and the next open makes a
// new ticket, which is the whole point.
chatConversationSchema.index(
  { userId: 1 },
  {
    unique: true,
    name: 'uniq_blank_ticket_per_user',
    partialFilterExpression: {
      type: 'support', status: 'open', messageCount: 0, hasReport: false,
    },
  },
);

chatConversationSchema.index(
  { 'channel.cohortKey': 1 },
  {
    unique: true,
    name: 'uniq_cbat_cohort',
    partialFilterExpression: { type: 'channel', 'channel.audience': 'cbat-cohort' },
  },
);

// One DM per unordered pair of users.
chatConversationSchema.index(
  { participantKey: 1 },
  {
    unique: true,
    name: 'uniq_dm_pair',
    partialFilterExpression: { type: 'dm' },
  },
);

// Channel slugs are unique among LIVE channels only — archiving a channel frees
// its name for reuse, which is why the filter carries `isArchived: false`
// rather than testing `archivedAt` for null.
chatConversationSchema.index(
  { 'channel.slug': 1 },
  {
    unique: true,
    name: 'uniq_live_channel_slug',
    partialFilterExpression: { type: 'channel', isArchived: false },
  },
);

// Canonical key for a DM pair. Exported so routes and tests agree on the form.
chatConversationSchema.statics.dmKey = function dmKey(a, b) {
  return [String(a), String(b)].sort().join('_');
};

module.exports = mongoose.model('ChatConversation', chatConversationSchema);
