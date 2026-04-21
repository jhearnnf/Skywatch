// Frontend mirror of backend/utils/descriptionSections.js.
// Normalizes raw API data (legacy strings OR the new {heading, body} shape)
// to a canonical [{heading, body}] array so components can render without
// defensive per-site branches.

export function normalizeSections(sections) {
  if (!Array.isArray(sections)) return []
  const out = []
  for (const s of sections) {
    if (s == null) continue
    if (typeof s === 'string') {
      const body = s.trim()
      if (body) out.push({ heading: '', body })
      continue
    }
    if (typeof s === 'object') {
      const heading = typeof s.heading === 'string' ? s.heading.trim() : ''
      const body    = typeof s.body    === 'string' ? s.body.trim()    : ''
      if (body) out.push({ heading, body })
    }
  }
  return out
}

export function sectionBody(section) {
  if (!section) return ''
  if (typeof section === 'string') return section
  return typeof section.body === 'string' ? section.body : ''
}
