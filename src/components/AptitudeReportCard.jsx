import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import {
  MAX_SCORE, MIN_COVERAGE_FOR_VERDICT, BATTERY_BY_KEY,
  gameTitle, onHard, reportVerdict, statusColour, TONE_TEXT,
} from '../data/cbatBatteries'

// The Aptitude Report's shopfront, sitting above the game grid on /cbat.
//
// It exists because the report only works as a habit. A user who has to remember a separate page
// will look at their estimate once; a user who sees the number move every time they open the games
// hub has a reason to play the game that moves it most. So the card leads with one figure and one
// thing to go and do — everything else stays on the report itself.
//
// It reserves its space with a skeleton while the summary loads. This used to render nothing at
// all, on the reasoning that a placeholder shifting the games down was worse than a card fading
// in — but that had it backwards: rendering nothing IS the shift, because the card drops in above
// the grid and pushes the games down after the fetch lands. The /cbat grid is tuned to put all 22
// games on one phone screen, so that late shove is the difference between fitting and not.
//
// THE CARD IS NEVER EMPTY AND NEVER A DEAD READOUT. Four things can be true of a user, and each
// gets a figure it can honestly lead with:
//
//   verdict   — a role chosen and enough of it measured   → score against the pass mark
//   coverage  — a role chosen, some of it measured        → "12% of this role measured"
//   runs      — a game started but not settled yet        → "2 / 3 runs to settle your first game"
//   roles     — scores but no role chosen                 → "4 / 13 roles you'd pass"
//
// Only the first is a result. The other three are progress, and the distinction is the point: an
// estimate renormalised over 8% of a role is real arithmetic and completely unsafe to read as a
// verdict. Put "96 / pass mark 112" on the games hub and it gets read as "am I passing", whatever
// the caption says — and the figure is not even stable, because the next game to start counting
// can move it thirty points, usually downwards. A player who saw 130 on Monday and 94 on Wednesday
// would have been taught that practising made them worse. Every progress figure here only ever
// goes up, names a next action, and cannot be mistaken for a pass.
//
// The runs state is the one that matters most, because it is where a user is on their second or
// third game and one more go turns nothing into something. It counts that game's runs, names it,
// and says how many are left.

// ── Shared geometry ──────────────────────────────────────────────────────────
// The boxes that set the card's height, defined once and used by every state INCLUDING the
// skeleton. Height parity is the skeleton's entire job, so the two cannot be allowed to drift: a
// change made here now applies to both by construction, rather than by someone remembering to
// copy it across.
//
// The `sm:` half of each pair is the card as it has always been on a desktop. The bare half is
// the phone form, which is a different shape rather than a scaled one: the verdict moves up
// beside the eyebrow, so the scored card becomes two text lines and a rail instead of three and a
// rail, and every box loses padding. That takes it from roughly 135px to roughly 72px. The grid
// below needs about 460px for its six rows of tiles, and a small phone only has 540-570px of
// viewport under the app chrome, so the 60-odd pixels are most of a grid row bought back.
//
// A progress card keeps its action line on a phone, where the scored card drops its verdict. It
// cannot do the same trick, because the line it would drop is the next action, and the action is
// the whole reason to show this card to someone with no score. That is one line — about eleven
// pixels — and it is why the skeleton mirrors the PROGRESS shape rather than the scored one: the
// skeleton has to be the taller of the two, so the grid below settles upward when the card lands
// rather than being shoved down.
const CARD_WRAP    = 'mb-3 sm:mb-5'
const CARD_STRIPE  = 'w-1.5 sm:w-2 shrink-0'
const CARD_BODY    = 'flex-1 min-w-0 p-2 sm:p-4'
const CARD_EYEBROW = 'flex-1 min-w-0 truncate text-[9px] leading-[1.2] sm:text-[10px] sm:leading-normal uppercase tracking-wide'
const CARD_SCORE   = 'font-mono font-extrabold text-lg sm:text-2xl leading-tight'
const CARD_UNIT    = 'text-[11px] sm:text-sm font-bold'
const CARD_NOTE    = 'text-[9px] leading-[1.2] font-bold'
const CARD_ACTION  = 'text-[9px] leading-[1.2] sm:text-[11px] font-bold truncate'
const CARD_OPEN    = 'shrink-0 text-[10px] sm:text-xs font-bold'
const CARD_RAIL    = 'relative mt-1 h-1.5 sm:mt-3 sm:h-2 bg-[#060e1a] border border-[#1a3a5c] rounded-sm overflow-hidden'
const CARD_SHELL   = 'block bg-surface border border-slate-200 rounded-xl sm:rounded-2xl overflow-hidden card-shadow'

