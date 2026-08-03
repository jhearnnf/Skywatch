const mongoose = require('mongoose');
const { OS_KEYS } = require('../constants/clientPlatforms');

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
  // `body` is the plain-text version, shown to every client and used as the
  // fallback. `richBody` is the optional sanitized-HTML version (bold / italic
  // / colour / links). Clients that understand rich text render `richBody` when
  // it's non-empty and fall back to `body` otherwise; older clients only know
  // about `body`, so they always get a clean plain-text rendering. See
  // renderNotificationBody on the frontend.
  body:       { type: String, required: true },
  richBody:   { type: String, default: '' },

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

  // Operating systems this notification is for, from OS_KEYS. EMPTY MEANS EVERY
  // OS — not "no OS" — so an untargeted notification behaves exactly as it did
  // before this field existed. The OS is the one the reader is on *right now*
  // (derived from the request User-Agent), not every OS they've ever used, so a
  // Windows-only announcement stays hidden when that same account opens the
  // Android app.
  targetOs:    { type: [String], enum: OS_KEYS, default: [] },

  // Specific recipients. EMPTY MEANS EVERYONE. When non-empty, only these users
  // ever see the notification — it stacks with (does not override) targetOs and
  // applyToExistingOnly, so a listed user on the wrong OS still sees nothing.
  targetUsers: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },

  createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  viewedBy:   { type: [viewedBySchema], default: [] },
}, { timestamps: true });

// Selection rule helper indexes.
updateNotificationSchema.index({ enabled: 1, validFrom: 1, expiresAt: 1, createdAt: -1 });
updateNotificationSchema.index({ 'viewedBy.userId': 1 });
updateNotificationSchema.index({ targetUsers: 1 });

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

// Clause for an "empty means everyone" targeting array: matches docs where the
// field is absent (notifications written before the field existed), explicitly
// null, or an empty array — plus any doc that lists `value`. A null/undefined
// `value` means we could not work out what the reader is, so only untargeted
// notifications qualify.
function untargetedOrIncludes(field, value) {
  const anyone = { [field]: { $in: [null, []] } };
  if (value === null || value === undefined) return anyone;
  return { $or: [anyone, { [field]: value }] };
}

// Every "is this notification for this reader?" clause except the time window:
// OS targeting and per-user targeting. `os` is the reader's current OS key (see
// osFromUserAgent) or null when it could not be determined.
updateNotificationSchema.statics.audienceClauses = function (userId, os) {
  return [
    untargetedOrIncludes('targetOs', os || null),
    untargetedOrIncludes('targetUsers', userId || null),
  ];
};

updateNotificationSchema.statics.IMAGE_MODES = IMAGE_MODES;

module.exports = mongoose.model('UpdateNotification', updateNotificationSchema);
