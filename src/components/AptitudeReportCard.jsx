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
// It reserves its space with a skeleton while the summary loads. This used to render nothing at
// all, on the reasoning that a placeholder shifting the games down was worse than a card fading
// in — but that had it backwards: rendering nothing IS the shift, because the card drops in above
// the grid and pushes ~135px of games down after the fetch lands. The /cbat grid is now tuned to
// put all 22 games on one phone screen, so that late shove is the difference between fitting and
// not. A skeleton built from the scored card's own classes holds the exact height instead.
//
// The skeleton mirrors the SCORED shape, which is what a returning player gets. Someone who has
// not picked a target role yet sees the shorter prompt card, so their page still settles by about
// 19px — worth it to keep the common case at zero.

export default function AptitudeReportCard() {
  const { API, apiFetch, user } = useAuth()
  const [data, setData] = useState(null)
  // Starts true so the very first paint reserves the space, rather than showing
  // nothing for a frame and then swapping in the skeleton.
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // No user means no fetch will ever run, so the skeleton has to come down or
    // it would sit there for the life of the page.
    if (!user) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const res = await apiFetch(`${API}/api/games/cbat/report`)
        const json = await res.json()
        if (!cancelled && res.ok) setData(json.data)
      } catch { /* the card is an extra; the games below are the page */ }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [user, API, apiFetch])

  if (loading) return <AptitudeReportSkeleton />

  // Holds the card's exact height while the summary is in flight, so the game grid below never
// moves. Every box here is the scored card's own markup — same padding, same line heights, same
// stripe — so the two are the same height by construction rather than by a hard-coded pixel value
// that would drift the first time the card changes.
//
// It says what it is doing rather than showing anonymous grey bars. The estimate is the one number
// on the hub a player cares about, and a moment of visible arithmetic before it lands makes it feel
// earned. The rolling figure is deliberately never accompanied by a verdict or a real pass mark, so
// nothing transient can be misread as a result; the screen-reader label is the plain sentence.
function AptitudeReportSkeleton() {
  // A settling readout rather than a spinner. The number rolls through plausible
  // scores and slows as it goes, which is what makes it read as "working it out"
  // instead of "broken". Digits only — never a verdict, never a pass mark, so
  // nothing on screen can be mistaken for a real result.
  const [rolling, setRolling] = useState(72)

  useEffect(() => {
    let timer
    let step = 0
    const tick = () => {
      step += 1
      setRolling(40 + Math.floor(Math.random() * 60))
      // Eases from 70ms to ~260ms, so the roll decelerates the longer the fetch
      // takes rather than strobing at one rate for as long as it is on screen.
      timer = setTimeout(tick, Math.min(260, 70 + step * 14))
    }
    timer = setTimeout(tick, 70)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div
      className="mb-5"
      role="status"
      aria-busy="true"
      aria-label="Analysing aptitude results"
      data-testid="aptitude-report-skeleton"
    >
      <div className="relative block bg-surface border border-slate-200 rounded-2xl overflow-hidden card-shadow">
        {/* Radar sweep shimmer across the card */}
        <span aria-hidden="true" className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none">
          <span className="absolute -inset-y-2 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-brand-600/20 to-transparent stat-skeleton-sweep" />
        </span>

        <div className="flex">
          {/* No status yet, so the stripe breathes between neutral and brand. */}
          <div className="w-2 shrink-0 aptitude-stripe-breathe" />

          <div className="flex-1 min-w-0 p-4">
            <div className="flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-slate-500 uppercase tracking-wide">Aptitude Report</p>

                {/* Same classes as the settled score, so the line box is the same
                    height to the pixel. tabular-nums stops the roll jittering. */}
                <p className="font-mono font-extrabold text-2xl text-slate-600 leading-tight tabular-nums" aria-hidden="true">
                  {rolling}
                  <span className="text-sm text-slate-500 font-bold"> / pass mark --</span>
                </p>

                <p className="text-[11px] font-bold text-brand-700">
                  Analysing aptitude results
                  <span aria-hidden="true">
                    <span className="aptitude-dot">.</span>
                    <span className="aptitude-dot aptitude-dot-2">.</span>
                    <span className="aptitude-dot aptitude-dot-3">.</span>
                  </span>
                </p>
              </div>
              <span className="shrink-0 text-xs font-bold text-slate-500" aria-hidden="true">Open &rarr;</span>
            </div>

            {/* The rail sweeps and a brighter head rides across it. */}
            <div className="relative mt-3 h-2 bg-[#060e1a] border border-[#1a3a5c] rounded-sm overflow-hidden" aria-hidden="true">
              <div
                className="absolute inset-y-0 left-0 w-full aptitude-rail-fill"
                style={{ background: 'linear-gradient(90deg, #1a4e98 0%, #5baaff 100%)' }}
              />
              <div className="absolute inset-y-0 w-1/3 aptitude-rail-scan bg-gradient-to-r from-transparent via-brand-800/50 to-transparent" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Guards the SHAPE, not just the absence. `data` is whatever the endpoint
  // returned, and every branch below walks `batteries` — so a response that came
  // back without it (an error body, an empty payload, an older cached one) threw
  // and took the whole page down with it, because a render error is not caught
  // by the try above. This card is an extra, so the right answer to an
  // unexpected payload is to show nothing and leave the page alone.
  if (!Array.isArray(data?.batteries)) return null

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
