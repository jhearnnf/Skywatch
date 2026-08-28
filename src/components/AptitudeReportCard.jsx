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
// the grid and pushes the games down after the fetch lands. The /cbat grid is tuned to put all 22
// games on one phone screen, so that late shove is the difference between fitting and not. A
// skeleton built from the scored card's own classes holds the exact height instead.
//
// The skeleton mirrors the SCORED shape, which is what a returning player gets. Someone who has
// not picked a target role yet sees the shorter prompt card, so their page still settles slightly.

// ── Shared geometry ──────────────────────────────────────────────────────────
// The boxes that set the card's height, defined once and used by BOTH the scored card and its
// skeleton. Height parity is the skeleton's entire job, so the two cannot be allowed to drift: a
// change made here now applies to both by construction, rather than by someone remembering to
// copy it across.
//
// The `sm:` half of each pair is the card as it has always been on a desktop. The bare half is
// the phone form, which is a different shape rather than a scaled one: the verdict moves up
// beside the eyebrow, so the card becomes two text lines and a rail instead of three and a rail,
// and every box loses padding. That takes it from roughly 135px to roughly 72px. The grid below
// needs about 460px for its six rows of tiles, and a small phone only has 540-570px of viewport
// under the app chrome, so the 60-odd pixels are most of a grid row bought back.
const CARD_WRAP    = 'mb-3 sm:mb-5'
const CARD_STRIPE  = 'w-1.5 sm:w-2 shrink-0'
const CARD_BODY    = 'flex-1 min-w-0 p-2 sm:p-4'
const CARD_EYEBROW = 'flex-1 min-w-0 truncate text-[9px] leading-[1.2] sm:text-[10px] sm:leading-normal uppercase tracking-wide'
const CARD_SCORE   = 'font-mono font-extrabold text-lg sm:text-2xl leading-tight'
const CARD_UNIT    = 'text-[11px] sm:text-sm font-bold'
const CARD_NOTE    = 'text-[9px] leading-[1.2] font-bold'
const CARD_OPEN    = 'shrink-0 text-[10px] sm:text-xs font-bold'
const CARD_RAIL    = 'relative mt-1 h-1.5 sm:mt-3 sm:h-2 bg-[#060e1a] border border-[#1a3a5c] rounded-sm overflow-hidden'
const CARD_SHELL   = 'block bg-surface border border-slate-200 rounded-xl sm:rounded-2xl overflow-hidden card-shadow'

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
        className="bg-surface border border-slate-200 rounded-xl sm:rounded-2xl p-2 sm:p-4 mb-3 sm:mb-5 card-shadow"
      >
        <div className="flex items-center gap-2 sm:gap-4">
          <span className="text-xl sm:text-3xl shrink-0">📋</span>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-slate-800 text-sm leading-tight sm:text-base sm:mb-0.5">Aptitude Report</p>
            <p className="text-[10px] leading-[1.3] sm:text-xs text-slate-600">
              {scored
                ? <>You already have a score for {scored} RAF role{scored === 1 ? '' : 's'}{passing > 0 && <>, and you&apos;d pass <span className="font-bold text-emerald-300">{passing}</span> of them</>}. Pick the one you&apos;re aiming for.</>
                : <>See how your practice would score on the real CBAT, and what to work on next.</>}
            </p>
          </div>
          <Link
            to="/cbat/report"
            className="shrink-0 px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-[11px] sm:text-xs font-bold transition-colors no-underline"
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
      className={CARD_WRAP}
    >
      <Link
        to="/cbat/report"
        className={`${CARD_SHELL} no-underline hover:border-brand-300 transition-colors`}
      >
        <div className="flex">
          <div
            data-testid="aptitude-card-stripe"
            className={`${CARD_STRIPE} ${
              target.status === 'pass' ? 'bg-[#2f7d5b]' : target.status === 'fail' ? 'bg-[#a34a45]' : 'bg-[#1a3a5c]'
            }`}
          />
          <div data-testid="aptitude-card-body" className={CARD_BODY}>
            {/* Eyebrow row. On a phone the verdict rides up here beside the role name, which is
                what removes a whole line from the card; from `sm` it drops back under the score,
                where the desktop card has always had room for it. The eyebrow truncates because
                the longest role — "WSOP (Air Signaller, Linguist)" — is 30 characters and would
                otherwise push the verdict off the right edge of a 360px screen. */}
            <div className="flex items-baseline gap-2">
              <p data-testid="aptitude-card-eyebrow" className={`${CARD_EYEBROW} text-slate-500`}>
                Aptitude Report · {label}
              </p>
              <span className={`sm:hidden shrink-0 ${CARD_NOTE} ${TONE_TEXT[verdict.tone]}`}>{verdict.label}</span>
            </div>

            <div className="flex items-center gap-2 sm:gap-4">
              <div className="flex-1 min-w-0">
                <p data-testid="aptitude-card-score" className={`${CARD_SCORE} text-slate-900`}>
                  {target.score ?? '-'}
                  <span className={`${CARD_UNIT} text-slate-600`}> / pass mark {target.cutoff}</span>
                </p>
                <p className={`hidden sm:block text-[11px] font-bold ${TONE_TEXT[verdict.tone]}`}>{verdict.label}</p>
              </div>
              <span className={`${CARD_OPEN} text-brand-700`}>Open &rarr;</span>
            </div>

            <div data-testid="aptitude-card-rail" className={CARD_RAIL}>
              <motion.div
                className="absolute inset-y-0 left-0 aptitude-rail-fill"
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

