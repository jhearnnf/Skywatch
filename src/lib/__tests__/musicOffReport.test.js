import { describe, it, expect, beforeEach, vi } from 'vitest'
import { reportMusicOff, noteMusicOff, _resetMusicOffReport } from '../musicOffReport'
import { setMusicMuted } from '../../utils/musicMute'

const ok = () => vi.fn(() => Promise.resolve({ ok: true }))
const sentVia = (apiFetch) => JSON.parse(apiFetch.mock.calls[0][1].body).via

describe('musicOffReport', () => {
  beforeEach(() => {
    localStorage.clear()
    setMusicMuted(false)
    localStorage.clear()
    _resetMusicOffReport()
  })

  it('sends nothing while the music is on', async () => {
    const apiFetch = ok()
    await reportMusicOff({ apiFetch, API: '', user: { _id: 'u1' } })
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('reports a guest mute once they are signed in, even after unmuting', async () => {
    setMusicMuted(true)
    setMusicMuted(false)
    const apiFetch = ok()
    await reportMusicOff({ apiFetch, API: '', user: { _id: 'u1' } })
    expect(sentVia(apiFetch)).toBe('mute')
  })

  it('reports Profile volume at 0', async () => {
    noteMusicOff('volume')
    const apiFetch = ok()
    await reportMusicOff({ apiFetch, API: '', user: { _id: 'u1' } })
    expect(sentVia(apiFetch)).toBe('volume')
  })

  it('reports a volume already at 0 from before the report existed', async () => {
    localStorage.setItem('skywatch_master_volume', '0')
    const apiFetch = ok()
    await reportMusicOff({ apiFetch, API: '', user: { _id: 'u1' } })
    expect(sentVia(apiFetch)).toBe('volume')
  })

  it('sends once per account and never for one already stamped', async () => {
    noteMusicOff('mute')
    const apiFetch = ok()
    await reportMusicOff({ apiFetch, API: '', user: { _id: 'u1' } })
    await reportMusicOff({ apiFetch, API: '', user: { _id: 'u1' } })
    await reportMusicOff({ apiFetch, API: '', user: { _id: 'u2', musicOffAt: '2026-10-01' } })
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })
})
