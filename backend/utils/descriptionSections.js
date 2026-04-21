// descriptionSections shape helpers.
//
// The canonical shape is: [{ heading: string, body: string }]. Legacy data
// (pre-migration) stored [string]. These helpers tolerate either and always
// return the canonical shape so call sites can be simple.

function normalizeSections(sections) {
  if (!Array.isArray(sections)) return [];
  const out = [];
  for (const s of sections) {
    if (s == null) continue;
    if (typeof s === 'string') {
      const body = s.trim();
      if (body) out.push({ heading: '', body });
      continue;
    }
    if (typeof s === 'object') {
      const body    = typeof s.body    === 'string' ? s.body.trim()    : '';
      const heading = typeof s.heading === 'string' ? s.heading.trim() : '';
      if (body) out.push({ heading, body });
    }
  }
  return out;
}

// Single-section body extractor — used where legacy callers did sections[i].
function sectionBody(section) {
  if (!section) return '';
  if (typeof section === 'string') return section;
  return typeof section.body === 'string' ? section.body : '';
}

// Joined body text — replaces the old `sections.join(' ')` idiom used by
// keyword/mentions scanners.
function bodiesText(sections) {
  return normalizeSections(sections).map(s => s.body).join(' ');
}

// Pack a [{heading, body}] array back to a plain JS array of objects, usable
// for Mongoose assignment on a Mixed-typed field (which otherwise preserves
// subdoc prototypes that can trip JSON serialization downstream).
function toPlain(sections) {
  return normalizeSections(sections).map(s => ({ heading: s.heading, body: s.body }));
}

module.exports = { normalizeSections, sectionBody, bodiesText, toPlain };
