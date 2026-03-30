const mongoose = require('mongoose');

const userNotificationSchema = new mongoose.Schema({
  userId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:            { type: String, default: 'report_reply' },
  title:           { type: String, required: true },
  message:         { type: String, required: true },
  read:            { type: Boolean, default: false },
  relatedReportId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProblemReport' },
  createdAt:       { type: Date, default: Date.now },
});

userNotificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model('UserNotification', userNotificationSchema);
