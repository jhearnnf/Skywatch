const mongoose = require('mongoose');

// One conversation per (user, "Skywatch Help Team"). Future: swap userId for
// participantIds: [a, b] to support user↔user chats. Admin replies are not
// participants — any admin can read/reply via the shared adminLastReadAt.
const chatConversationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  status:   { type: String, enum: ['open', 'closed'], default: 'open' },
  closedAt: { type: Date, default: null },
  closedBy: { type: String, enum: ['user', 'admin', 'system', null], default: null },
  closedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  startedByRole: { type: String, enum: ['user', 'admin'], required: true },

  lastMessageAt:         { type: Date, default: Date.now },
  lastMessageSenderRole: { type: String, enum: ['user', 'admin', 'system'], default: 'system' },

  // Sending = reading. Marking-read updates these. Closing snaps both to lastMessageAt
  // so the navbar dot doesn't point at a hidden surface.
  userLastReadAt:  { type: Date, default: null },
  adminLastReadAt: { type: Date, default: null },
}, { timestamps: true });

chatConversationSchema.index({ userId: 1, status: 1, lastMessageAt: -1 });
chatConversationSchema.index({ status: 1, lastMessageAt: -1 });
chatConversationSchema.index({ status: 1, lastMessageSenderRole: 1, adminLastReadAt: 1 });

// At most one open conversation per user. Enforced at the DB level so two
// concurrent "start chat" requests can't both insert (the second hits E11000
// and the route handler retries the lookup).
chatConversationSchema.index(
  { userId: 1 },
  { unique: true, partialFilterExpression: { status: 'open' } },
);

module.exports = mongoose.model('ChatConversation', chatConversationSchema);
