const mongoose = require('mongoose');

// One row per device that has said yes to push notifications. An account can
// have several (a phone running the Android app, a laptop with the installed
// web app), and each is addressed differently:
//
//   'web' — a browser / installed web app. `endpoint` is the push service URL
//           the browser handed us and `keys` are what web-push encrypts with.
//   'fcm' — the Android app. `endpoint` holds the Firebase registration token.
//
// `endpoint` is unique across both kinds, so a device that subscribes again
// (or changes hands between accounts on the same phone) updates its one row
// rather than collecting duplicates. Rows are removed when the push service
// says the address is gone (410/404, or FCM's UNREGISTERED), when the user
// turns notifications off on that device, and with the account.
//
// WHAT a user is notified about is not stored here: that is an account-level
// choice (User.pushPrefs), so one switch in Settings applies to every device.
const pushSubscriptionSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  kind:     { type: String, enum: ['web', 'fcm'], required: true },
  endpoint: { type: String, required: true, unique: true },
  keys: {
    type: {
      _id:    false,
      p256dh: { type: String, required: true },
      auth:   { type: String, required: true },
    },
    default: undefined,
  },
  // Free text from the client ("android", "web"), only for the admin's
  // curiosity and debugging. Never used to decide anything.
  platform:   { type: String, default: null },
  lastSeenAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);
