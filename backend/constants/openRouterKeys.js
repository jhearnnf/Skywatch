// Every OpenRouter key the app bills against — the single source of truth.
//
// This lives in constants/ rather than utils/openRouter.js because the usage-log
// model needs it for its enum, and utils/openRouter.js already requires that
// model. Putting the table here breaks what would otherwise be a require cycle.
//
// Derived from this list: the usage-log key enum, the admin summary tiles, the
// spend page's key filters, and the log query allowlist. Keep it that way — a
// key added to one place but missed in another fails silently, because
// logUsage() swallows write errors by design. The calls still bill; the cost
// just never appears anywhere.
//
// `env` is the optional per-feature key; all of them fall back to
// OPENROUTER_KEY so a missing key degrades to shared billing, not an outage.
// `title` is sent as X-Title and is what labels the spend in OpenRouter's own
// dashboard.
const OPENROUTER_KEYS = {
  main:      { env: null,                       title: 'SkyWatch' },
  aptitude:  { env: 'OPENROUTER_KEY_APTITUDE',  title: 'SkyWatch APTITUDE_SYNC' },
  socials:   { env: 'OPENROUTER_KEY_SOCIALS',   title: 'SkyWatch Socials' },
  casefiles: { env: 'OPENROUTER_KEY_CASEFILES', title: 'SkyWatch Case Files' },
  briefreel: { env: 'OPENROUTER_KEY_BRIEFREEL', title: 'SkyWatch Brief Reel' },
  clipper:   { env: 'OPENROUTER_KEY_CLIPPER',   title: 'SkyWatch Clipper' },
  // Everything Community bills: the guide bot answering @mentions and DMs, and
  // the announcement drafter. Kept off `main` so a chat bot sitting in a public
  // channel can never take the brief pipeline down with it — an exhausted key
  // stops the bot and nothing else.
  community: { env: 'OPENROUTER_KEY_COMMUNITY', title: 'SkyWatch Community' },
};

const OPENROUTER_KEY_NAMES = Object.keys(OPENROUTER_KEYS);

module.exports = { OPENROUTER_KEYS, OPENROUTER_KEY_NAMES };
