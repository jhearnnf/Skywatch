import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import ProfileBadge from '../components/ProfileBadge'
import SEO from '../components/SEO'

const C = {
  brand:   '#5baaff',
  text:    '#ddeaf8',
  dim:     '#3d5a7a',
  muted:   '#4a6282',
  subtle:  '#8ba0c0',
  border:  '#1a3060',
  surface: '#0f2245',
}

function RadarPlaceholder({ size = 72 }) {
  return (
    <span className="radar-placeholder" style={{ width: size, height: size }} aria-hidden="true">
      <span className="radar-placeholder__sweep" />
      <span className="radar-placeholder__dot" style={{ top: '30%', left: '62%' }} />
      <span className="radar-placeholder__dot" style={{ top: '58%', left: '38%' }} />
    </span>
  )
}

export default function BadgePicker() {
  const { user, setUser, API, apiFetch } = useAuth()
  const navigate = useNavigate()
  const [options, setOptions] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyBriefId, setBusyBriefId] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user) return
    setLoading(true)
    apiFetch(`${API}/api/users/me/badge-options`)
      .then(r => r.json())
      .then(d => setOptions(d?.data ?? []))
      .catch(() => setOptions([]))
      .finally(() => setLoading(false))
  }, [API, user, apiFetch])

  const selectedId = user?.selectedBadge?.briefId
    ? String(user.selectedBadge.briefId)
    : null

  const submit = async (briefId) => {
    if (busyBriefId) return
    setBusyBriefId(briefId ?? '__reset__')
    setError('')
    try {
      const res = await apiFetch(`${API}/api/users/me/badge`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ briefId: briefId ?? null }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.message || 'Could not update badge')
      if (data?.data?.user) setUser(data.data.user)
    } catch (err) {
      setError(err.message || 'Something went wrong')
    } finally {
      setBusyBriefId(null)
    }
  }

  return (
    <>
      <SEO title="Profile Badge" description="Choose the aircraft that represents you on your profile." />
      <div className="max-w-lg mx-auto pb-8">
        <div className="flex items-center gap-3 mb-2 px-1">
          <button
            type="button"
            onClick={() => navigate('/profile')}
            className="text-sm font-semibold text-brand-600 hover:text-brand-700"
          >
            ← Back
          </button>
          <h1 className="text-xl font-extrabold text-slate-900 flex-1">Profile Badge</h1>
        </div>

        <div className="flex justify-end mb-3 px-1">
          <button
            type="button"
            onClick={() => navigate('/rankings', { state: { tab: 'ranks' } })}
            className="text-xs intel-mono font-bold hover:underline"
            style={{ color: C.brand }}
          >
            View RAF ranks →
          </button>
        </div>

        <p className="intel-mono px-1 mb-3" style={{ color: C.muted }}>
          Select the aircraft that represents you
        </p>
        <p className="text-sm px-1 mb-5" style={{ color: C.subtle }}>
          Read an Aircraft intel brief to unlock it here. Pending entries show aircraft you&apos;ve read but whose recon image is still being processed.
        </p>

        {/* Rank badge (default) reset tile */}
        <button
          type="button"
          onClick={() => submit(null)}
          disabled={!selectedId || busyBriefId != null}
          className="w-full rounded-2xl p-4 mb-6 card-intel flex items-center gap-4 text-left transition-colors disabled:opacity-70"
          style={{
            borderColor: selectedId == null ? C.brand : C.border,
            background:  selectedId == null ? 'rgba(91,170,255,0.08)' : C.surface,
          }}
        >
          <div className="w-14 h-14 rounded-2xl bg-brand-200/60 border-2 border-brand-400/50 flex items-center justify-center shrink-0">
            <ProfileBadge user={{ rank: user?.rank }} size={38} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-extrabold" style={{ color: C.text }}>Rank badge</p>
            <p className="text-xs intel-mono" style={{ color: C.muted }}>
              {selectedId == null ? 'Currently selected' : 'Default — reset to your rank insignia'}
            </p>
          </div>
        </button>

        {/* Aircraft grid */}
        {loading ? (
          <p className="intel-mono text-center py-8" style={{ color: C.muted }}>Loading aircraft…</p>
        ) : options.length === 0 ? (
          <div className="rounded-2xl p-6 card-intel text-center">
            <p className="text-sm font-semibold mb-2" style={{ color: C.text }}>No aircraft unlocked yet</p>
            <p className="text-xs intel-mono mb-4" style={{ color: C.muted }}>
              Read an Aircraft brief to unlock it as a badge
            </p>
            <button
              type="button"
              onClick={() => navigate('/learn-priority', { state: { category: 'Aircrafts' } })}
              className="text-sm font-bold text-brand-600 hover:text-brand-700 underline"
            >
              Go to Aircrafts pathway
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {options.map((opt, i) => {
              const id = String(opt.briefId)
              const isSelected = id === selectedId
              const isPending  = opt.status === 'pending'
              const isBusy     = busyBriefId === id
              return (
                <motion.button
                  key={id}
                  type="button"
                  onClick={isPending ? undefined : () => submit(id)}
                  disabled={isPending || busyBriefId != null}
                  aria-disabled={isPending ? 'true' : undefined}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="rounded-2xl p-3 card-intel flex flex-col items-center gap-2 transition-colors disabled:cursor-not-allowed"
                  style={{
                    borderColor: isSelected ? C.brand : C.border,
                    background:  isSelected ? 'rgba(91,170,255,0.10)' : C.surface,
                    opacity:     isPending ? 0.75 : 1,
                  }}
                >
                  <div className="w-20 h-20 rounded-2xl flex items-center justify-center shrink-0" style={{ background: isPending ? 'transparent' : '#081424', border: isPending ? 'none' : `1px solid ${C.border}` }}>
                    {isPending ? (
                      <RadarPlaceholder size={72} />
                    ) : (
                      <span className="profile-badge-cutout-wrap" style={{ width: 72, height: 72 }}>
                        <img src={opt.cutoutUrl} alt={opt.title} className="profile-badge-cutout-img" draggable={false} />
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-bold text-center leading-tight line-clamp-2" style={{ color: C.text }}>
                    {opt.title}
                  </p>
                  {isPending ? (
                    <span className="intel-tag" style={{ opacity: 0.8 }}>Recon pending</span>
                  ) : isSelected ? (
                    <span className="intel-tag">Selected</span>
                  ) : isBusy ? (
                    <span className="intel-mono" style={{ color: C.muted }}>Saving…</span>
                  ) : (
                    <span className="intel-mono" style={{ color: C.muted }}>Tap to select</span>
                  )}
                </motion.button>
              )
            })}
          </div>
        )}

        {error && (
          <p className="mt-4 text-sm text-red-400 text-center">{error}</p>
        )}
      </div>
    </>
  )
}
