const mongoose = require('mongoose');

// One row per photo or video a client has been given permission to upload
// into a chat. Written when the server signs the upload (POST
// /conversations/:id/attachments/sign), before a single byte has moved.
//
// It exists for two reasons:
//   • Ownership. A message may only attach a file this same user was signed
//     for, in this same conversation, and that no message has used yet. The
//     Cloudinary response signature proves the upload happened; this row
//     proves it was theirs to attach here.
//   • Cleanup. A file uploaded and then never sent (the tab closed, the user
//     removed it from the tray) would otherwise sit on Cloudinary for ever.
//     The sweep in routes/chat.js destroys anything still unattached a day on.
const chatUploadSchema = new mongoose.Schema({
  publicId:       { type: String, required: true, unique: true },
  kind:           { type: String, enum: ['image', 'video'], required: true },
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatConversation', required: true },
  userId:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  messageId:      { type: mongoose.Schema.Types.ObjectId, ref: 'ChatMessage', default: null },
  createdAt:      { type: Date, default: Date.now },
});

chatUploadSchema.index({ messageId: 1, createdAt: 1 });
chatUploadSchema.index({ userId: 1 });

module.exports = mongoose.model('ChatUpload', chatUploadSchema);
