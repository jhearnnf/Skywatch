const mongoose = require('mongoose');
const { EMAIL_TYPES, EMAIL_STATUS } = require('../constants/emailLog');

const emailLogSchema = new mongoose.Schema({
  type:            { type: String, enum: EMAIL_TYPES, required: true },
  recipientEmail:  { type: String, required: true, lowercase: true, trim: true },
  recipientUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  subject:         { type: String, trim: true },
  status:          { type: String, enum: EMAIL_STATUS, required: true },
  error:           { type: String, default: null },
  metadata:        { type: mongoose.Schema.Types.Mixed, default: {} },
  sentAt:          { type: Date, default: Date.now },
});

emailLogSchema.index({ sentAt: -1 });
emailLogSchema.index({ type: 1 });
emailLogSchema.index({ status: 1 });
emailLogSchema.index({ recipientEmail: 1 });
emailLogSchema.index({ recipientUserId: 1, sentAt: -1 }); // per-user email history

module.exports = mongoose.model('EmailLog', emailLogSchema);