// Holds the card's exact height while the summary is in flight, so the game grid below never
// moves. Every box here is one of the shared constants above — same padding, same line heights,
// same stripe, same breakpoint behaviour — so the two are the same height by construction rather
// than by a hard-coded pixel value that would drift the first time the card changes.
//
// It shows no number at all. An earlier version rolled a random figure through the score slot to
// look like arithmetic; it read as a fault, because the one number this card exists to report was
// visibly jumping between values it could not possibly have computed. A placeholder that is
// obviously a placeholder is more trustworthy than a plausible one that is wrong. So the score
// slot holds dashes, the stripe stays the neutral "no status yet" blue, and the only motion is
// the shared shimmer, the dots, and one indeterminate pass across the rail — none of which claims
// to know anything.
function AptitudeReportSkeleton() {
  // The working message occupies the verdict's slot, so on a phone it sits up in the eyebrow row
  // where the verdict sits, and has to be as short as the verdict is.
  const dots = (
    <span aria-hidden="true">
      <span className="aptitude-dot">.</span>
      <span className="aptitude-dot aptitude-dot-2">.</span>
      <span className="aptitude-dot aptitude-dot-3">.</span>
    </span>
  )
  return (
    <div
      className={CARD_WRAP}
      role="status"
      aria-busy="true"
      aria-label="Analysing aptitude results"
      data-testid="aptitude-report-skeleton"
    >
      <div className={`relative ${CARD_SHELL}`}>
        {/* The app's one shimmer idiom, shared with Profile's StatCard. */}
        <span aria-hidden="true" className="absolute inset-0 overflow-hidden rounded-xl sm:rounded-2xl pointer-events-none">
          <span className="absolute -inset-y-2 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-brand-600/12 to-transparent stat-skeleton-sweep" />
        </span>

        <div className="flex">
          {/* The scored card's own neutral stripe — the colour it uses when a status is unknown. */}
          <div data-testid="aptitude-card-stripe" className={`${CARD_STRIPE} bg-[#1a3a5c]`} />

          <div data-testid="aptitude-card-body" className={CARD_BODY}>
            <div className="flex items-baseline gap-2">
              <p data-testid="aptitude-card-eyebrow" className={`${CARD_EYEBROW} text-slate-500`}>Aptitude Report</p>
              <span className={`sm:hidden shrink-0 ${CARD_NOTE} text-brand-700`}>Analysing{dots}</span>
            </div>

            <div className="flex items-center gap-2 sm:gap-4">
              <div className="flex-1 min-w-0">
                {/* Same classes as the settled score, so the line box is the same
                    height to the pixel. Dashes, never digits. */}
                <p data-testid="aptitude-card-score" className={`${CARD_SCORE} text-slate-500 tabular-nums`} aria-hidden="true">
                  &ndash;&ndash;
                  <span className={`${CARD_UNIT} text-slate-500`}> / pass mark &ndash;&ndash;</span>
                </p>
                <p className="hidden sm:block text-[11px] font-bold text-brand-700">
                  Analysing aptitude results{dots}
                </p>
              </div>
              <span className={`${CARD_OPEN} text-slate-500`} aria-hidden="true">Open &rarr;</span>
            </div>

            {/* An indeterminate pass across an empty rail. It never rests at a width,
                because any resting width would read as a share of the score. */}
            <div data-testid="aptitude-card-rail" className={CARD_RAIL} aria-hidden="true">
              <div
                className="absolute inset-y-0 w-1/3 aptitude-rail-scan rounded-sm"
                style={{ background: 'linear-gradient(90deg, transparent 0%, #2d72d4 50%, transparent 100%)' }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
