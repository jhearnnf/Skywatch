import { describe, it, expect } from 'vitest'
import { applyTierCascade } from '../tierCascade'

describe('applyTierCascade — checking', () => {
  it('checking free also checks silver and gold', () => {
    expect(applyTierCascade([], 'free', true).sort()).toEqual(['free', 'gold', 'silver'])
  })

  it('checking silver also checks gold but not free', () => {
    const result = applyTierCascade([], 'silver', true)
    expect(result).toContain('silver')
    expect(result).toContain('gold')
    expect(result).not.toContain('free')
  })

  it('checking gold does not cascade', () => {
    expect(applyTierCascade([], 'gold', true)).toEqual(['gold'])
  })

  it('checking free when silver already checked adds all three', () => {
    const result = applyTierCascade(['silver'], 'free', true).sort()
    expect(result).toEqual(['free', 'gold', 'silver'])
  })
})

describe('applyTierCascade — unchecking', () => {
  it('unchecking gold also removes silver and free', () => {
    expect(applyTierCascade(['free', 'silver', 'gold'], 'gold', false)).toEqual([])
  })

  it('unchecking silver also removes free but not gold', () => {
    const result = applyTierCascade(['free', 'silver', 'gold'], 'silver', false)
    expect(result).toContain('gold')
    expect(result).not.toContain('silver')
    expect(result).not.toContain('free')
  })

  it('unchecking free does not cascade to silver or gold', () => {
    const result = applyTierCascade(['free', 'silver', 'gold'], 'free', false)
    expect(result).toContain('silver')
    expect(result).toContain('gold')
    expect(result).not.toContain('free')
  })

  it('unchecking gold when only gold is set results in empty array', () => {
    expect(applyTierCascade(['gold'], 'gold', false)).toEqual([])
  })

  it('unchecking a tier that was not present is a no-op', () => {
    const result = applyTierCascade(['gold'], 'free', false)
    expect(result).toContain('gold')
    expect(result).not.toContain('free')
  })
})

describe('applyTierCascade — admin tier is unaffected', () => {
  it('admin tier is preserved through any toggle', () => {
    const result = applyTierCascade(['admin', 'gold'], 'gold', false)
    expect(result).toContain('admin')
    expect(result).not.toContain('gold')
  })

  it('checking free does not remove admin', () => {
    const result = applyTierCascade(['admin'], 'free', true)
    expect(result).toContain('admin')
    expect(result).toContain('free')
    expect(result).toContain('silver')
    expect(result).toContain('gold')
  })
})