// The states are not all the same height — the scored card is a line shorter on a phone — so the
// swap out of the skeleton is a size change, and a size change that lands in one frame reads as a
// glitch. One persistent wrapper owns the outer box for every state, which is what lets
// framer-motion's `layout` measure the before and the after and glide between them.
const LAYOUT_TRANSITION = { duration: 0.3, ease: 'easeOut' }

const RUNS_TO_COUNT_FALLBACK = 3   // only for a payload served before runsToCount existed

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

  // Guards the SHAPE, not just the absence. `data` is whatever the endpoint returned, and every
  // branch below walks `batteries` — so a response that came back without it (an error body, an
  // empty payload, an older cached one) threw and took the whole page down with it, because a
  // render error is not caught by the try above. This card is an extra, so the right answer to an
  // unexpected payload is to show nothing and leave the page alone.
  if (!loading && !Array.isArray(data?.batteries)) return null

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={LAYOUT_TRANSITION}
      className={CARD_WRAP}
    >
      {loading ? <ReportSkeleton /> : <ReportCard data={data} />}
    </motion.div>
  )
}

function ReportCard({ data }) {
  const targetKey = data.targetBattery
  const target = targetKey ? data.batteries.find(b => b.key === targetKey) : null
  const label = target ? (BATTERY_BY_KEY[targetKey]?.label ?? targetKey) : null

  const progress = progressState(data, target, label)
  return progress ? <ProgressCard {...progress} /> : <ScoredCard target={target} label={label} />
}

// ── What to lead with ────────────────────────────────────────────────────────
// Returns the progress card's content, or null when there is a verdict to report instead.
//
// The order is the argument. Coverage comes first because, once a role is chosen and partly
// measured, the coverage figure is the only thing standing between the user and a verdict. Runs
// come next, and beat everything below them, because a run is the smallest unit of progress this
// report has and the one a user can act on tonight — "one more go at Target" is a thing someone
// does; "raise your spatial reasoning" is not.
function progressState(data, target, label) {
  const runsToCount = data.runsToCount ?? RUNS_TO_COUNT_FALLBACK
  const nearest = data.nearestUnlock

  if (target && (target.status === 'pass' || target.status === 'fail')) return null

  // A player who has not settled a single game yet gets the runs fraction, even though a role is
  // chosen and a few percent of it is technically measured. Runs count from the first one now, so
  // this user DOES have a coverage figure — but it is 6%, it moves in slivers, and it is the wrong
  // thing to lead with when they are one go away from their first settled level. Coverage takes
  // over the moment there is a settled test to build on, which is the state it was written for.
  const unsettled = target && !target.firmTests && nearest

  if (target?.status === 'provisional' && !unsettled) {
    return {
      label,
      headline: `${target.coverage}%`,
      unit: ' of this role measured',
      action: focusAction(data.targetFocus, 'to measure more of it', runsToCount)
        ?? 'Play more of this role’s games to measure more of it.',
      pct: Math.min(100, target.coverage),
      tick: MIN_COVERAGE_FOR_VERDICT,
    }
  }

  // The state this card is really for: a game started, not settled, and the finish line three runs
  // away at most. Nothing else here is as motivating as a fraction that is one go from completing,
  // so it outranks the few percent the card would otherwise be showing.
  if (nearest) {
    const total = nearest.runs + nearest.runsNeeded
    return {
      label,
      headline: `${nearest.runs} / ${total}`,
      unit: ' runs to settle your first game',
      action: `Play ${gameTitle(nearest.gameKey)}${onHard(nearest.gameKey)} ${times(nearest.runsNeeded)} to settle it.`,
      pct: (nearest.runs / total) * 100,
      tick: null,
    }
  }

  if (target) {
    return {
      label,
      headline: '0%',
      unit: ' of this role measured',
      action: focusAction(data.targetFocus, 'to start your score', runsToCount) ?? firstScore(runsToCount),
      pct: 0,
      tick: MIN_COVERAGE_FOR_VERDICT,
    }
  }

  // No role chosen. Someone with real scores gets the most persuasive true thing we can say, which
  // is how many roles they would already clear; someone with nothing gets the price of entry.
  const scored = data.batteries.filter(b => b.score != null).length
  const passing = data.batteries.filter(b => b.status === 'pass').length
  if (scored) {
    return {
      label: null,
      headline: passing ? `${passing} / ${scored}` : `${scored}`,
      unit: passing ? ' roles you’d pass' : ' roles scored',
      action: 'Pick the role you’re aiming for and we’ll track it here.',
      pct: (passing / scored) * 100,
      tick: null,
    }
  }
  return {
    label: null,
    headline: `${runsToCount}`,
    unit: ' runs to settle your first game',
    action: firstScore(runsToCount),
    pct: 0,
    tick: null,
  }
}

