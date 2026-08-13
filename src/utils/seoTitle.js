// Title formatting for <SEO>. Lives outside SEO.jsx so that file exports a
// component and nothing else (fast refresh requires it), and so the rules below
// can be unit-tested without mounting a component. See src/__tests__/seo-audit.test.js.

export const SITE_NAME = 'SkyWatch'
export const SITE_URL = 'https://skywatch.academy'

// The search term people actually type is "CBAT", so that is what an untitled
// page leads with. Two standing rules constrain this copy and any future edit to
// it: our games are CBAT-*style* practice, never the real test, and we do not
// claim to help with an RAF application.
export const DEFAULT_TITLE = 'CBAT Practice Tests for Aircrew Aptitude Training'

// Keep descriptions at or under 160 characters — Google truncates around there,
// and a sentence cut mid-word reads as neglect. seo-audit.test.js enforces it.
export const DEFAULT_DESCRIPTION =
  'Free CBAT-style practice tests covering every aircrew aptitude subtest, from FLAG and ANT to DPT and ACT. Train against the clock and track your scores.'

// Several callers used to pass a title that already ended in "— SkyWatch",
// which the template below then suffixed a second time ("Debrief — SkyWatch —
// SkyWatch"). Google truncates on width, so the duplicate ate the part of the
// title that carried meaning. Strip any trailing site name before formatting so
// a call site cannot reintroduce it.
const TRAILING_SITE_NAME = /\s*[—–-]\s*SkyWatch\s*$/i

export function formatTitle(title) {
  const trimmed = typeof title === 'string' ? title.replace(TRAILING_SITE_NAME, '').trim() : ''
  // Keyword first, brand last, on every page including the untitled home page.
  // Google weights the front of the title and truncates the tail, so leading
  // with "SkyWatch" would spend the visible half of the tag on a brand nobody
  // is searching for yet.
  if (!trimmed) return `${DEFAULT_TITLE} — ${SITE_NAME}`
  return `${trimmed} — ${SITE_NAME}`
}
