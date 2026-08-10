const User = require('../models/User');
const { NATIVE_PLATFORMS } = require('../constants/clientPlatforms');

// The newest native release seen in the wild, per platform.
//
// Two callers, same yardstick: Admin › Users compares each account's last-known
// build against it, and GET /api/users/latest-release hands it to the app so a
// device can tell whether it is running something older.
//
// Derived from what users actually report rather than from configuration, so
// there is nothing to remember to bump at release time. This is only sound
// because Play/App Store rules require versionCode (Android) and build number
// (iOS) to increase with every upload: the highest one anybody is running is
// therefore the newest one that exists. Version *names* would not work here —
// "1.10.0" sorts below "1.9.0" as a string, and nothing stops a name being
// reused across builds.
//
// Known imprecision, accepted: a tester on a Play testing track is running a
// real, higher versionCode that production users cannot install from the public
// store page. They would be told an update exists, tap through, and see "Open"
// rather than "Update". That is a mild annoyance in one direction only — it
// never hides a genuine update, and it never claims a version that does not
// exist — which is why this stays derived instead of becoming another setting
// to maintain.
//
// Web is deliberately absent: a commit sha has no ordering, so "latest web
// build" cannot be derived this way. Web answers the staleness question by
// force-refreshing instead (see src/utils/appUpdate.js), which needs no
// yardstick at all.
async function latestNativeReleases() {
  const entries = await Promise.all(NATIVE_PLATFORMS.map(async platform => {
    const field = `lastClients.${platform}`;
    const newest = await User.findOne({ [`${field}.buildNumber`]: { $ne: null } })
      .sort({ [`${field}.buildNumber`]: -1 })
      .select(field)
      .lean();
    const info = newest?.lastClients?.[platform];
    return [platform, info ? { version: info.version, build: info.build } : null];
  }));
  return Object.fromEntries(entries);
}

module.exports = { latestNativeReleases };
