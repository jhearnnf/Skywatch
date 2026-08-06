const mongoose = require('mongoose');

// senderUserId is null for system messages (e.g. "User closed this chat").
// For admin messages it records which admin replied — internally visible to
// admins, while the user view of a SUPPORT thread collapses all admin messages
// to the single "Skywatch Support" identity. In channels and DMs admins post
// under their own display name like anyone else.
const chatMessageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatConversation', required: true },
  senderUserId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  senderRole:     { type: String, enum: ['user', 'admin', 'system'], required: true },
  body:           { type: String, required: true, trim: true, maxlength: 4000 },
  createdAt:      { type: Date, default: Date.now },

  // Display name captured at send time. Display names change (on a 30-day
  // cooldown), and a moderation transcript needs to show the name that was on
  // screen when the message was sent, not whatever the account is called today.
  senderDisplayName: { type: String, default: null },

  // Commit SHAs this message announced, when it came from the GitHub-backed
  // update drafter. Recorded so the next draft run can skip work that has
  // already been announced rather than offering it again.
  announcedCommitShas: { type: [String], default: undefined },

  // Soft delete. The body is preserved so admins can still read what was said
  // — a moderation record that erases the evidence is useless. Non-admin
  // readers get a "Message removed by a moderator" placeholder instead.
  deletedAt:        { type: Date, default: null },
  deletedByUserId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
});

chatMessageSchema.index({ conversationId: 1, createdAt: 1 });
// Backs the admin "everything this user has said" transcript view.
chatMessageSchema.index({ senderUserId: 1, createdAt: -1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
