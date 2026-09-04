// Splits a Verbal Logic Test tab's prose around the sentences the post-answer
// review wants to point at.
//
// It lives here rather than in CbatVlt.jsx because a page file that exports
// anything but its component loses fast refresh, and because the invariant below
// is worth testing on its own: whatever the spans, the parts must reassemble
// into exactly the original text. The player is reading the tab, not a
// rendering of it.
//
// markUpTabText(text, [{ quote, kind }]) → [{ text, kind? }]
//   `kind` is 'answer' or 'trap'; a part without one is untouched prose.

export function markUpTabText(text, spans) {
  const found = []
  for (const span of spans) {
    const start = text.indexOf(span.quote)
    if (start === -1) continue
    found.push({ start, end: start + span.quote.length, kind: span.kind })
  }
  found.sort((a, b) => a.start - b.start)

  // Left to right, dropping any span that starts inside one already taken. An
  // answer quote and a trap quote sharing a sentence is legal in the packs; two
  // marks over the same words, or the words rendered twice, is not.
  const parts = []
  let cursor = 0
  for (const span of found) {
    if (span.start < cursor) continue
    if (span.start > cursor) parts.push({ text: text.slice(cursor, span.start) })
    parts.push({ text: text.slice(span.start, span.end), kind: span.kind })
    cursor = span.end
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) })
  return parts
}
