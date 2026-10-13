import { describe, it, expect } from 'vitest'
import { filterRoleGroups, ROLE_GROUPS, roleLabel } from './surveyRoles'

describe('Survey roles by test', () => {
  it.each([
    ['raf-cbat', 'Royal Air Force'],
    ['rn-cbat', 'Royal Navy / Fleet Air Arm'],
    ['cfast', 'Royal Canadian Air Force'],
    ['adf-asp', 'Royal Australian Air Force'],
  ])('limits %s to its service and the custom role option', (test, service) => {
    expect(filterRoleGroups('', test).map(group => group.service)).toEqual([service, 'Something else'])
    expect(filterRoleGroups('no matching role', test).flatMap(group => group.roles).map(role => role.key)).toEqual(['other'])
  })

  it('stops offering a retired role but still names it on a stored answer', () => {
    expect(ROLE_GROUPS.flatMap(g => g.roles).map(r => r.key)).not.toContain('pilot-isr-rpas')
    expect(roleLabel('pilot-isr-rpas')).toContain('Pilot ISR (RPAS)')
  })

  it('keeps all services for other tests and older responses', () => {
    expect(filterRoleGroups('', 'other')).toEqual(ROLE_GROUPS)
    expect(filterRoleGroups('')).toEqual(ROLE_GROUPS)
  })
})
