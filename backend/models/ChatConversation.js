const mongoose = require('mongoose');

// One collection backs all three kinds of chat, discriminated by `type`:
//
//   'support'  — the original user↔"Skywatch Help Team" thread. `userId` is the
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

  // ── dm ─────────────────────────────────────────────────────────────────────
  // Exactly two ids, sorted ascending so the pair has one canonical form.
  participantIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  // "<idA>_<idB>" from the sorted pair. Unique+sparse, so two users racing to
  // open a DM with each other can't end up with two threads — the loser of the
  // race hits E11000 and re-resolves, same pattern as the support chat.
  participantKey: { type: String, default: null },

  // ── channel ────────────────────────────────────────────────────────────────
  channel: {
    name:        { type: String, trim: true, maxlength: 40,  default: null },
    slug:        { type: String, trim: true, lowercase: true, default: null },
    description: { type: String, trim: true, maxlength: 200, default: null },
    emoji:       { type: String, trim: true, maxlength: 8,   default: null },
    order:       { type: Number, default: 0 },
    // Read by everyone, posted to by admins only — an announcements board
    // rather than a conversation. Enforced server-side in postRefusal().
    adminOnly:   { type: Boolean, default: false },
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

// At most one open SUPPORT conversation per user. Enforced at the DB level so
// two concurrent "start chat" requests can't both insert (the second hits
// E11000 and the route handler retries the lookup).
//
// NOTE: this replaces an older index of the same shape whose filter lacked
// `type`. Without the type clause, DMs and channels (which have userId null)
// would all collide on the single null key. migrations/chatChannelsUpgrade.js
// drops the old one and builds this.
chatConversationSchema.index(
  { userId: 1 },
  {
    unique: true,
    name: 'uniq_open_support_per_user',
    partialFilterExpression: { status: 'open', type: 'support' },
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
