// Allowlisted rich-text sanitizer for admin-authored update-notification bodies.
//
// Notification bodies are edited in a small WYSIWYG editor (bold / italic /
// underline / colour + links) and stored as HTML. Only a tiny inline-tag and
// attribute allowlist survives sanitization, so the stored HTML is always safe
// to render to every user via dangerouslySetInnerHTML. Everything is flattened
// to INLINE content (block tags become <br>) so the result is valid inside the
// <p> wrapper the notification UIs already use.

// Inline elements we keep. Block tags (DIV/P) are handled separately by
// flattening them to <br>; everything else is unwrapped (children kept, tag
// dropped) or, for the dangerous set below, dropped entirely.
const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'A', 'SPAN'])
const DROP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META',
  'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH', 'HEAD', 'TITLE',
])

// Safe CSS colour values only: #hex, rgb()/rgba(), or a plain colour keyword.
// Anything with parentheses-based functions like url()/expression() is rejected.
const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]+\)|[a-z]+)$/i
const BARE_URL = /(https?:\/\/[^\s<]+[^\s<.,:;!?)\]])/g

// Same look as the plain-text linkifier's <a> (LinkChunk), so links match
// whether a body is rich HTML or plain text. These classes are already used
// elsewhere, so Tailwind keeps them in the build.
const LINK_CLASS = 'text-brand-700 font-semibold hover:underline hover:brightness-110 break-words'

// Cheap heuristic: does this string contain any of our rich-text tags? Used to
// decide between the HTML render path and the plain-text linkifier fallback.
export function isRichHtml(str) {
  return typeof str === 'string' && /<(b|strong|i|em|u|span|a|br)\b/i.test(str)
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function safeHref(href) {
  if (typeof href !== 'string') return null
  const v = href.trim()
  return /^https?:\/\//i.test(v) ? v : null
}

// Turn bare http(s) URLs inside a text run into anchors, returning a fragment.
function autolinkTextNode(text, doc) {
  const frag = doc.createDocumentFragment()
  let last = 0
  let m
  BARE_URL.lastIndex = 0
  while ((m = BARE_URL.exec(text)) !== null) {
    if (m.index > last) frag.appendChild(doc.createTextNode(text.slice(last, m.index)))
    const a = doc.createElement('a')
    a.setAttribute('href', m[0])
    finalizeAnchor(a)
    a.textContent = m[0]
    frag.appendChild(a)
    last = m.index + m[0].length
  }
  if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)))
  return frag
}

function finalizeAnchor(el) {
  el.setAttribute('target', '_blank')
  el.setAttribute('rel', 'noopener noreferrer')
  el.setAttribute('class', LINK_CLASS)
}

function walk(src, destParent, doc, insideAnchor) {
  src.childNodes.forEach((node) => {
    // Text node — linkify bare URLs, but never nest an <a> inside an <a>.
    if (node.nodeType === 3) {
      if (insideAnchor) destParent.appendChild(doc.createTextNode(node.nodeValue))
      else destParent.appendChild(autolinkTextNode(node.nodeValue, doc))
      return
    }
    if (node.nodeType !== 1) return // comments etc.

    const tag = node.tagName
    if (DROP_TAGS.has(tag)) return

    // Block containers → flatten to a <br> boundary, keep children inline.
    if (tag === 'DIV' || tag === 'P') {
      if (destParent.childNodes.length && destParent.lastChild?.nodeName !== 'BR') {
        destParent.appendChild(doc.createElement('br'))
      }
      walk(node, destParent, doc, insideAnchor)
      return
    }

    // Legacy execCommand('foreColor') output → normalise <font color> to <span>.
    if (tag === 'FONT') {
      const span = doc.createElement('span')
      const color = node.getAttribute('color')
      if (color && COLOR_RE.test(color)) span.style.color = color
      walk(node, span, doc, insideAnchor)
      destParent.appendChild(span)
      return
    }

    // Anything not in the allowlist: drop the tag but keep its children.
    if (!ALLOWED_TAGS.has(tag)) {
      walk(node, destParent, doc, insideAnchor)
      return
    }

    if (tag === 'BR') {
      destParent.appendChild(doc.createElement('br'))
      return
    }

    if (tag === 'A') {
      const href = safeHref(node.getAttribute('href'))
      if (!href) { walk(node, destParent, doc, insideAnchor); return }
      const el = doc.createElement('a')
      el.setAttribute('href', href)
      finalizeAnchor(el)
      walk(node, el, doc, true)
      destParent.appendChild(el)
      return
    }

    const el = doc.createElement(tag.toLowerCase())
    if (tag === 'SPAN') {
      const color = node.style?.color
      if (color && COLOR_RE.test(color)) el.style.color = color
    }
    walk(node, el, doc, insideAnchor)
    destParent.appendChild(el)
  })
}

// Sanitize admin-authored rich HTML down to the inline allowlist. Safe to feed
// the result to dangerouslySetInnerHTML.
export function sanitizeRichHtml(html) {
  if (!html || typeof html !== 'string') return ''
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const clean = doc.createElement('div')
  walk(doc.body, clean, doc, false)
  return clean.innerHTML
}

function collectText(node) {
  let out = ''
  node.childNodes.forEach((n) => {
    if (n.nodeType === 3) { out += n.nodeValue; return }
    if (n.nodeType !== 1) return
    const tag = n.tagName
    if (tag === 'BR') { out += '\n'; return }
    if (tag === 'A') {
      // Preserve links as markdown so the plain-text fallback stays clickable
      // via renderBodyWithLinks. Skip [url](url) noise when label === href.
      const href = n.getAttribute('href') || ''
      const label = collectText(n)
      out += (label && href && label !== href) ? `[${label}](${href})` : (href || label)
      return
    }
    if (tag === 'DIV' || tag === 'P') {
      if (out && !out.endsWith('\n')) out += '\n'
      out += collectText(n)
      if (!out.endsWith('\n')) out += '\n'
      return
    }
    out += collectText(n) // inline formatting (b/i/u/span…) — strip the tag
  })
  return out
}

// Derive the plain-text fallback for a rich HTML body: strips formatting,
// turns <br>/blocks into newlines, and keeps links as [label](url) markdown so
// older clients (which render `body` as plain text) still get working links.
export function htmlToPlainText(html) {
  if (!html || typeof html !== 'string') return ''
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  return collectText(doc.body)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
