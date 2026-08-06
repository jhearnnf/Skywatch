// Is the app being viewed from the machine that can actually do video work?
//
// Clipper's later stages (footage capture, Voicebox voice, rendering) all run
// in a local agent process on the author's workstation — Railway has no GPU, no
// browser and no disk to spare. Reaching Clipper from skywatch.academy on a
// phone would therefore show a tool whose main buttons cannot work, so the nav
// entry and page are gated on this instead.
//
// Deliberately a hostname check rather than an agent ping: the nav has to
// decide what to render on first paint, before any network call has resolved,
// and a link that appears then greys out a moment later is worse than one that
// was never offered. Whether the agent is actually *running* is a separate
// question, answered by the status pill inside the page.

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);

// Pass a hostname to test one explicitly; omit it (or pass null/undefined) to
// read the current window. An explicit empty string is treated as an unknown
// host and is never local — it must not silently fall back to the window, or a
// caller passing a value that happened to be blank would get the answer for a
// completely different host.
export function isLocalEnvironment(hostname) {
  const fromWindow = typeof window !== 'undefined' ? window.location.hostname : '';
  const host = String(hostname ?? fromWindow).toLowerCase();

  if (!host) return false;
  if (LOCAL_HOSTNAMES.has(host)) return true;

  // `.local` is mDNS (a Mac or phone reaching this dev box by name), and the
  // private IPv4 ranges cover a second device on the same LAN hitting the Vite
  // dev server. Both are still "the workstation is right there".
  if (host.endsWith('.local')) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;

  return false;
}
