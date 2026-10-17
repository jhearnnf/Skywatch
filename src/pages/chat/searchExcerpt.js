// How much of a long message a search result shows either side of the first
// match, so a hit at the end of a long paragraph is still visible in a
// one-line result.
const EXCERPT_LEAD = 40
const EXCERPT_LEN  = 140

export function excerptAround(body, query) {
  const text = String(body ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= EXCERPT_LEN) return text
  const at = text.toLowerCase().indexOf(String(query).toLowerCase())
  const start = Math.max(0, Math.min(at - EXCERPT_LEAD, text.length - EXCERPT_LEN))
  const cut = text.slice(start, start + EXCERPT_LEN)
  return `${start > 0 ? '…' : ''}${cut}${start + EXCERPT_LEN < text.length ? '…' : ''}`
}
