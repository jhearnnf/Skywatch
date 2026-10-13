import { describe, it, expect } from 'vitest'
import { testsToText, textToTests } from './scoreSheetTests'

describe('score sheet test lists', () => {
  it('writes tests the way the sheet prints them', () => {
    expect(testsToText([{ code: 'CUT', mult: 3 }, { code: 'SAT', mult: 1 }])).toBe('3(CUT), SAT')
  })

  it.each([
    ['3(CUT), SAT', [{ code: 'CUT', mult: 3 }, { code: 'SAT', mult: 1 }]],
    ['(2SIT),DPT', [{ code: 'SIT', mult: 2 }, { code: 'DPT', mult: 1 }]],
    ['2INSC, 2TRAC 1, DAD', [{ code: 'INSC', mult: 2 }, { code: 'TRAC 1', mult: 2 }, { code: 'DAD', mult: 1 }]],
    ['TRAC_PT2, SIT', [{ code: 'TRAC_PT2', mult: 1 }, { code: 'SIT', mult: 1 }]],
  ])('reads %s back', (text, tests) => {
    expect(textToTests(text)).toEqual(tests)
  })
})
