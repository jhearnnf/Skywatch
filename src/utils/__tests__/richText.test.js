import { describe, it, expect } from 'vitest'
import { isRichHtml, escapeHtml, sanitizeRichHtml, htmlToPlainText } from '../richText'

describe('isRichHtml', () => {
  it('detects our inline tags', () => {
    expect(isRichHtml('<b>hi</b>')).toBe(true)
    expect(isRichHtml('a <span style="color: red">x</span>')).toBe(true)
    expect(isRichHtml('line<br>break')).toBe(true)
  })

  it('treats plain text (even with stray < or URLs) as not rich', () => {
    expect(isRichHtml('just text')).toBe(false)
    expect(isRichHtml('a < b comparison')).toBe(false)
    expect(isRichHtml('visit https://example.com now')).toBe(false)
    expect(isRichHtml(null)).toBe(false)
  })
})

describe('escapeHtml', () => {
  it('escapes the dangerous characters', () => {
    expect(escapeHtml('<b>&"\'')).toBe('&lt;b&gt;&amp;&quot;&#39;')
  })
})

describe('sanitizeRichHtml', () => {
  it('keeps allowlisted inline formatting', () => {
    expect(sanitizeRichHtml('<b>bold</b> <i>it</i> <u>u</u>')).toBe('<b>bold</b> <i>it</i> <u>u</u>')
  })

  it('keeps a safe span colour', () => {
    const out = sanitizeRichHtml('<span style="color: red">x</span>')
    expect(out).toContain('<span')
    expect(out).toContain('color: red')
    expect(out).toContain('x')
  })

  it('strips an unsafe colour value but keeps the text', () => {
    const out = sanitizeRichHtml('<span style="color: url(evil)">x</span>')
    expect(out).toBe('<span>x</span>')
  })

  it('normalises legacy <font color> to a coloured span', () => {
    const out = sanitizeRichHtml('<font color="#ff0000">x</font>')
    expect(out).toContain('<span')
    // Browsers serialize the colour as rgb(), so match either form.
    expect(out.toLowerCase()).toMatch(/color:\s*(#ff0000|rgb\(255,\s*0,\s*0\))/)
  })

  it('drops <script> entirely', () => {
    expect(sanitizeRichHtml('<script>alert(1)</script>hello')).toBe('hello')
  })

  it('removes event-handler attributes', () => {
    expect(sanitizeRichHtml('<b onclick="steal()">hi</b>')).toBe('<b>hi</b>')
  })

  it('unwraps disallowed tags, keeping their text', () => {
    expect(sanitizeRichHtml('<h1>Title</h1>')).toBe('Title')
    // an <img> has no children, so nothing is rendered
    expect(sanitizeRichHtml('<img src=x onerror=alert(1)>hi')).toBe('hi')
  })

  it('keeps http(s) anchors and hardens them', () => {
    const out = sanitizeRichHtml('<a href="https://x.test/p">link</a>')
    expect(out).toContain('href="https://x.test/p"')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noopener noreferrer"')
  })

  it('drops non-http anchors but keeps their label', () => {
    expect(sanitizeRichHtml('<a href="javascript:alert(1)">click</a>')).toBe('click')
  })

  it('auto-links bare URLs in text', () => {
    const out = sanitizeRichHtml('see https://x.test now')
    expect(out).toContain('<a href="https://x.test"')
    expect(out).toContain('target="_blank"')
  })

  it('does not double-link a URL already inside an anchor', () => {
    const out = sanitizeRichHtml('<a href="https://x.test">https://x.test</a>')
    // exactly one anchor, no nested <a>
    expect(out.match(/<a /g)).toHaveLength(1)
  })

  it('flattens block tags to <br> boundaries', () => {
    expect(sanitizeRichHtml('<div>a</div><div>b</div>')).toBe('a<br>b')
  })

  it('returns empty string for empty input', () => {
    expect(sanitizeRichHtml('')).toBe('')
    expect(sanitizeRichHtml(null)).toBe('')
  })
})

describe('htmlToPlainText', () => {
  it('strips inline formatting to plain text', () => {
    expect(htmlToPlainText('<b>bold</b> and <i>italic</i>')).toBe('bold and italic')
  })

  it('drops a coloured span but keeps its text', () => {
    expect(htmlToPlainText('a <span style="color: red">warn</span> b')).toBe('a warn b')
  })

  it('turns <br> into newlines', () => {
    expect(htmlToPlainText('line one<br>line two')).toBe('line one\nline two')
  })

  it('keeps links as [label](url) markdown so the fallback stays clickable', () => {
    expect(htmlToPlainText('see <a href="https://x.test/p">the docs</a> now'))
      .toBe('see [the docs](https://x.test/p) now')
  })

  it('collapses a link whose label equals its href to just the url', () => {
    expect(htmlToPlainText('<a href="https://x.test">https://x.test</a>')).toBe('https://x.test')
  })

  it('returns empty string for empty input', () => {
    expect(htmlToPlainText('')).toBe('')
    expect(htmlToPlainText(null)).toBe('')
  })
})
