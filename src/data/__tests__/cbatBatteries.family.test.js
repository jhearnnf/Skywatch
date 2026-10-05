import { describe, it, expect } from 'vitest'
import { reportVerdict, familyNote } from '../cbatBatteries'

const controller = {
  rule: 'any', provisional: false,
  members: [{ key: 'control-officer-atc', label: 'Control Officer (ATC)' }, { key: 'control-officer-wc', label: 'Control Officer (WC)' }],
  decidedBy: [{ key: 'control-officer-wc', label: 'Control Officer (WC)' }],
}
const wsop = {
  rule: 'all', provisional: true,
  members: [{ key: 'wsop-isr', label: 'WSOP (ISR)' }, { key: 'wsop-rw', label: 'WSOP (RW)' }, { key: 'wsop-am', label: 'WSOP (AM)' }],
  decidedBy: [{ key: 'wsop-isr', label: 'WSOP (ISR)' }],
}

describe('reportVerdict with a family verdict', () => {
  it('explains a pass under the pass mark that its pair carried', () => {
    const v = reportVerdict({ status: 'pass', ownStatus: 'fail', family: controller, margin: -12 })
    expect(v.tone).toBe('good')
    expect(v.blurb).toContain('you pass Control Officer (WC)')
  })

  it('explains a fail above the pass mark that its group caused, and says the rule is thin', () => {
    const v = reportVerdict({ status: 'fail', ownStatus: 'pass', family: wsop, margin: 6 })
    expect(v.tone).toBe('bad')
    expect(v.blurb).toContain('you do not pass WSOP (ISR)')
    expect(v.blurb).toContain('one real score sheet')
  })

  it('reads as usual when the family did not change the verdict', () => {
    const v = reportVerdict({ status: 'pass', ownStatus: 'pass', family: { ...controller, decidedBy: [] }, margin: 30 })
    expect(v.label).toBe('Passing')
  })

  it('never uses an em dash on screen', () => {
    for (const v of [
      reportVerdict({ status: 'pass', ownStatus: 'fail', family: controller }),
      reportVerdict({ status: 'fail', ownStatus: 'pass', family: wsop }),
    ]) expect(v.blurb + v.label).not.toMatch(/—/)
  })
})

describe('familyNote', () => {
  it('names the role that decided it, or nothing', () => {
    expect(familyNote(wsop, 'fail')).toBe('Fails because you do not pass WSOP (ISR)')
    expect(familyNote(controller, 'pass')).toBe('Passes because you pass Control Officer (WC)')
    expect(familyNote({ ...wsop, decidedBy: [] }, 'fail')).toBeNull()
  })
})
