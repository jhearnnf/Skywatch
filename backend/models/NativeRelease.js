const mongoose = require('mongoose');
const { NATIVE_PLATFORMS } = require('../constants/clientPlatforms');

// One row per native build ever reported on the heartbeat, stamped with the
// moment we first saw it.
//
// Why it exists: "the newest release" is derived from what devices report (see
// utils/latestNativeReleases.js), and the first device to report a new build is
// usually ours — installed from Android Studio or a Play testing track before
// Google has finished rolling the build out to the public listing. Without a
// first-seen time, every user was told to update the moment that happened, and
// the Play Store then had nothing newer to give them. GET /api/users/latest-
// release waits RELEASE_SETTLE_MS from firstSeenAt before offering a build.
const nativeReleaseSchema = new mongoose.Schema({
  platform:    { type: String, enum: NATIVE_PLATFORMS, required: true },
  build:       { type: Number, required: true },   // versionCode / build number
  version:     { type: String, default: null },
  firstSeenAt: { type: Date,   required: true },
});

nativeReleaseSchema.index({ platform: 1, build: -1 }, { unique: true });

// Builds already recorded this process, so a heartbeat from a known build
// costs no write. Only ever a few dozen entries.
const known = new Set();

// Idempotent: the first report of a build inserts, every later one matches and
// writes nothing, so firstSeenAt never moves. Best-effort at the call site.
nativeReleaseSchema.statics.record = async function record(platform, build, version, when = new Date()) {
  const key = `${platform}:${build}`;
  if (known.has(key)) return;
  await this.updateOne(
    { platform, build },
    { $setOnInsert: { platform, build, version, firstSeenAt: when } },
    { upsert: true },
  );
  known.add(key);
};

// Tests clear the database between cases, which the cache would not notice.
nativeReleaseSchema.statics.resetCache = () => known.clear();

module.exports = mongoose.model('NativeRelease', nativeReleaseSchema);
