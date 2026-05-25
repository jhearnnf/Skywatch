const mongoose = require('mongoose');

const IMAGE_MODES = ['none', 'placeholder', 'custom', 'upload'];

const viewedBySchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  viewedAt: { type: Date, default: Date.now },
  // Optional free-text "have your say" answer. Only populated when the parent
  // notification has responsesEnabled === true and the user typed something
  // into the modal before dismissing. Empty string when the input was left blank.
  response: { type: String, default: '' },
}, { _id: false });

// Admin-authored in-app announcements. Selection rule (see routes/updateNotifications.js):
// the "current" notification for a user is the single newest doc that is enabled,
// inside its validFrom/expiresAt window, and whose viewedBy does not include them.
// Older valid notifications a user never saw are intentionally skipped — they are
// reachable only via the Previous/Next browser inside the modal.
const updateNotificationSchema = new mongoose.Schema({
  title:      { type: String, required: true, trim: true },
  body:       { type: String, required: true },

  // 'none' (default) renders no image; 'placeholder' renders /images/placeholder-brief.svg
  // on the frontend; 'custom' uses an admin-supplied imageUrl; 'upload' uses a
  // Cloudinary-hosted imageUrl produced by POST /admin/update-notifications/upload-image.
  // imageUrl is ignored when mode is 'none' or 'placeholder'.
  imageMode:  { type: String, enum: IMAGE_MODES, default: 'none' },
  imageUrl:   { type: String, default: '' },

  enabled:    { type: Boolean, default: true },
  validFrom:  { type: Date, default: null }, // null => live immediately
  expiresAt:  { type: Date, default: null }, // null => never expires

  // When true, the user-facing modal shows a textarea so each reader can type
  // a free-text response ("have your say"). Responses are stored on the
  // matching viewedBy entry and surfaced to admins via the viewers endpoint.
  responsesEnabled: { type: Boolean, default: false },

  // Path the modal targets. Empty string => show on the first authed page load
  // for any path (after the user dismisses, it's gone for them).
  targetPath: { type: String, default: '' },

  // When true, this notification only reaches users who already existed at the
  // cutoff time: validFrom if set, otherwise the notification's createdAt.
  // Users registered after that cutoff never see it. Intended for announcements
  // that don't make sense to new joiners ("we just launched X").
  applyToExistingOnly: { type: Boolean, default: false },

  createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  viewedBy:   { type: [viewedBySchema], default: [] },
}, { timestamps: true });

// Selection rule helper indexes.
updateNotificationSchema.index({ enabled: 1, validFrom: 1, expiresAt: 1, createdAt: -1 });
updateNotificationSchema.index({ 'viewedBy.userId': 1 });

// Build the Mongo filter for "active right now" (enabled + inside time window).
updateNotificationSchema.statics.activeFilter = function (now = new Date()) {
  return {
    enabled: true,
    $and: [
      { $or: [{ validFrom: null }, { validFrom: { $lte: now } }] },
      { $or: [{ expiresAt: null }, { expiresAt: { $gte: now } }] },
    ],
  };
};

updateNotificationSchema.statics.IMAGE_MODES = IMAGE_MODES;

module.exports = mongoose.model('UpdateNotification', updateNotificationSchema);