const times = (n) => `${n} more time${n === 1 ? '' : 's'}`
const firstScore = (n) => `Play any CBAT game and your score starts here. ${n} runs settles it.`

// The report's own ranked next play, worded for a card with room for one line. Null when the
// summary carried no focus row, which the caller answers with something it can always say.
function focusAction(focus, goal, runsToCount) {
  if (!focus?.gameKey) return null
  const title = `${gameTitle(focus.gameKey)}${onHard(focus.gameKey)}`
  if (focus.easierOnly) return `Play ${title}. Easier runs do not count.`
  if (focus.kind === 'unlock') return `Play ${title} ${times(focus.needsRuns?.[0]?.runsNeeded ?? runsToCount)} ${goal}.`
  return `Keep playing ${title}.`
}

// ── The cards ────────────────────────────────────────────────────────────────

// Everything short of a verdict. Deliberately one dumb presentational component rather than one
// per state: the states differ only in their words and their fill, and giving each its own markup
// is how three cards quietly drift into three heights.
function ProgressCard({ label, headline, unit, action, pct, tick }) {
  return (
    <Link
      to="/cbat/report"
      className={`${CARD_SHELL} no-underline hover:border-brand-300 transition-colors`}
      title={action}
    >
      <div className="flex">
        {/* The neutral stripe, never a status colour. Nothing here is a result. */}
        <div data-testid="aptitude-card-stripe" className={`${CARD_STRIPE} bg-[#1a3a5c]`} />

        <div data-testid="aptitude-card-body" className={CARD_BODY}>
          <div className="flex items-baseline gap-2">
            <p data-testid="aptitude-card-eyebrow" className={`${CARD_EYEBROW} text-slate-500`}>
              {label ? `Aptitude Report · ${label}` : 'Aptitude Report'}
            </p>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            <div className="flex-1 min-w-0">
              <p data-testid="aptitude-card-score" className={`${CARD_SCORE} text-slate-900`}>
                {headline}<span className={`${CARD_UNIT} text-slate-600`}>{unit}</span>
              </p>
            </div>
            <span className={`${CARD_OPEN} text-brand-700`}>Open &rarr;</span>
          </div>

          <p data-testid="aptitude-card-action" className={`${CARD_ACTION} text-brand-700`}>{action}</p>

          <div data-testid="aptitude-card-rail" className={CARD_RAIL}>
            <motion.div
              className="absolute inset-y-0 left-0 aptitude-rail-fill"
              style={{ background: '#2d72d4', opacity: 0.9 }}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
            />
            {/* Where a verdict starts. Only on the coverage rail: the runs and roles rails are
                already fractions of their own end, and a tick at 100% would sit half off the
                track. */}
            {tick !== null && (
              <div
                data-testid="aptitude-card-tick"
                className="absolute inset-y-0 w-[2px] bg-[#ff4d4d]"
                style={{ left: `calc(${tick}% - 1px)` }}
              />
            )}
          </div>
        </div>
      </div>
    </Link>
  )
}

