import { describe, it, expect, vi } from 'vitest'
import {
  recoverFromChunkError, RELOAD_KEY, RELOAD_COOLDOWN_MS, MOCK_UPDATED_PATH,
} from '../chunkLoadRecovery'

function memoryStorage(initial = {}) {
  const data = { ...initial }
  return {
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v) },
    data,
  }
}

const NOW = 1_800_000_000_000

function run(over = {}) {
  const reload = vi.fn()
  const goTo = vi.fn()
  const storage = over.storage ?? memoryStorage()
  const result = recoverFromChunkError({ storage, now: NOW, mockActive: false, reload, goTo, ...over })
  return { result, reload, goTo, storage }
}

describe('recoverFromChunkError', () => {
  it('reloads the first time and stamps when it did', () => {
    const { result, reload, goTo, storage } = run()
    expect(result).toBe('reloaded')
    expect(reload).toHaveBeenCalledTimes(1)
    expect(goTo).not.toHaveBeenCalled()
    expect(storage.data[RELOAD_KEY]).toBe(String(NOW))
  })

  it('does not reload again within a minute, so a missing file cannot loop', () => {
    const storage = memoryStorage({ [RELOAD_KEY]: String(NOW - RELOAD_COOLDOWN_MS + 1000) })
    const { result, reload, goTo } = run({ storage })
    expect(result).toBe('gave-up')
    expect(reload).not.toHaveBeenCalled()
    expect(goTo).not.toHaveBeenCalled()
  })

  // The bug: the old flag was set once per tab and never cleared, so the second deploy a tab
  // lived through left it stuck.
  it('reloads again for a later deploy in the same tab', () => {
    const storage = memoryStorage({ [RELOAD_KEY]: String(NOW - RELOAD_COOLDOWN_MS - 1) })
    expect(run({ storage }).result).toBe('reloaded')
  })

  it('treats the old once-per-tab flag as long ago', () => {
    const storage = memoryStorage({ [RELOAD_KEY]: '1' })
    expect(run({ storage }).result).toBe('reloaded')
  })

  it('treats a stamp from the future as long ago rather than blocking forever', () => {
    const storage = memoryStorage({ [RELOAD_KEY]: String(NOW + 10 * 60 * 1000) })
    expect(run({ storage }).result).toBe('reloaded')
  })

  it('sends a player in a Mock Assessment back to the assessment screen instead of reloading', () => {
    const { result, reload, goTo } = run({ mockActive: true })
    expect(result).toBe('mock')
    expect(goTo).toHaveBeenCalledWith(MOCK_UPDATED_PATH)
    expect(MOCK_UPDATED_PATH).toBe('/cbat/mock?updated=1')
    expect(reload).not.toHaveBeenCalled()
  })

  it('still reloads when storage is blocked', () => {
    const storage = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    expect(run({ storage }).result).toBe('reloaded')
  })
})
