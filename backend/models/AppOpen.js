const mongoose = require('mongoose');
const { NATIVE_PLATFORMS } = require('../constants/clientPlatforms');
const { ymdInTz } = require('../constants/activity');

// One row per (account, native platform, calendar day) — "this account had the
// app open that day". Written from the heartbeat, which is the only signal we
// get that the app is actually open; there is no separate launch event.
//
// Why a collection and not a field on User: lastClients.<platform>.lastSeenAt
// already answers "did they open it today?", but it only ever remembers the most
// recent open, so it can say nothing about the days before. The Test Usage chart
// plots a 7-day series, so the days have to be kept.
//
// `day` is stored as a pre-bucketed Europe/London YYYY-MM-DD string rather than
// a timestamp. That makes the daily series a plain read with no per-row timezone
// conversion, and makes the upsert key naturally idempotent — one row per
// account per day however many heartbeats arrive.
const appOpenSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  platform: { type: String, enum: NATIVE_PLATFORMS, required: true },
  day:      { type: String, required: true },   // YYYY-MM-DD in ACTIVITY_TZ
  openedAt: { type: Date,   required: true },   // first heartbeat of that day
});

// The upsert key. Unique so concurrent heartbeats can't both insert.
appOpenSchema.index({ userId: 1, platform: 1, day: 1 }, { unique: true });
// Reports scan by day across all testers.
appOpenSchema.index({ day: 1 });

// Record that `userId` had the app open on `platform` at `when`. Idempotent:
// the first heartbeat of the day inserts, every later one matches the existing
// row and writes nothing. Callers treat this as best-effort — a failure here
// must never cost the heartbeat its presence update.
appOpenSchema.statics.record = function record(userId, platform, when = new Date()) {
  const day = ymdInTz(when);
  return this.updateOne(
    { userId, platform, day },
    { $setOnInsert: { userId, platform, day, openedAt: when } },
    { upsert: true },
  );
};

module.exports = mongoose.model('AppOpen', appOpenSchema);