// A role chosen and enough of it measured to call: the score against the pass mark, which is what
// the whole report is for.
function ScoredCard({ target, label }) {
  const verdict = reportVerdict(target)
  const pct = Math.min(100, ((target.score ?? 0) / MAX_SCORE) * 100)

  return (
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
              Aptitude Report &middot; {label}
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
  )
}

// Holds the card's exact height while the summary is in flight, so the game grid below never
// moves. Every box here is one of the shared constants above — same padding, same line heights,
// same stripe, same breakpoint behaviour — so it and the real card are the same height by
// construction rather than by a hard-coded pixel value that would drift the first time the card
// changes.
//
// It mirrors the PROGRESS shape, which is the taller of the two and the one most users who see a
// skeleton at all are about to get: anyone whose card is worth waiting for is by definition not
// yet a returning player with a settled score. A scored card landing instead settles the grid
// UPWARD by a line, which hides nothing; the reverse would shove the games down.
//
// It shows no number at all. An earlier version rolled a random figure through the score slot to
// look like arithmetic; it read as a fault, because the one number this card exists to report was
// visibly jumping between values it could not possibly have computed. A placeholder that is
// obviously a placeholder is more trustworthy than a plausible one that is wrong. So the score
// slot holds dashes, the stripe stays the neutral "no status yet" blue, and the only motion is
// the shared shimmer, the dots, and one indeterminate pass across the rail — none of which claims
// to know anything.
function ReportSkeleton() {
  const dots = (
    <span aria-hidden="true">
      <span className="aptitude-dot">.</span>
      <span className="aptitude-dot aptitude-dot-2">.</span>
      <span className="aptitude-dot aptitude-dot-3">.</span>
    </span>
  )
  return (
    <div
      className={`relative ${CARD_SHELL}`}
      role="status"
      aria-busy="true"
      aria-label="Analysing aptitude results"
      data-testid="aptitude-report-skeleton"
    >
      {/* The app's one shimmer idiom, shared with Profile's StatCard. */}
      <span aria-hidden="true" className="absolute inset-0 overflow-hidden rounded-xl sm:rounded-2xl pointer-events-none">
        <span className="absolute -inset-y-2 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-brand-600/12 to-transparent stat-skeleton-sweep" />
      </span>

      <div className="flex">
        {/* The real card's own neutral stripe — the colour it uses when a status is unknown. */}
        <div data-testid="aptitude-card-stripe" className={`${CARD_STRIPE} bg-[#1a3a5c]`} />

        <div data-testid="aptitude-card-body" className={CARD_BODY}>
          <div className="flex items-baseline gap-2">
            <p data-testid="aptitude-card-eyebrow" className={`${CARD_EYEBROW} text-slate-500`}>Aptitude Report</p>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            <div className="flex-1 min-w-0">
              {/* Same classes as the settled figure, so the line box is the same height to the
                  pixel. Dashes, never digits — and no unit either: the card that lands is far more
                  often counting runs than reporting a pass mark, and a placeholder naming the
                  wrong unit would be a placeholder that lies twice. */}
              <p data-testid="aptitude-card-score" className={`${CARD_SCORE} text-slate-500 tabular-nums`} aria-hidden="true">
                &ndash;&ndash;
              </p>
            </div>
            <span className={`${CARD_OPEN} text-slate-500`} aria-hidden="true">Open &rarr;</span>
          </div>

          {/* Names the work, not the result. This used to promise "what to play next", which the
              card then failed to deliver most of the time: four different figures can land here
              and only one of them is a recommendation. Reading the recent runs is the one thing
              that is true of every load, so it is the only thing safe to say before one arrives. */}
          <p data-testid="aptitude-card-action" className={`${CARD_ACTION} text-brand-700`}>
            Checking your recent runs{dots}
          </p>

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
  )
}
