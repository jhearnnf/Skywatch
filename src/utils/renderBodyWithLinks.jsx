/* eslint-disable react/no-array-index-key */

// Turns a plain-text notification body into React nodes with clickable links.
// Supports two forms, so admins can write links naturally:
//   • Markdown links:  [click here](https://example.com)
//   • Bare URLs:       https://example.com  (auto-linked)
// Everything else is rendered verbatim, preserving whitespace via the caller's
// `whitespace-pre-wrap`. Only http(s) URLs are linked (no javascript: etc.).

const MARKDOWN_LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g
const BARE_URL = /(https?:\/\/[^\s<]+[^\s<.,:;!?)\]])/g

function LinkChunk({ href, children }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-brand-700 font-semibold hover:underline hover:brightness-110 break-words"
    >
      {children}
    </a>
  )
}

// Linkify any bare URLs inside a plain-text run.
function linkifyBareUrls(text, keyPrefix) {
  const nodes = []
  let last = 0
  let match
  BARE_URL.lastIndex = 0
  while ((match = BARE_URL.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index))
    const url = match[0]
    nodes.push(
      <LinkChunk key={`${keyPrefix}-u${match.index}`} href={url}>{url}</LinkChunk>,
    )
    last = match.index + url.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

export default function renderBodyWithLinks(body) {
  if (!body) return null
  const out = []
  let last = 0
  let match
  let i = 0
  MARKDOWN_LINK.lastIndex = 0
  while ((match = MARKDOWN_LINK.exec(body)) !== null) {
    if (match.index > last) {
      out.push(...linkifyBareUrls(body.slice(last, match.index), `t${i}`))
    }
    out.push(
      <LinkChunk key={`m${match.index}`} href={match[2]}>{match[1]}</LinkChunk>,
    )
    last = match.index + match[0].length
    i++
  }
  if (last < body.length) {
    out.push(...linkifyBareUrls(body.slice(last), `t${i}`))
  }
  return out
}
