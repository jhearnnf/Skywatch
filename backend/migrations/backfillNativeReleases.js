'use strict';

const User = require('../models/User');
const NativeRelease = require('../models/NativeRelease');
const { NATIVE_PLATFORMS } = require('../constants/clientPlatforms');

// Seeds NativeRelease with every build devices were already running before the
// collection existed, stamped at the epoch: they are long since live on the
// store, so none of them should sit out the settle window. Without this the
// first heartbeat after deploy would stamp them "first seen now" and hide every
// genuine update for an hour.
//
// Runs once ever: a non-empty collection means it has run (or the heartbeat is
// already populating it with real first-seen times, which must not be touched).
module.exports = async function backfillNativeReleases() {
  if (await NativeRelease.estimatedDocumentCount() > 0) return { seeded: 0 };

  let seeded = 0;
  for (const platform of NATIVE_PLATFORMS) {
    const field = `lastClients.${platform}`;
    const builds = await User.aggregate([
      { $match: { [`${field}.buildNumber`]: { $ne: null } } },
      { $group: { _id: `$${field}.buildNumber`, version: { $max: `$${field}.version` } } },
    ]);
    for (const { _id: build, version } of builds) {
      const res = await NativeRelease.updateOne(
        { platform, build },
        { $setOnInsert: { platform, build, version: version ?? null, firstSeenAt: new Date(0) } },
        { upsert: true },
      );
      seeded += res.upsertedCount;
    }
  }
  return { seeded };
};
