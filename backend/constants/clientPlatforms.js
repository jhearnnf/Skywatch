// Platforms a client can report itself as on the heartbeat. Anything outside
// this list is discarded rather than stored — these strings come straight off
// the wire and end up rendered in the admin panel.
const CLIENT_PLATFORMS = ['web', 'android', 'ios'];

// Version/build strings are free text from the client (gradle versionName, a
// commit sha, a semver). Keep them short and boring: letters, digits and the
// punctuation real version strings actually use.
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/;

// Normalises a client-supplied `{ platform, version, build }` payload.
// Returns null for anything unusable — a bad payload must never prevent the
// heartbeat itself from recording presence.
function sanitiseClientInfo(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const platform = String(raw.platform ?? '').trim().toLowerCase();
  if (!CLIENT_PLATFORMS.includes(platform)) return null;

  const version = String(raw.version ?? '').trim();
  if (!VERSION_PATTERN.test(version)) return null;

  const build = String(raw.build ?? '').trim();
  return {
    platform,
    version,
    build: VERSION_PATTERN.test(build) ? build : null,
  };
}

module.exports = { CLIENT_PLATFORMS, VERSION_PATTERN, sanitiseClientInfo };
