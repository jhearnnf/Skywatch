import surveyRoles from '../../backend/constants/surveyRoles.json'

// Role list for the CBAT outcome questionnaire, imported straight from the
// backend constants file the same way categories.json is — one definition, so
// a role the API will accept is always a role the form can offer.

export const ROLE_GROUPS = surveyRoles.groups
export const OTHER_ROLE_KEY = surveyRoles.otherKey

// Flat lookup for turning a stored key back into something readable.
export const ROLE_BY_KEY = Object.fromEntries(
  ROLE_GROUPS.flatMap(g => g.roles.map(r => [r.key, { ...r, service: g.service }])),
)

export function roleLabel(key, other) {
  if (!key) return ''
  if (key === OTHER_ROLE_KEY) return other?.trim() || 'Another role'
  const role = ROLE_BY_KEY[key]
  if (!role) return key
  return `${role.service} — ${role.label}`
}

// Substring match across the role name AND its service, so typing "canadian"
// finds every RCAF role and typing "pilot" finds every service's pilot. Groups
// with no surviving roles drop out entirely rather than rendering an empty
// heading.
export function filterRoleGroups(query) {
  const q = query.trim().toLowerCase()
  if (!q) return ROLE_GROUPS
  return ROLE_GROUPS
    .map(g => {
      const serviceMatches = g.service.toLowerCase().includes(q)
      const roles = serviceMatches
        ? g.roles
        : g.roles.filter(r => r.label.toLowerCase().includes(q))
      return { ...g, roles }
    })
    .filter(g => g.roles.length > 0)
}
