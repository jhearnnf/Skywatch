const mongoose = require('mongoose');

// senderUserId is null for system messages (e.g. "User closed this chat").
// For admin messages it records which admin replied — internally visible to
// admins, while the user view collapses all admin messages to the single
// "Skywatch Support" identity.
const chatMessageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatConversation', required: true },
  senderUserId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  senderRole:     { type: String, enum: ['user', 'admin', 'system'], required: true },
  body:           { type: String, required: true, trim: true, maxlength: 4000 },
  createdAt:      { type: Date, default: Date.now },
});

chatMessageSchema.index({ conversationId: 1, createdAt: 1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
