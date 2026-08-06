const mongoose = require('mongoose');

// Per-user, per-conversation read state.
//
// The original support chat kept `userLastReadAt` on the conversation itself,
// which works only because a support thread has exactly one user. A channel has
// many readers, so read state has to move off the conversation and into its own
// collection keyed by (user, conversation).
//
// Absence of a row means UNREAD, for every type. The Community dot is meant to
// tell every user there is something new, not only those who have already been
// in a given channel. A user who has never opened Community therefore sees the
// dot once for the existing backlog; opening it clears that permanently, and
// anyone who does not want the badge can turn it off entirely via
// User.communityNotificationsEnabled.
//
// See isUnread() in routes/chat.js, which is the one place this rule is applied.
const chatReadSchema = new mongoose.Schema({
  userId:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatConversation', required: true },
  lastReadAt:     { type: Date, default: Date.now },
});

chatReadSchema.index({ userId: 1, conversationId: 1 }, { unique: true });
chatReadSchema.index({ conversationId: 1 });

module.exports = mongoose.model('ChatRead', chatReadSchema);
