import surveyRoles from '../../backend/constants/surveyRoles.json'
import surveyTests from '../../backend/constants/surveyTests.json'

// Role list for the CBAT outcome questionnaire, imported straight from the
// backend constants file the same way categories.json is — one definition, so
// a role the API will accept is always a role the form can offer.

// What the form offers: a retired role drops out here, but stays in ROLE_BY_KEY so a stored answer
// naming it still reads back.
export const ROLE_GROUPS = surveyRoles.groups.map(g => ({ ...g, roles: g.roles.filter(r => !r.retired) }))
export const OTHER_ROLE_KEY = surveyRoles.otherKey

// Flat lookup for turning a stored key back into something readable.
export const ROLE_BY_KEY = Object.fromEntries(
  surveyRoles.groups.flatMap(g => g.roles.map(r => [r.key, { ...r, service: g.service }])),
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
export function filterRoleGroups(query, testType) {
  const q = query.trim().toLowerCase()
  const services = surveyTests.find(test => test.key === testType)?.services
  const groups = services ? ROLE_GROUPS.filter(g => services.includes(g.service) || g.roles.some(role => role.key === OTHER_ROLE_KEY)) : ROLE_GROUPS
  if (!q) return groups
  return groups
    .map(g => {
      const serviceMatches = g.service.toLowerCase().includes(q)
      const roles = serviceMatches
        ? g.roles
        : g.roles.filter(r => r.key === OTHER_ROLE_KEY || r.label.toLowerCase().includes(q))
      return { ...g, roles }
    })
    .filter(g => g.roles.length > 0)
}
