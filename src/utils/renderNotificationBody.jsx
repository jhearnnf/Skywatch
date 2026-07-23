import renderBodyWithLinks from './renderBodyWithLinks'
import { isRichHtml, sanitizeRichHtml } from './richText'

// Single entry point for rendering an update-notification body.
//
//   • New bodies from the WYSIWYG editor are rich HTML → sanitized and rendered
//     as inline HTML (bold / italic / underline / colour + links).
//   • Older or unformatted bodies are plain text → handled by the existing
//     linkifier, which preserves whitespace and auto-links URLs / [label](url).
//
// The rich path emits inline-only markup, so it stays valid inside the <p>
// wrapper (with whitespace-pre-wrap) that the notification UIs already use.
export default function renderNotificationBody(body) {
  if (isRichHtml(body)) {
    return <span dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(body) }} />
  }
  return renderBodyWithLinks(body)
}
