// Generate a CSS selector that uniquely identifies `target` within the document.
//
// Priority chain (most→least stable):
//   1. data-tutorial-target attribute  → `[data-tutorial-target="..."]`
//   2. unique element id               → `#id`
//   3. tag + class chain with :nth-of-type, walking up ancestors until
//      the resulting selector matches exactly one node.
//
// Returns null if no unique selector can be built.
export function generateSelector(target) {
  if (!target || target.nodeType !== 1) return null

  // 1) data-tutorial-target — preferred, intentionally placed by the dev
  const tutAttr = target.getAttribute?.('data-tutorial-target')
  if (tutAttr) {
    const sel = `[data-tutorial-target="${cssEscape(tutAttr)}"]`
    if (uniqueMatch(sel)) return sel
  }

  // 2) unique id
  if (target.id && /^[A-Za-z][\w-]*$/.test(target.id)) {
    const sel = `#${cssEscape(target.id)}`
    if (uniqueMatch(sel)) return sel
  }

  // 3) walk up, building a selector path until it uniquely matches
  const parts = []
  let el = target
  while (el && el.nodeType === 1 && el !== document.body && el !== document.documentElement) {
    parts.unshift(localPart(el))
    const candidate = parts.join(' > ')
    if (uniqueMatch(candidate)) return candidate
    el = el.parentElement
  }

  // Fall back to body-rooted full path
  const candidate = `body > ${parts.join(' > ')}`
  return uniqueMatch(candidate) ? candidate : null
}

// Build the local-part for a single element: tag + significant classes + nth-of-type.
function localPart(el) {
  const tag = el.tagName.toLowerCase()
  const classes = (el.classList ? Array.from(el.classList) : [])
    // Filter out classes that are dynamic / framework noise so the selector is stabler
    .filter(c => /^[A-Za-z][\w-]*$/.test(c))
    .filter(c => !/^css-/.test(c))               // emotion
    .filter(c => !/__|--/.test(c) || c.length < 30) // bem ok if short
    .slice(0, 3)
  const classPart = classes.length ? '.' + classes.map(cssEscape).join('.') : ''

  // nth-of-type stabilises sibling selection across re-renders better than nth-child
  const parent = el.parentElement
  if (parent) {
    const sameTagSiblings = Array.from(parent.children).filter(c => c.tagName === el.tagName)
    if (sameTagSiblings.length > 1) {
      const idx = sameTagSiblings.indexOf(el) + 1
      return `${tag}${classPart}:nth-of-type(${idx})`
    }
  }
  return `${tag}${classPart}`
}

function uniqueMatch(selector) {
  try {
    return document.querySelectorAll(selector).length === 1
  } catch {
    return false
  }
}

// Use the native CSS.escape when available (modern browsers); otherwise a small
// fallback that handles the common cases this generator produces.
function cssEscape(str) {
  if (typeof window !== 'undefined' && window.CSS && typeof window.CSS.escape === 'function') {
    return window.CSS.escape(str)
  }
  return String(str).replace(/[^a-zA-Z0-9_-]/g, ch => `\\${ch}`)
}
