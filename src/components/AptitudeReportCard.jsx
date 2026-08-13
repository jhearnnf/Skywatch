import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { MAX_SCORE, BATTERY_BY_KEY, reportVerdict, statusColour, TONE_TEXT } from '../data/cbatBatteries'

// The Aptitude Report's shopfront, sitting above the game grid on /cbat.
//
// It exists because the report only works as a habit. A user who has to remember a separate page
// will look at their estimate once; a user who sees the number move every time they open the games
// hub has a reason to play the game that moves it most. So the card leads with the score against
// the cutoff and one thing to go and do — everything else stays on the report itself.
//
// Renders nothing at all until the summary loads, rather than reserving a skeleton: this sits
// above the grid, and a placeholder that shifts the games down on every page load is worse than a
// card that fades in.

export default function AptitudeReportCard() {
  const { API, apiFetch, user } = useAuth()
  const [data, setData] = useState(null)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiFetch(`${API}/api/games/cbat/report`)
        const json = await res.json()
        if (!cancelled && res.ok) setData(json.data)
      } catch { /* the card is an extra; the games below are the page */ }
    })()
    return () => { cancelled = true }
  }, [user, API, apiFetch])

  if (!data) return null

  const targetKey = data.targetBattery
  const target = targetKey ? data.batteries.find(b => b.key === targetKey) : null

  // No target chosen yet — the pitch, plus the count of roles they'd already clear, which is the
  // most persuasive true thing we can say to someone who hasn't looked.
  if (!target) {
    const passing = data.batteries.filter(b => b.status === 'pass').length
    const scored = data.batteries.filter(b => b.score != null).length
    return (
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="bg-surface border border-slate-200 rounded-2xl p-4 mb-5 card-shadow"
      >
        <div className="flex items-center gap-4">
          <span className="text-3xl shrink-0">📋</span>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-slate-800 mb-0.5">Aptitude Report</p>
            <p className="text-xs text-slate-600">
              {scored
                ? <>You already have a score for {scored} RAF role{scored === 1 ? '' : 's'}{passing > 0 && <>, and you&apos;d pass <span className="font-bold text-emerald-300">{passing}</span> of them</>}. Pick the one you&apos;re aiming for.</>
                : <>See how your practice would score on the real CBAT, and what to work on next.</>}
            </p>
          </div>
          <Link
            to="/cbat/report"
            className="shrink-0 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold transition-colors no-underline"
          >
            Open
          </Link>
        </div>
      </motion.div>
    )
  }

  const verdict = reportVerdict(target)
  const label = BATTERY_BY_KEY[targetKey]?.label ?? targetKey
  const pct = Math.min(100, ((target.score ?? 0) / MAX_SCORE) * 100)

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="mb-5"
    >
      <Link
        to="/cbat/report"
        className="block bg-surface border border-slate-200 rounded-2xl overflow-hidden card-shadow no-underline
          hover:border-brand-300 transition-colors"
      >
        <div className="flex">
          <div
            className={`w-2 shrink-0 ${
              target.status === 'pass' ? 'bg-[#2f7d5b]' : target.status === 'fail' ? 'bg-[#a34a45]' : 'bg-[#1a3a5c]'
            }`}
          />
          <div className="flex-1 min-w-0 p-4">
            <div className="flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-slate-500 uppercase tracking-wide">Aptitude Report · {label}</p>
                <p className="font-mono font-extrabold text-2xl text-slate-900 leading-tight">
                  {target.score ?? '-'}
                  <span className="text-sm text-slate-600 font-bold"> / pass mark {target.cutoff}</span>
                </p>
                <p className={`text-[11px] font-bold ${TONE_TEXT[verdict.tone]}`}>{verdict.label}</p>
              </div>
              <span className="shrink-0 text-xs font-bold text-brand-700">Open &rarr;</span>
            </div>

            <div className="relative mt-3 h-2 bg-[#060e1a] border border-[#1a3a5c] rounded-sm overflow-hidden">
              <motion.div
                className="absolute inset-y-0 left-0"
                style={{ background: statusColour(target.status), opacity: 0.9 }}
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.7, ease: 'easeOut' }}
              />
              <div
                className="absolute inset-y-0 w-[2px] bg-[#ff4d4d]"
                style={{ left: `calc(${(target.cutoff / MAX_SCORE) * 100}% - 1px)` }}
              />
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  )
}
