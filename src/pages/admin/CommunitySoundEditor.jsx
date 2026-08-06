import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import {
  invalidateSoundSettings, previewCommunityMusic, getMasterVolume,
} from '../../utils/sound'
import { refreshCommunityMusicVolume } from '../../utils/communityMusic'

// The Community soundtrack's controls, in the console rather than only buried
// in Admin › Sound Effects — you tune it while listening to it.
//
// Writes the same two AppSettings fields the Sound Effects panel does
// (volumeCommunityMusic / soundEnabledCommunityMusic), so the two screens can
// never disagree about what is playing.
export default function CommunitySoundEditor({ API }) {
  const { apiFetch } = useAuth()

  const [volume,  setVolume]  = useState(60)
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busy,    setBusy]    = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [err,     setErr]     = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // The public settings endpoint: the two fields are not secret, and it is
      // the same source the sound cache reads.
      const r = await apiFetch(`${API}/api/settings`)
      const d = await r.json().catch(() => null)
      const s = d?.data ?? d ?? {}
      setVolume(s.volumeCommunityMusic ?? 60)
      setEnabled(s.soundEnabledCommunityMusic !== false)
    } finally {
      setLoading(false)
    }
  }, [API, apiFetch])

  useEffect(() => { load() }, [load])

  const save = async (next) => {
    setBusy(true); setErr(''); setSaved(false)
    try {
      const r = await apiFetch(`${API}/api/admin/settings`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          volumeCommunityMusic:       next.volume ?? volume,
          soundEnabledCommunityMusic: next.enabled ?? enabled,
          reason: 'Update Community soundtrack',
        }),
      })
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.message || 'Could not save')
      // Drop the cached settings and re-apply gain, so the track you are
      // listening to right now follows the slider instead of waiting for a
      // reload.
      invalidateSoundSettings()
      refreshCommunityMusicVolume()
      setSaved(true)
    } catch (e) {
      setErr(e.message || 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <p className="text-xs text-slate-400">Loading…</p>

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-slate-400">
        A looping bed that plays while anyone is in Community. This sets the track&rsquo;s own
        level; each player&rsquo;s app volume in Profile still scales it, and a player with their
        volume at zero hears nothing.
      </p>

      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={e => { setEnabled(e.target.checked); save({ enabled: e.target.checked }) }}
          disabled={busy}
          className="mt-0.5"
        />
        <span>
          <span className="block text-xs font-bold text-slate-700">Play the Community soundtrack</span>
          <span className="block text-[11px] text-slate-400">
            Turning this off silences it for everyone.
          </span>
        </span>
      </label>

      <div className={enabled ? '' : 'opacity-50 pointer-events-none'}>
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs font-bold text-slate-700">Track volume</p>
          <span className="text-xs text-slate-400">{volume}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={volume}
          onChange={e => setVolume(Number(e.target.value))}
          onMouseUp={() => save({ volume })}
          onTouchEnd={() => save({ volume })}
          onKeyUp={() => save({ volume })}
          className="w-full"
          aria-label="Community soundtrack volume"
        />
        <div className="flex items-center gap-2 mt-2">
          <button
            type="button"
            onClick={() => previewCommunityMusic(volume)}
            className="px-3 py-1.5 text-xs font-bold text-brand-600 hover:text-brand-700 border border-brand-200 hover:bg-brand-100 rounded-lg transition-colors"
          >
            ▶ Preview
          </button>
          <span className="text-[11px] text-slate-400">
            Your app volume is {getMasterVolume()}%, so this previews at that scale.
          </span>
        </div>
      </div>

      {err && <p className="text-xs text-red-600">{err}</p>}
      {saved && !err && <p className="text-xs text-emerald-700">Saved.</p>}
    </div>
  )
}
