const mongoose = require('mongoose');

const emailLogSchema = new mongoose.Schema({
  type:            { type: String, enum: ['welcome', 'confirmation', 'password_reset', 'report_reply', 'test'], required: true },
  recipientEmail:  { type: String, required: true, lowercase: true, trim: true },
  recipientUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  subject:         { type: String, trim: true },
  status:          { type: String, enum: ['sent', 'failed'], required: true },
  error:           { type: String, default: null },
  metadata:        { type: mongoose.Schema.Types.Mixed, default: {} },
  sentAt:          { type: Date, default: Date.now },
});

emailLogSchema.index({ sentAt: -1 });
emailLogSchema.index({ type: 1 });
emailLogSchema.index({ status: 1 });
emailLogSchema.index({ recipientEmail: 1 });

module.exports = mongoose.model('EmailLog', emailLogSchema);
