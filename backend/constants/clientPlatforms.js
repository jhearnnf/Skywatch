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

// The operating systems we recognise on the heartbeat, for Admin › Users. Order
// is display order (desktop families first, then mobile).
const OS_KEYS = ['windows', 'mac', 'linux', 'ios', 'android'];

// Best-effort OS family from a browser User-Agent string. Order matters: an
// Android UA also contains "Linux", and an iOS UA contains neither, so the
// mobile families are tested before the generic desktop ones. Returns null when
// nothing recognisable matches — a missing OS must never break the heartbeat.
function osFromUserAgent(ua) {
  const s = String(ua ?? '');
  if (!s) return null;
  if (/iPhone|iPad|iPod/i.test(s))   return 'ios';
  if (/Android/i.test(s))            return 'android';
  if (/Windows/i.test(s))            return 'windows';
  if (/Mac OS X|Macintosh/i.test(s)) return 'mac';
  if (/Linux/i.test(s))              return 'linux';
  return null;
}

module.exports = { CLIENT_PLATFORMS, VERSION_PATTERN, sanitiseClientInfo, OS_KEYS, osFromUserAgent };
