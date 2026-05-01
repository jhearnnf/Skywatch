import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useNewCategoryUnlock } from '../context/NewCategoryUnlockContext'
import { useAppSettings } from '../context/AppSettingsContext'
import { useUnsolvedReports } from '../context/UnsolvedReportsContext'
import { invalidateSoundSettings, previewTypingSound, previewGridRevealTone } from '../utils/sound'
import RankBadge from '../components/RankBadge'
import SocialsSection from '../components/admin/SocialsSection'
import { TUTORIAL_STEPS, TUTORIAL_KEYS, useAppTutorial } from '../context/AppTutorialContext'
import TutorialsEditor from './admin/TutorialsEditor'
import SEO from '../components/SEO'
import { has3DModel } from '../data/aircraftModels'
import { CATEGORIES as BRIEF_CATEGORIES, SUBCATEGORIES as BRIEF_SUBCATEGORIES } from '../../backend/constants/categories.json'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const fmtNum = (n) => (n ?? 0).toLocaleString()

const fmtUSD = (n) => {
  const v = typeof n === 'number' ? n : 0
  return `$${v.toFixed(2)}`
}

function fmtUptime(s) {
  if (!s) return '0s'
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  if (d) return `${d}d ${h}h ${m}m`
  if (h) return `${h}h ${m}m`
  if (m) return `${m}m ${sec}s`
  return `${sec}s`
}

function fmtSeconds(s) {
  if (!s) return '0s'
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  if (h) return `${h}h ${m}m`
  if (m) return `${m}m ${sec}s`
  return `${sec}s`
}

const ALL_CATEGORIES = [
  'News', 'Aircrafts', 'Bases', 'Ranks', 'Squadrons', 'Training', 'Roles',
  'Threats', 'Allies', 'Missions', 'AOR', 'Tech', 'Terminology', 'Treaties',
  'Heritage', 'Actors',
]

// RAF rank names indexed by rank number (1–19)
const RAF_RANKS = [
  { n: 1,  name: 'Aircraftman',                   abbr: 'AC'    },
  { n: 2,  name: 'Leading Aircraftman',            abbr: 'LAC'   },
  { n: 3,  name: 'Senior Aircraftman',             abbr: 'SAC'   },
  { n: 4,  name: 'Corporal',                       abbr: 'Cpl'   },
  { n: 5,  name: 'Sergeant',                       abbr: 'Sgt'   },
  { n: 6,  name: 'Chief Technician',               abbr: 'Chf Tech' },
  { n: 7,  name: 'Flight Sergeant',                abbr: 'FS'    },
  { n: 8,  name: 'Warrant Officer',                abbr: 'WO'    },
  { n: 9,  name: 'Pilot Officer',                  abbr: 'PO'    },
  { n: 10, name: 'Flying Officer',                 abbr: 'FO'    },
  { n: 11, name: 'Flight Lieutenant',              abbr: 'Flt Lt' },
  { n: 12, name: 'Squadron Leader',                abbr: 'Sqn Ldr' },
  { n: 13, name: 'Wing Commander',                 abbr: 'Wg Cdr' },
  { n: 14, name: 'Group Captain',                  abbr: 'Gp Capt' },
  { n: 15, name: 'Air Commodore',                  abbr: 'Air Cdre' },
  { n: 16, name: 'Air Vice-Marshal',               abbr: 'AVM'   },
  { n: 17, name: 'Air Marshal',                    abbr: 'AM'    },
  { n: 18, name: 'Air Chief Marshal',              abbr: 'ACM'   },
  { n: 19, name: 'Marshal of the Royal Air Force', abbr: 'MRAF'  },
]

// Pathway categories that can appear in the Learn Pathway page (ordered by default progression)
const PATHWAY_CATEGORIES = [
  'News', 'Bases', 'Terminology', 'Aircrafts', 'Heritage', 'Ranks', 'Squadrons', 'Allies',
  'Training', 'AOR', 'Roles', 'Actors', 'Tech', 'Threats', 'Missions', 'Treaties',
]


// ─────────────────────────────────────────────────────────────────────────────
// Shared UI
// ─────────────────────────────────────────────────────────────────────────────

function Toast({ msg, onClear }) {
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(onClear, 3500)
    return () => clearTimeout(t)
  }, [msg, onClear])
  if (!msg) return null
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-slate-100 text-slate-900 text-sm font-semibold px-5 py-2.5 rounded-full shadow-lg"
    >
      {msg}
    </motion.div>
  )
}

function ConfirmModal({ title, body, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel }) {
  const [reason, setReason] = useState('testing')
  const [busy,   setBusy]   = useState(false)

  useEffect(() => {
    const fn = (e) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onCancel])

  const confirm = async () => {
    if (!reason.trim()) return
    setBusy(true)
    await onConfirm(reason.trim())
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-end sm:items-center justify-center p-4" onClick={onCancel}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-surface rounded-2xl p-6 w-full max-w-md shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-slate-900 mb-1">{title}</h3>
        {body && <p className="text-sm text-slate-500 mb-4">{body}</p>}
        <label className="block text-xs font-semibold text-slate-500 mb-1">Reason (required)</label>
        <textarea
          autoFocus
          rows={2}
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Briefly describe why…"
          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-200 focus:border-brand-400 resize-none mb-4"
        />
        <div className="flex gap-2">
          <button onClick={onCancel} disabled={busy} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors">
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={!reason.trim() || busy}
            className={`flex-1 py-2.5 rounded-xl text-white text-sm font-bold transition-colors disabled:opacity-40
              ${danger ? 'bg-red-500 hover:bg-red-600' : 'bg-brand-600 hover:bg-brand-700'}`}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

function StatCard({ label, value, sub, color = 'slate', disabled = false }) {
  const colors = {
    slate:  'bg-slate-50  border-slate-200  text-slate-700',
    brand:  'bg-brand-50  border-brand-200  text-brand-700',
    amber:  'bg-amber-50  border-amber-200  text-amber-700',
    emerald:'bg-emerald-50 border-emerald-200 text-emerald-700',
    red:    'bg-red-50    border-red-200    text-red-700',
  }
  const palette = disabled ? colors.slate : (colors[color] ?? colors.slate)
  return (
    <div
      className={`rounded-2xl border p-4 ${palette} ${disabled ? 'opacity-50 grayscale pointer-events-none' : ''}`}
      aria-disabled={disabled || undefined}
    >
      <p className="text-xl font-extrabold mb-0.5">{disabled ? '—' : (value ?? '—')}</p>
      <p className="text-xs font-semibold uppercase tracking-wider opacity-70">{label}</p>
      {sub && <p className="text-[10px] opacity-50 mt-0.5 whitespace-nowrap">{sub}</p>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// STATS TAB
// ─────────────────────────────────────────────────────────────────────────────

function StatsSection({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between text-left mb-3"
      >
        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest">{title}</h3>
        <span className="text-slate-400 text-xs ml-2">{open ? '▲' : '▼'}</span>
      </button>
      {open && children}
    </section>
  )
}

function StatsTab({ API, onViewEmailLog }) {
  const { apiFetch } = useAuth()
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [error, setError] = useState('')
  const [openRouter, setOpenRouter] = useState(null)

  useEffect(() => {
    apiFetch(`${API}/api/admin/stats`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d.status === 'success') setStats(d.data); else setError('Failed to load stats') })
      .catch(() => setError('Failed to load stats'))
  }, [API])

  useEffect(() => {
    apiFetch(`${API}/api/admin/openrouter/summary`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d.status === 'success') setOpenRouter(d.data) })
      .catch(() => {})
  }, [API])

  const openRouterNav = (key, scope) => {
    const params = new URLSearchParams({ key })
    if (scope === 'today') {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      params.set('from', start.toISOString())
    }
    navigate(`/admin/openrouter-usage?${params.toString()}`)
  }

  if (error) return <p className="text-sm text-red-500 py-8 text-center">{error}</p>
  if (!stats) return <div className="py-8 text-center text-slate-400 text-sm animate-pulse">Loading stats…</div>

  const { users, games, briefs, tutorials, server } = stats

  const pct = (n, d) => d > 0 ? `${Math.round((n / d) * 100)}%` : '—'

  return (
    <div className="space-y-8">
      {/* Users */}
      <StatsSection title="Users" defaultOpen>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total Users"      value={fmtNum(users.totalUsers)}       color="brand" />
          <StatCard label="Free"             value={fmtNum(users.freeUsers)}         color="slate" />
          <StatCard label="Trial"            value={fmtNum(users.trialUsers)}        color="amber" />
          <StatCard label="Paying Subscribers" value={fmtNum(users.subscribedUsers)}   color="emerald" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <StatCard label="Easy Mode"        value={fmtNum(users.easyPlayers)}       color="slate" />
          <StatCard label="Medium Mode"      value={fmtNum(users.mediumPlayers)}     color="slate" />
          <StatCard label="Combined Streaks" value={fmtNum(users.combinedStreaks)}   color="slate" />
          <StatCard label="Users Online"     sub="not yet implemented"               color="slate" disabled />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <button
            type="button"
            onClick={() => onViewEmailLog?.('sent')}
            className="text-left cursor-pointer hover:brightness-95 transition focus:outline-none focus:ring-2 focus:ring-brand-300 rounded-2xl"
          >
            <StatCard label="Emails Sent"   value={fmtNum(users.emailsSent)}   color="brand" sub="sent successfully" />
          </button>
          <button
            type="button"
            onClick={() => onViewEmailLog?.('failed')}
            className="text-left cursor-pointer hover:brightness-95 transition focus:outline-none focus:ring-2 focus:ring-red-300 rounded-2xl"
          >
            <StatCard label="Emails Failed" value={fmtNum(users.emailsFailed)} color="red" sub="delivery failed" />
          </button>
        </div>
      </StatsSection>

      {/* OpenRouter API spend */}
      <StatsSection title="OpenRouter Spend" defaultOpen>
        {!openRouter ? (
          <div className="py-4 text-center text-slate-400 text-xs animate-pulse">Loading OpenRouter usage…</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <button type="button" onClick={() => openRouterNav('main', 'today')} className="text-left cursor-pointer hover:brightness-95 transition focus:outline-none focus:ring-2 focus:ring-red-300 rounded-2xl">
              <StatCard
                label={<><span className="inline-block px-1.5 py-0.5 rounded bg-red-600 text-white text-[9px] font-bold tracking-wider mr-1.5 align-middle normal-case">TODAY</span>main</>}
                value={fmtUSD(openRouter.main?.today)}
                sub={`${fmtNum(openRouter.main?.todayCalls)} calls today`}
                color="emerald"
              />
            </button>
            <button type="button" onClick={() => openRouterNav('main', 'lifetime')} className="text-left cursor-pointer hover:brightness-95 transition focus:outline-none focus:ring-2 focus:ring-amber-300 rounded-2xl">
              <StatCard
                label={<><span className="inline-block px-1.5 py-0.5 rounded bg-amber-600 text-white text-[9px] font-bold tracking-wider mr-1.5 align-middle normal-case">LIFETIME</span>main</>}
                value={fmtUSD(openRouter.main?.lifetime)}
                sub={openRouter.main?.lifetimeError || 'all-time spend'}
                color="emerald"
              />
            </button>
            <button type="button" onClick={() => openRouterNav('aptitude', 'today')} className="text-left cursor-pointer hover:brightness-95 transition focus:outline-none focus:ring-2 focus:ring-red-300 rounded-2xl">
              <StatCard
                label={<><span className="inline-block px-1.5 py-0.5 rounded bg-red-600 text-white text-[9px] font-bold tracking-wider mr-1.5 align-middle normal-case">TODAY</span>aptitude</>}
                value={fmtUSD(openRouter.aptitude?.today)}
                sub={`${fmtNum(openRouter.aptitude?.todayCalls)} calls today`}
                color="emerald"
              />
            </button>
            <button type="button" onClick={() => openRouterNav('aptitude', 'lifetime')} className="text-left cursor-pointer hover:brightness-95 transition focus:outline-none focus:ring-2 focus:ring-amber-300 rounded-2xl">
              <StatCard
                label={<><span className="inline-block px-1.5 py-0.5 rounded bg-amber-600 text-white text-[9px] font-bold tracking-wider mr-1.5 align-middle normal-case">LIFETIME</span>aptitude</>}
                value={fmtUSD(openRouter.aptitude?.lifetime)}
                sub={openRouter.aptitude?.lifetimeError || 'all-time spend'}
                color="emerald"
              />
            </button>
            <button type="button" onClick={() => openRouterNav('socials', 'today')} className="text-left cursor-pointer hover:brightness-95 transition focus:outline-none focus:ring-2 focus:ring-red-300 rounded-2xl">
              <StatCard
                label={<><span className="inline-block px-1.5 py-0.5 rounded bg-red-600 text-white text-[9px] font-bold tracking-wider mr-1.5 align-middle normal-case">TODAY</span>socials</>}
                value={fmtUSD(openRouter.socials?.today)}
                sub={`${fmtNum(openRouter.socials?.todayCalls)} calls today`}
                color="emerald"
              />
            </button>
            <button type="button" onClick={() => openRouterNav('socials', 'lifetime')} className="text-left cursor-pointer hover:brightness-95 transition focus:outline-none focus:ring-2 focus:ring-amber-300 rounded-2xl">
              <StatCard
                label={<><span className="inline-block px-1.5 py-0.5 rounded bg-amber-600 text-white text-[9px] font-bold tracking-wider mr-1.5 align-middle normal-case">LIFETIME</span>socials</>}
                value={fmtUSD(openRouter.socials?.lifetime)}
                sub={openRouter.socials?.lifetimeError || 'all-time spend'}
                color="emerald"
              />
            </button>
            <button type="button" onClick={() => openRouterNav('casefiles', 'today')} className="text-left cursor-pointer hover:brightness-95 transition focus:outline-none focus:ring-2 focus:ring-red-300 rounded-2xl">
              <StatCard
                label={<><span className="inline-block px-1.5 py-0.5 rounded bg-red-600 text-white text-[9px] font-bold tracking-wider mr-1.5 align-middle normal-case">TODAY</span>casefiles</>}
                value={fmtUSD(openRouter.casefiles?.today)}
                sub={`${fmtNum(openRouter.casefiles?.todayCalls)} calls today`}
                color="emerald"
              />
            </button>
            <button type="button" onClick={() => openRouterNav('casefiles', 'lifetime')} className="text-left cursor-pointer hover:brightness-95 transition focus:outline-none focus:ring-2 focus:ring-amber-300 rounded-2xl">
              <StatCard
                label={<><span className="inline-block px-1.5 py-0.5 rounded bg-amber-600 text-white text-[9px] font-bold tracking-wider mr-1.5 align-middle normal-case">LIFETIME</span>casefiles</>}
                value={fmtUSD(openRouter.casefiles?.lifetime)}
                sub={openRouter.casefiles?.lifetimeError || 'all-time spend'}
                color="emerald"
              />
            </button>
          </div>
        )}
      </StatsSection>

      {/* Server / Performance */}
      <StatsSection title="Server & Performance" defaultOpen>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Uptime Since Deploy"  value={fmtUptime(server?.serverUptimeSeconds ?? 0)} color="brand" />
          <StatCard label="Total Loading Time"  value={fmtSeconds(Math.round((server?.totalLoadingMs ?? 0) / 1000))} color="brand" sub="cumulative user fetch wait" />
        </div>
      </StatsSection>

      {/* Airstars + Briefs + Tutorials */}
      <StatsSection title="Economy & Content">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Airstars in System" value={fmtNum(games.totalAirstarsEarned)}       color="amber" />
          <StatCard label="Briefs Read"        value={fmtNum(briefs.totalBrifsRead)}           color="slate" />
          <StatCard label="Briefs Opened"      value={fmtNum(briefs.totalBrifsOpened)}         color="slate" />
          <StatCard label="Time Reading"       value={fmtSeconds(briefs.totalReadSeconds ?? 0)} color="slate" />
          <StatCard label="Tutorials Viewed"   value={fmtNum(tutorials.viewed)}                color="slate" />
          <StatCard label="Tutorials Skipped"  value={fmtNum(tutorials.skipped)}               color="slate" />
        </div>
      </StatsSection>

      {/* Quiz */}
      <StatsSection title="Quiz">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Played"           value={fmtNum(games.totalGamesPlayed)}  color="brand" />
          <StatCard label="Completed"        value={fmtNum(games.totalGamesCompleted)} color="slate" />
          <StatCard label="Perfect Score"    value={pct(games.totalPerfectScores, games.totalGamesCompleted)} color="emerald" />
          <StatCard label="Abandoned"        value={pct(games.totalGamesAbandoned, games.totalGamesPlayed)} color="red" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <StatCard label="Time Played"      value={fmtSeconds(games.quizTotalSeconds)} color="slate" />
          <StatCard label="Pass Rate"        value={pct(games.totalGamesWon, games.totalGamesCompleted)} color="emerald" />
          <StatCard label="Failed Quizzes"   value={pct(games.totalGamesLost, games.totalGamesCompleted)} color="amber" sub={`below pass threshold`} />
        </div>
      </StatsSection>

      {/* Battle of Order */}
      <StatsSection title="Battle of Order">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Games"     value={fmtNum(games.boo?.total)}                                    color="brand" />
          <StatCard label="Won"       value={pct(games.boo?.won, games.boo?.total)}                       color="emerald" />
          <StatCard label="Defeated"  value={pct(games.boo?.defeated, games.boo?.total)}                  color="amber" />
          <StatCard label="Abandoned" value={pct(games.boo?.abandoned, games.boo?.total)}                 color="red" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <StatCard label="Time Played" value={fmtSeconds(games.boo?.totalSeconds)} color="slate" />
        </div>
      </StatsSection>

      {/* Where's That Aircraft */}
      <StatsSection title="Where's That Aircraft">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Games"       value={fmtNum(games.wta?.total)}                                     color="brand" />
          <StatCard label="Won"         value={pct(games.wta?.won, games.wta?.total)}                        color="emerald" />
          <StatCard label="Abandoned"   value={pct(games.wta?.abandoned, games.wta?.total)}                  color="red" />
          <StatCard label="Time Played" value={fmtSeconds(games.wta?.totalSeconds)}                          color="slate" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <StatCard label="R1 Correct (ID)"    value={pct(games.wta?.round1Correct, games.wta?.total)}  color="amber" sub="Aircraft identified" />
          <StatCard label="R2 Correct (Base)"  value={pct(games.wta?.round2Correct, games.wta?.total)}  color="amber" sub="Base located" />
        </div>
      </StatsSection>

      {/* Flashcards */}
      <StatsSection title="Flashcards">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Sessions"    value={fmtNum(games.flashcard?.sessions)}                                                                        color="brand" />
          <StatCard label="Cards Total" value={fmtNum(games.flashcard?.totalCards)}                                                                      color="slate" />
          <StatCard label="Recalled"    value={pct(games.flashcard?.recalled, games.flashcard?.totalCards)}                                              color="emerald" />
          <StatCard label="Missed"      value={pct((games.flashcard?.totalCards ?? 0) - (games.flashcard?.recalled ?? 0), games.flashcard?.totalCards)}  color="red" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <StatCard label="Time Played" value={fmtSeconds(games.flashcard?.totalSeconds)} color="slate" />
          <StatCard label="Abandoned"   value={fmtNum(games.flashcard?.abandoned)}        color="red" />
        </div>
      </StatsSection>

      {/* Aptitude Sync */}
      <StatsSection title="Aptitude Sync">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Sessions"  value={fmtNum(games.aptitudeSync?.total)}                                         color="brand" />
          <StatCard label="Completed" value={pct(games.aptitudeSync?.completed, games.aptitudeSync?.total)}             color="emerald" />
          <StatCard label="Abandoned" value={pct(games.aptitudeSync?.abandoned, games.aptitudeSync?.total)}             color="red" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <StatCard label="Airstars Earned" value={fmtNum(games.aptitudeSync?.airstarsEarned)} color="amber" sub="across all sessions" />
          <StatCard label="Avg per Session" value={fmtNum(games.aptitudeSync?.completed ? Math.round((games.aptitudeSync?.airstarsEarned ?? 0) / games.aptitudeSync.completed) : 0)} color="slate" sub="completed sessions" />
        </div>
      </StatsSection>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS TAB
// ─────────────────────────────────────────────────────────────────────────────

const SOUND_GROUPS = [
  {
    title: 'Brief Reader',
    sounds: [
      { key: 'volumeTargetLocked',        enabledKey: 'soundEnabledTargetLocked',        label: 'Targeting Engaged',    sound: 'target_locked'        },
      { key: 'volumeStandDown',           enabledKey: 'soundEnabledStandDown',           label: 'Targeting Disengaged', sound: 'stand_down'           },
      { key: 'volumeTargetLockedKeyword', enabledKey: 'soundEnabledTargetLockedKeyword', label: 'Keyword Scan',         sound: 'target_locked_keyword'},
      { key: 'volumeFire',                enabledKey: 'soundEnabledFire',                label: 'Keyword Fired',        sound: 'fire'                 },
      { key: 'volumeOutOfAmmo',           enabledKey: 'soundEnabledOutOfAmmo',           label: 'Out of Ammo',          sound: 'out_of_ammo'          },
    ],
  },
  {
    title: 'Navigation',
    sounds: [
      { key: 'volumeIntelBriefOpened',    enabledKey: 'soundEnabledIntelBriefOpened',    label: 'Brief Opened',          sound: 'intel_brief_opened'    },
      { key: 'volumeFirstBriefComplete',  enabledKey: 'soundEnabledFirstBriefComplete',  label: 'Brief Complete (Guest)', sound: 'first_brief_complete' },
      { key: 'volumeGridReveal',          enabledKey: 'soundEnabledGridReveal',          durationKey: 'durationGridReveal', durationMax: 50, durationDefault: 12, label: 'Image Grid Reveal',      sound: '__grid_reveal__'       },
    ],
  },
  {
    title: 'Rewards',
    sounds: [
      { key: 'volumeAirstar',          enabledKey: 'soundEnabledAirstar',          label: 'Airstars Earned',   sound: 'airstar'           },
      { key: 'volumeLevelUp',          enabledKey: 'soundEnabledLevelUp',          label: 'Level Up',          sound: 'level_up'          },
      { key: 'volumeRankPromotion',    enabledKey: 'soundEnabledRankPromotion',    label: 'Rank Promotion',    sound: 'rank_promotion'    },
      { key: 'volumeCategoryUnlocked', enabledKey: 'soundEnabledCategoryUnlocked', label: 'Category Unlocked', sound: 'category_unlocked' },
    ],
  },
  {
    title: 'Intel Recall',
    sounds: [
      { key: 'volumeQuizAnswerCorrect',   enabledKey: 'soundEnabledQuizAnswerCorrect',   label: 'Answer Correct',   sound: 'quiz_answer_correct'   },
      { key: 'volumeQuizAnswerIncorrect', enabledKey: 'soundEnabledQuizAnswerIncorrect', label: 'Answer Incorrect', sound: 'quiz_answer_incorrect' },
      { key: 'volumeQuizCompleteWin',  enabledKey: 'soundEnabledQuizCompleteWin',  label: 'Recall Won',  sound: 'quiz_complete_win'  },
      { key: 'volumeQuizCompleteLose', enabledKey: 'soundEnabledQuizCompleteLose', label: 'Recall Fail', sound: 'quiz_complete_lose' },
    ],
  },
  {
    title: 'Flashcards',
    sounds: [
      { key: 'volumeFlashcardStart',     enabledKey: 'soundEnabledFlashcardStart',     label: 'Drill Start',       sound: 'flashcard_start'     },
      { key: 'volumeFlashcardCorrect',   enabledKey: 'soundEnabledFlashcardCorrect',   label: 'Correct Answer',    sound: 'flashcard_correct'   },
      { key: 'volumeFlashcardIncorrect', enabledKey: 'soundEnabledFlashcardIncorrect', label: 'Incorrect Answer',  sound: 'flashcard_incorrect' },
      { key: 'volumeFlashcardCollect',   enabledKey: 'soundEnabledFlashcardCollect',   label: 'Card Collected',    sound: 'flashcard_collect'   },
    ],
  },
  {
    title: 'Battle of Order',
    sounds: [
      { key: 'volumeBattleOfOrderSelection', enabledKey: 'soundEnabledBattleOfOrderSelection', label: 'Selection',  sound: 'battle_of_order_selection' },
      { key: 'volumeBattleOfOrderWon',       enabledKey: 'soundEnabledBattleOfOrderWon',       label: 'Game Won',   sound: 'battle_of_order_won'       },
      { key: 'volumeBattleOfOrderLost',      enabledKey: 'soundEnabledBattleOfOrderLost',      label: 'Game Lost',  sound: 'battle_of_order_lost'      },
    ],
  },
  {
    title: "Where's That Aircraft",
    sounds: [
      { key: 'volumeWhereAircraftMissionDetected', enabledKey: 'soundEnabledWhereAircraftMissionDetected', label: 'Mission Detected', sound: 'where_aircraft_mission_detected' },
      { key: 'volumeWhereAircraftWin',             enabledKey: 'soundEnabledWhereAircraftWin',             label: 'Mission Complete', sound: 'where_aircraft_win'              },
      { key: 'volumeWhereAircraftLose',            enabledKey: 'soundEnabledWhereAircraftLose',            label: 'Mission Failed',   sound: 'where_aircraft_lose'             },
    ],
  },
  {
    title: 'Aptitude Sync / Terminal',
    sounds: [
      { key: 'volumeTypingSound', enabledKey: 'soundEnabledTypingSound', durationKey: 'durationTypingSound', durationMax: 40, durationDefault: 3, label: 'Typing Sound', sound: '__typing__' },
    ],
  },
]

const ALL_SOUND_KEYS = SOUND_GROUPS.flatMap(g => g.sounds.flatMap(s => [s.key, s.enabledKey, s.durationKey].filter(Boolean)))

function NumInput({ label, value, onChange, min = 0, max = 9999, hint }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0">
      <div>
        <p className="text-sm font-semibold text-slate-700">{label}</p>
        {hint && <p className="text-xs text-slate-400">{hint}</p>}
      </div>
      <input
        type="number"
        min={min} max={max}
        value={value ?? ''}
        onChange={e => onChange(Number(e.target.value))}
        className="w-20 border border-slate-200 rounded-xl px-3 py-1.5 text-sm text-right outline-none focus:ring-2 focus:ring-brand-200 focus:border-brand-400"
      />
    </div>
  )
}

function Toggle({ label, hint, checked, onChange }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-slate-100 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-700">{label}</p>
        {hint && <p className="text-xs text-slate-400">{hint}</p>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 shrink-0 rounded-full transition-colors ${checked ? 'bg-brand-500' : 'bg-slate-200'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-surface rounded-full shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  )
}

const OUT_OF_AMMO_VARIANTS = ['out_of_ammo_1', 'out_of_ammo_2', 'out_of_ammo_3']

// Shared across rows: only one preview MP3 plays at a time.
let _currentPreviewAudio = null
function stopCurrentPreviewAudio() {
  if (_currentPreviewAudio) {
    try { _currentPreviewAudio.pause(); _currentPreviewAudio.currentTime = 0 } catch {}
    _currentPreviewAudio = null
  }
}

function SoundRowV2({ label, sound, value, onChange, enabled, onToggle, durationValue, onDurationChange, durationMax = 50, durationDefault = 12 }) {
  const preview = () => {
    invalidateSoundSettings()
    stopCurrentPreviewAudio()
    if (sound === '__typing__') {
      previewTypingSound(value ?? 30, durationValue)
      return
    }
    if (sound === '__grid_reveal__') {
      previewGridRevealTone(value ?? 30, durationValue)
      return
    }
    try {
      const file = sound === 'out_of_ammo'
        ? OUT_OF_AMMO_VARIANTS[Math.floor(Math.random() * OUT_OF_AMMO_VARIANTS.length)]
        : sound
      const audio = new Audio(`/sounds/${file}.mp3`)
      audio.volume = Math.min(1, (value ?? 100) / 100)
      audio.addEventListener('ended', () => {
        if (_currentPreviewAudio === audio) _currentPreviewAudio = null
      })
      _currentPreviewAudio = audio
      audio.play().catch(() => {})
    } catch {}
  }

  return (
    <div className={`border-b border-slate-100 last:border-0 ${!enabled ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-3 py-2.5">
        <button
          onClick={onToggle}
          className={`w-10 h-5 rounded-full flex-shrink-0 transition-colors ${enabled ? 'bg-brand-500' : 'bg-slate-200'}`}
        >
          <span className={`block w-4 h-4 bg-surface rounded-full shadow mx-auto transition-transform ${enabled ? '' : ''}`} />
        </button>
        <span className="text-sm text-slate-700 flex-1">{label}</span>
        <button onClick={preview} className="text-slate-400 hover:text-brand-600 text-xs px-2" title="Preview">▶</button>
        <input
          type="range" min={0} max={100}
          value={value ?? 100}
          onChange={e => onChange(Number(e.target.value))}
          disabled={!enabled}
          className="w-24"
        />
        <span className="text-xs text-slate-400 w-8 text-right">{value ?? 100}%</span>
      </div>
      {onDurationChange && (
        <div className="flex items-center gap-3 pb-2.5 pl-14">
          <span className="text-xs text-slate-400 flex-1">Duration</span>
          <input
            type="range" min={1} max={durationMax}
            value={durationValue ?? durationDefault}
            onChange={e => onDurationChange(Number(e.target.value))}
            disabled={!enabled}
            className="w-24"
          />
          <span className="text-xs text-slate-400 w-8 text-right">{durationValue ?? durationDefault}ms</span>
        </div>
      )}
    </div>
  )
}

// ── Client-side economy calculation (pure functions) ──────────────────────
// Quiz coin math uses quizQuestionsPerSession (5) — the number actually shown to the
// user per quiz — not aiQuestionsPerDifficulty (7), which is the AI generation pool size.
// Login/streak assumes a player logs in every day for the number of days it
// takes to read all briefs at their daily reading pace.
function calcEconomyScenario(sim, difficulty) {
  const rates    = sim.rates ?? {}
  const isNormal = difficulty === 'normal'
  const n        = sim.totalBriefs ?? 0
  const qpd      = sim.quizQuestionsPerSession ?? 5
  const wtaRate  = (rates.airstarsWhereAircraftRound1 ?? 5)
                 + (rates.airstarsWhereAircraftRound2 ?? 10)
                 + (rates.airstarsWhereAircraftBonus  ?? 5)
  const reads = n * (rates.airstarsPerBriefRead ?? 5)
  // questions per brief × airstarsPerWin; every brief earns the 100% bonus (perfect-play sim)
  const quiz  = isNormal
    ? n * qpd * (rates.airstarsPerWinEasy   ?? 10) + n * (rates.airstars100Percent ?? 15)
    : n * qpd * (rates.airstarsPerWinMedium ?? 20) + n * (rates.airstars100Percent ?? 15)
  const boo   = (sim.booEligibleBriefs ?? 0) * (isNormal
    ? (rates.airstarsOrderOfBattleEasy   ?? 8)
    : (rates.airstarsOrderOfBattleMedium ?? 18))
  const wta   = (sim.wtaBriefs ?? 0) * wtaRate
  // Login: every day = firstLogin; days 2+ also earn streakBonus
  const briefsPerDay = Math.max(1, sim.briefsPerDay ?? 1)
  const days  = n > 0 ? Math.ceil(n / briefsPerDay) : 0
  const login = days * (rates.airstarsFirstLogin ?? 5)
              + Math.max(0, days - 1) * (rates.airstarsStreakBonus ?? 2)
  return { reads, quiz, boo, wta, login, days, total: reads + quiz + boo + wta + login }
}

function calcEconomyProgression(totalCoins, cycleThreshold, totalRanks, ranks, levels) {
  const fullCycles      = totalRanks > 0 ? Math.floor(totalCoins / cycleThreshold) : 0
  const completedCycles = Math.min(fullCycles, totalRanks)
  const atMaxRank       = totalRanks > 0 && completedCycles >= totalRanks
  const cycleCoins      = atMaxRank ? totalCoins - totalRanks * cycleThreshold : totalCoins % cycleThreshold
  let finalLevel = 1, cumulative = 0
  for (const lv of (levels ?? [])) {
    if (lv.airstarsToNextLevel === null) { finalLevel = lv.levelNumber; break }
    cumulative += lv.airstarsToNextLevel
    if (cycleCoins < cumulative) { finalLevel = lv.levelNumber; break }
    finalLevel = lv.levelNumber + 1
  }
  const finalRank     = completedCycles > 0 ? (ranks ?? [])[completedCycles - 1] : null
  const coinsToMaxOut = totalRanks * cycleThreshold
  const shortfall     = Math.max(0, coinsToMaxOut - totalCoins)
  return { completedCycles, atMaxRank, cycleCoins, finalLevel, finalRank, coinsToMaxOut, shortfall }
}

function CeilingSimInput({ label, sub, field, sim, onSetField, max }) {
  const val    = sim[field] ?? 0
  const capped = max !== undefined && max > 0 && val >= max
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-0.5">{label}</label>
      {sub && <p className="text-[11px] text-slate-400 mb-1 leading-none">{sub}</p>}
      <input
        type="number" min={0}
        value={val}
        onChange={e => onSetField(field, e.target.value)}
        className={`w-full border rounded-lg px-2 py-1.5 text-sm font-mono outline-none focus:ring-2 focus:ring-brand-200 ${capped ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}
      />
      {max !== undefined && (
        <p className={`text-[11px] mt-0.5 leading-none ${capped ? 'text-amber-500 font-medium' : 'text-slate-400'}`}>
          max {max.toLocaleString()}
        </p>
      )}
    </div>
  )
}

function CeilingLevelInput({ index, value, onSetLevel }) {
  const from = index + 1
  const to   = index + 2
  return (
    <div>
      <label className="block text-[11px] font-medium text-slate-500 mb-1 text-center">L{from}→{to}</label>
      <input
        type="number" min={1}
        value={value}
        onChange={e => onSetLevel(index, e.target.value)}
        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-mono text-center outline-none focus:ring-2 focus:ring-brand-200"
      />
    </div>
  )
}

function RateInput({ label, value, onChange }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-slate-600 mb-0.5">{label}</label>
      <input
        type="number" min={0}
        value={value ?? 0}
        onChange={e => onChange(e.target.value)}
        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-mono outline-none focus:ring-2 focus:ring-brand-200"
      />
    </div>
  )
}

function CeilingScenarioColumn({ label, difficulty, sim, meta, simCycleThreshold }) {
  const fmt         = n => (n ?? 0).toLocaleString()
  const scenario    = calcEconomyScenario(sim, difficulty)
  const progression = calcEconomyProgression(scenario.total, simCycleThreshold, meta.totalRanks, meta.ranks, sim.levels)
  const maxed       = progression.atMaxRank && progression.finalLevel === 10
  return (
    <div className="flex-1 min-w-0">
      <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">{label}</p>
      <table className="w-full text-sm mb-3">
        <tbody>
          <tr className="border-b border-slate-100">
            <td className="py-1 text-slate-500 pr-3">Brief reads</td>
            <td className="py-1 text-right font-mono font-medium text-slate-700">{fmt(scenario.reads)}</td>
          </tr>
          <tr className="border-b border-slate-100">
            <td className="py-1 text-slate-500 pr-3">Quiz</td>
            <td className="py-1 text-right font-mono font-medium text-slate-700">{fmt(scenario.quiz)}</td>
          </tr>
          <tr className="border-b border-slate-100">
            <td className="py-1 text-slate-500 pr-3">Battle of Order</td>
            <td className="py-1 text-right font-mono font-medium text-slate-700">{fmt(scenario.boo)}</td>
          </tr>
          <tr className="border-b border-slate-100">
            <td className="py-1 text-slate-500 pr-3">Where's That Aircraft</td>
            <td className="py-1 text-right font-mono font-medium text-slate-700">{fmt(scenario.wta)}</td>
          </tr>
          <tr className="border-b border-slate-100">
            <td className="py-1 text-slate-500 pr-3">Login / Streak <span className="text-slate-400 font-normal">({scenario.days}d)</span></td>
            <td className="py-1 text-right font-mono font-medium text-slate-700">{fmt(scenario.login)}</td>
          </tr>
          <tr>
            <td className="pt-2 font-bold text-slate-700 pr-3">Total</td>
            <td className="pt-2 text-right font-mono font-bold text-slate-900">{fmt(scenario.total)}</td>
          </tr>
        </tbody>
      </table>
      <div className={`rounded-xl px-3 py-2 text-sm ${maxed ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200'}`}>
        <p className={`font-bold ${maxed ? 'text-green-700' : 'text-amber-700'}`}>
          {progression.finalRank ? progression.finalRank.rankName : 'No rank'} — Level {progression.finalLevel}
        </p>
        <p className="text-xs mt-0.5 text-slate-500">
          {progression.completedCycles} of {meta.totalRanks} rank{meta.totalRanks !== 1 ? 's' : ''} earned
        </p>
        {!maxed && <p className="text-xs mt-0.5 text-amber-600">{fmt(progression.shortfall)} coins short of max rank</p>}
        {maxed  && <p className="text-xs mt-0.5 text-green-600">Max rank + Level 10 reachable</p>}
      </div>
    </div>
  )
}

function AirstarsEconomy({ API, onToast }) {
  const { apiFetch, awardAirstars } = useAuth()
  const { applyUnlocks: applyCategoryUnlocks } = useNewCategoryUnlock()
  const [meta,            setMeta]           = useState(null)  // { cycleThreshold, totalRanks, ranks }
  const [sim,             setSim]            = useState(null)  // full editable sim state
  const [dbSim,           setDbSim]          = useState(null)  // DB snapshot for reset
  const [busy,       setBusy]       = useState(false)
  const [error,      setError]      = useState('')
  const [applyModal, setApplyModal] = useState(false)
  // Award test airstars
  const [testAmount, setTestAmount] = useState('')
  const [coinModal,  setCoinModal]  = useState(false)
  const [coinBusy,   setCoinBusy]   = useState(false)

  useEffect(() => { runSim() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const runSim = async () => {
    setBusy(true); setError('')
    try {
      const res  = await apiFetch(`${API}/api/admin/economy-viability`, { credentials: 'include' })
      const data = await res.json()
      if (data.status === 'success') {
        const { rates, cycleThreshold, totalRanks, ranks, levels, content, aiQuestionsPerDifficulty, quizQuestionsPerSession } = data.data
        setMeta({ cycleThreshold, totalRanks, ranks })
        const snapshot = {
          totalBriefs:              content.totalBriefs,
          wtaBriefs:                content.wtaBriefs,
          booEligibleBriefs:        content.booEligibleBriefs,
          briefsPerDay:             1,
          rates,
          aiQuestionsPerDifficulty: aiQuestionsPerDifficulty ?? 7,
          quizQuestionsPerSession:  quizQuestionsPerSession  ?? 5,
          levels:                   levels.filter(l => l.airstarsToNextLevel !== null),
        }
        // Preserve briefsPerDay across refreshes
        setSim(prev => prev ? { ...snapshot, briefsPerDay: prev.briefsPerDay } : snapshot)
        setDbSim(snapshot)
      } else {
        setError(data.message ?? 'Simulation failed')
      }
    } catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }

  const setRate = (key, raw) => {
    const val = parseInt(raw, 10)
    setSim(p => ({ ...p, rates: { ...p.rates, [key]: isNaN(val) ? 0 : Math.max(0, val) } }))
  }

  const setLevel = (index, raw) => {
    const val = parseInt(raw, 10)
    setSim(p => {
      const levels = [...p.levels]
      levels[index] = { ...levels[index], airstarsToNextLevel: isNaN(val) ? 1 : Math.max(1, val) }
      return { ...p, levels }
    })
  }

  const applyEconomy = async (reason) => {
    setBusy(true); setError('')
    try {
      const res  = await apiFetch(`${API}/api/admin/economy/apply`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rates: sim.rates, levels: sim.levels, reason }),
      })
      const data = await res.json()
      if (data.status === 'success') {
        setDbSim(sim)
        onToast('✓ Economy settings updated live')
      } else { setError(data.message ?? 'Apply failed') }
    } catch (e) { setError(e.message) }
    finally { setBusy(false); setApplyModal(false) }
  }

  const awardTest = async (reason) => {
    const amt = parseInt(testAmount, 10)
    if (!amt || amt <= 0) return
    setCoinModal(false); setCoinBusy(true)
    try {
      const res  = await apiFetch(`${API}/api/admin/award-coins`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt, reason }),
      })
      const data = await res.json()
      if (data.status === 'success') {
        awardAirstars(data.awarded, 'Test Airstars', { cycleAfter: data.cycleAirstars, totalAfter: data.totalAirstars, rankPromotion: data.rankPromotion ?? null, unlockedCategories: data.unlockedCategories ?? [] })
        if (data.categoryUnlocksGranted?.length) applyCategoryUnlocks(data.categoryUnlocksGranted)
        onToast(`✓ Awarded ${data.awarded} test airstars`)
        setTestAmount('')
      }
    } finally { setCoinBusy(false) }
  }

  const simCycleThreshold = sim ? sim.levels.reduce((acc, l) => acc + (l.airstarsToNextLevel ?? 0), 0) : 0
  const fmt        = n => (n ?? 0).toLocaleString()
  const derivedDays = sim
    ? (sim.totalBriefs > 0 ? Math.ceil(sim.totalBriefs / Math.max(1, sim.briefsPerDay ?? 1)) : 0)
    : 0

  return (
    <Section title="Airstars Economy Settings" collapsible>
      {applyModal && (
        <ConfirmModal
          title="Update Live Economy Values"
          body="This will update all airstar award rates AND level thresholds live. Every user's earning rates and progression requirements will change immediately."
          confirmLabel="Update Live Economy"
          onConfirm={applyEconomy}
          onCancel={() => setApplyModal(false)}
        />
      )}
      {coinModal && (
        <ConfirmModal
          title={`Award ${testAmount} Test Airstars`}
          body="Awards airstars directly to your admin account. Use for testing reward flows."
          confirmLabel="Award Airstars"
          onConfirm={awardTest}
          onCancel={() => setCoinModal(false)}
        />
      )}

      <p className="text-xs text-slate-400 mb-3">
        Design the airstar economy — set award rates and level thresholds, run a simulation to verify viability, then push live.
        Simulation assumes perfect play (100% scores, all questions answered, all games completed).
      </p>

      {/* Award Test Airstars */}
      <Section title="Award Test Airstars" collapsible>
        <p className="text-xs text-slate-400 mb-3">Awards airstars to your admin account, logged as "Test Airstars".</p>
        <div className="flex items-center gap-3">
          <input
            type="number" min={1} placeholder="Amount…"
            value={testAmount}
            onChange={e => setTestAmount(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && parseInt(testAmount, 10) > 0 && setCoinModal(true)}
            className="w-32 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-200"
          />
          <button
            onClick={() => setCoinModal(true)}
            disabled={coinBusy || !testAmount || parseInt(testAmount, 10) <= 0}
            className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-40"
          >
            {coinBusy ? 'Awarding…' : '⬡ Award'}
          </button>
        </div>
      </Section>

      {/* Simulation controls */}
      {sim && (
        <div className="flex items-center gap-3 mt-2 mb-4">
          <button
            onClick={runSim}
            disabled={busy}
            className="px-4 py-2 text-sm font-bold text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-40"
          >
            {busy ? 'Loading…' : 'Reset'}
          </button>
        </div>
      )}
      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
      {!sim && !error && <p className="text-sm text-slate-400 animate-pulse mb-4">Loading economy data…</p>}

      {sim && meta && (
        <>
          {/* Simulation inputs */}
          <div className="bg-slate-50 rounded-xl p-4 mb-5 border border-slate-200 space-y-5">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Simulation Inputs</p>

            {/* Content — read-only */}
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2">Content (from DB — read only)</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-white border border-slate-200 rounded-lg px-3 py-2">
                  <p className="text-[11px] text-slate-400 mb-0.5">Total briefs</p>
                  <p className="text-sm font-mono font-semibold text-slate-700">{fmt(sim.totalBriefs)}</p>
                  <p className="text-[11px] text-slate-400">5 easy + 5 medium q's each</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-lg px-3 py-2">
                  <p className="text-[11px] text-slate-400 mb-0.5">WTA-enabled</p>
                  <p className="text-sm font-mono font-semibold text-slate-700">{fmt(sim.wtaBriefs)}</p>
                  <p className="text-[11px] text-slate-400">aircraft category briefs</p>
                </div>
                <div className="bg-white border border-slate-200 rounded-lg px-3 py-2">
                  <p className="text-[11px] text-slate-400 mb-0.5">BOO-eligible</p>
                  <p className="text-sm font-mono font-semibold text-slate-700">{fmt(sim.booEligibleBriefs)}</p>
                  <p className="text-[11px] text-slate-400">BOO category briefs</p>
                </div>
              </div>
            </div>

            {/* Reading pace */}
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2">Reading Pace</p>
              <div className="flex items-center gap-6">
                <div className="w-44">
                  <label className="block text-xs font-medium text-slate-600 mb-0.5">Briefs read per day</label>
                  <input
                    type="number" min={1}
                    value={sim.briefsPerDay ?? 1}
                    onChange={e => {
                      const v = parseInt(e.target.value, 10)
                      setSim(p => ({ ...p, briefsPerDay: isNaN(v) ? 1 : Math.max(1, v) }))
                    }}
                    className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-mono outline-none focus:ring-2 focus:ring-brand-200"
                  />
                </div>
                <div className="pt-4">
                  <p className="text-[11px] text-slate-400 leading-none mb-1">Days to read all briefs</p>
                  <p className="text-xl font-mono font-bold text-slate-700">{derivedDays.toLocaleString()}</p>
                </div>
              </div>
            </div>

            {/* Award rates */}
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2">Award Rates</p>
              <div className="space-y-3">
                <div>
                  <p className="text-[11px] text-slate-400 mb-1.5">Brief Read &amp; Login</p>
                  <div className="grid grid-cols-3 gap-2">
                    <RateInput label="Per brief read"    value={sim.rates.airstarsPerBriefRead}   onChange={v => setRate('airstarsPerBriefRead', v)} />
                    <RateInput label="First daily login" value={sim.rates.airstarsFirstLogin}      onChange={v => setRate('airstarsFirstLogin', v)} />
                    <RateInput label="Streak bonus"      value={sim.rates.airstarsStreakBonus}     onChange={v => setRate('airstarsStreakBonus', v)} />
                  </div>
                </div>
                <div>
                  <p className="text-[11px] text-slate-400 mb-1.5">Quiz</p>
                  <div className="grid grid-cols-3 gap-2">
                    <RateInput label="Easy — per answer"   value={sim.rates.airstarsPerWinEasy}    onChange={v => setRate('airstarsPerWinEasy', v)} />
                    <RateInput label="Medium — per answer" value={sim.rates.airstarsPerWinMedium}  onChange={v => setRate('airstarsPerWinMedium', v)} />
                    <RateInput label="100% score bonus"    value={sim.rates.airstars100Percent}    onChange={v => setRate('airstars100Percent', v)} />
                  </div>
                </div>
                <div>
                  <p className="text-[11px] text-slate-400 mb-1.5">Battle of Order</p>
                  <div className="grid grid-cols-2 gap-2">
                    <RateInput label="Easy win"   value={sim.rates.airstarsOrderOfBattleEasy}   onChange={v => setRate('airstarsOrderOfBattleEasy', v)} />
                    <RateInput label="Medium win" value={sim.rates.airstarsOrderOfBattleMedium} onChange={v => setRate('airstarsOrderOfBattleMedium', v)} />
                  </div>
                </div>
                <div>
                  <p className="text-[11px] text-slate-400 mb-1.5">Where's That Aircraft</p>
                  <div className="grid grid-cols-3 gap-2">
                    <RateInput label="Round 1 correct"    value={sim.rates.airstarsWhereAircraftRound1} onChange={v => setRate('airstarsWhereAircraftRound1', v)} />
                    <RateInput label="Round 2 correct"    value={sim.rates.airstarsWhereAircraftRound2} onChange={v => setRate('airstarsWhereAircraftRound2', v)} />
                    <RateInput label="Full mission bonus" value={sim.rates.airstarsWhereAircraftBonus}  onChange={v => setRate('airstarsWhereAircraftBonus', v)} />
                  </div>
                </div>
                <div>
                  <p className="text-[11px] text-slate-400 mb-1.5">Flashcards</p>
                  <div className="grid grid-cols-2 gap-2">
                    <RateInput label="Per correct card" value={sim.rates.airstarsFlashcardPerCard}      onChange={v => setRate('airstarsFlashcardPerCard', v)} />
                    <RateInput label="100% bonus"       value={sim.rates.airstarsFlashcardPerfectBonus} onChange={v => setRate('airstarsFlashcardPerfectBonus', v)} />
                  </div>
                </div>
              </div>
            </div>

            {/* Level thresholds */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Level Thresholds</p>
                <p className="text-[11px] text-slate-400">
                  Cycle: <span className="font-mono font-semibold text-slate-600">{fmt(simCycleThreshold)}</span> coins per rank
                </p>
              </div>
              <div className="grid grid-cols-5 gap-2">
                {sim.levels.map((lv, i) => (
                  <CeilingLevelInput key={lv.levelNumber} index={i} value={lv.airstarsToNextLevel} onSetLevel={setLevel} />
                ))}
              </div>
            </div>
          </div>

          {/* Simulation results */}
          <div className="text-xs text-slate-400 mb-4">
            {meta.totalRanks} total ranks &nbsp;·&nbsp;
            WTA: {fmt((sim.rates.airstarsWhereAircraftRound1 ?? 5) + (sim.rates.airstarsWhereAircraftRound2 ?? 10) + (sim.rates.airstarsWhereAircraftBonus ?? 5))} coins/brief
          </div>
          <div className="flex gap-6 mb-5">
            <CeilingScenarioColumn label="Normal (Easy)"     difficulty="normal"   sim={sim} meta={meta} simCycleThreshold={simCycleThreshold} />
            <div className="w-px bg-slate-200" />
            <CeilingScenarioColumn label="Advanced (Medium)" difficulty="advanced" sim={sim} meta={meta} simCycleThreshold={simCycleThreshold} />
          </div>

          {/* Update live */}
          <div className="pt-3 border-t border-slate-200">
            <button
              onClick={() => setApplyModal(true)}
              disabled={busy}
              className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-40"
            >
              Update Live Economy Values
            </button>
            <p className="text-[11px] text-slate-400 mt-1.5">
              Writes all award rates and level thresholds to the live DB immediately.
            </p>
          </div>
        </>
      )}
    </Section>
  )
}

function Section({ title, children, onSave, saving, collapsible = false }) {
  const [open, setOpen] = useState(!collapsible)
  return (
    <div className="bg-surface rounded-2xl border border-slate-300 overflow-hidden mb-4">
      {collapsible ? (
        <button
          onClick={() => setOpen(o => !o)}
          className="w-full px-5 py-4 border-b border-slate-100 flex items-center justify-between text-left"
        >
          <h3 className="font-bold text-slate-800">{title}</h3>
          <span className="text-slate-400 text-xs ml-2">{open ? '▲' : '▼'}</span>
        </button>
      ) : (
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="font-bold text-slate-800">{title}</h3>
        </div>
      )}
      {open && (
        <>
          <div className="px-5 py-3">{children}</div>
          {onSave && (
            <div className="px-5 pb-4">
              <button
                onClick={onSave}
                disabled={saving}
                className="mt-1 px-5 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function CollapsibleBox({ title, headerContent, headerStyle, bodyStyle, children }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-2xl overflow-hidden mb-4 border-2" style={bodyStyle}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-5 py-4 border-b flex items-center justify-between text-left"
        style={headerStyle}
      >
        <div className="flex items-center gap-2">{headerContent ?? <h3 className="font-bold text-slate-800">{title}</h3>}</div>
        <span className="text-xs ml-2" style={{ color: headerStyle?.color ?? '#94a3b8' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && children}
    </div>
  )
}

function CategoryGrid({ selected, onChange }) {
  return (
    <div className="flex flex-wrap gap-2 pt-2">
      {ALL_CATEGORIES.map(cat => {
        const on = selected?.includes(cat)
        return (
          <button
            key={cat}
            onClick={() => onChange(cat)}
            className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors
              ${on
                ? 'bg-brand-600 text-white border-brand-600'
                : 'bg-surface-raised text-slate-600 border-slate-400 hover:border-brand-500'
              }`}
          >
            {cat}
          </button>
        )
      })}
    </div>
  )
}

function PctSlider({ label, value, onChange }) {
  const steps = [0, 20, 40, 60, 80, 100]
  return (
    <div className="py-3 border-b border-slate-100 last:border-0">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-sm font-semibold text-slate-700">{label}</p>
        <span className="text-sm font-bold text-brand-600">{value ?? 60}%</span>
      </div>
      <input
        type="range" min={0} max={100} step={20}
        value={value ?? 60}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full"
      />
      <div className="flex justify-between mt-0.5">
        {steps.map(v => (
          <span key={v} className={`text-[10px] ${(value ?? 60) === v ? 'text-brand-600 font-bold' : 'text-slate-300'}`}>{v}%</span>
        ))}
      </div>
    </div>
  )
}

// ── AI Prompt Groups definition ───────────────────────────────────────────────
const AI_PROMPT_GROUPS = [
  {
    group: 'Content Generation',
    items: [
      { key: 'brief.news',            label: 'Generate Brief — News' },
      { key: 'brief.topic',           label: 'Generate Brief — Topic' },
      { key: 'regenerateBrief', label: 'Regenerate Brief' },
      { key: 'keywords',              label: 'Extract Keywords' },
    ],
  },
  {
    group: 'Quiz Generation',
    items: [
      { key: 'quiz',        label: 'Generate Quiz' },
      { key: 'quizMissing', label: 'Generate Missing Questions' },
    ],
  },
  {
    group: 'Linking — Current',
    accordion: true,
    items: [
      { key: 'links.Aircrafts:bases',     label: 'Aircraft → Bases' },
      { key: 'links.Aircrafts:squadrons', label: 'Aircraft → Squadrons' },
      { key: 'links.Aircrafts:missions',  label: 'Aircraft → Missions' },
      { key: 'links.Squadrons:bases',     label: 'Squadrons → Bases' },
      { key: 'links.Squadrons:aircraft',  label: 'Squadrons → Aircraft' },
      { key: 'links.Squadrons:missions',  label: 'Squadrons → Missions' },
      { key: 'links.Bases:squadrons',     label: 'Bases → Squadrons' },
      { key: 'links.Bases:aircraft',      label: 'Bases → Aircraft' },
      { key: 'links.Roles:training',      label: 'Roles → Training' },
      { key: 'links.Tech:aircraft',       label: 'Tech → Aircraft' },
    ],
  },
  {
    group: 'Linking — Historic',
    accordion: true,
    items: [
      { key: 'links.historic.Aircrafts:bases',     label: 'Aircraft → Bases (historic)' },
      { key: 'links.historic.Aircrafts:squadrons', label: 'Aircraft → Squadrons (historic)' },
      { key: 'links.historic.Aircrafts:missions',  label: 'Aircraft → Missions (historic)' },
      { key: 'links.historic.Squadrons:bases',     label: 'Squadrons → Bases (historic)' },
      { key: 'links.historic.Squadrons:aircraft',  label: 'Squadrons → Aircraft (historic)' },
      { key: 'links.historic.Squadrons:missions',  label: 'Squadrons → Missions (historic)' },
      { key: 'links.historic.Bases:squadrons',     label: 'Bases → Squadrons (historic)' },
      { key: 'links.historic.Bases:aircraft',      label: 'Bases → Aircraft (historic)' },
    ],
  },
  {
    group: 'Bases',
    items: [
      { key: 'bases.current', label: 'Generate Bases — Current' },
      { key: 'bases.historic', label: 'Generate Bases — Historic' },
    ],
  },
  {
    group: 'Utility',
    items: [
      { key: 'newsHeadlines',   label: 'News Headlines' },
      { key: 'battleOrderData', label: 'Battle Order Data' },
      { key: 'imageExtraction', label: 'Image Subject Extraction' },
    ],
  },
  {
    group: 'Mnemonics',
    items: [
      { key: 'mnemonic.single', label: 'Generate Mnemonic — Single Stat' },
      { key: 'mnemonic.batch',  label: 'Generate Mnemonics — All Stats (batch)' },
    ],
  },
]

function AiPromptsSection({ API }) {
  const { apiFetch } = useAuth()
  const [open,      setOpen]      = useState(false)
  const [prompts,   setPrompts]   = useState(null)   // { key: currentValue }
  const [defaults,  setDefaults]  = useState(null)   // { key: hardcodedDefault }
  const [draft,     setDraft]     = useState({})
  const [openGroup, setOpenGroup] = useState(null)
  const [saving,    setSaving]    = useState(false)
  const [toast,     setToast]     = useState('')
  const [dirty,     setDirty]     = useState({})     // keys that have unsaved changes
  const [keywordsOriginal, setKeywordsOriginal] = useState(null)
  const [keywordsDraft,    setKeywordsDraft]    = useState(null)
  const [modal,            setModal]            = useState(null)

  useEffect(() => {
    apiFetch(`${API}/api/admin/ai-prompts`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (d.data) {
          setPrompts(d.data.prompts)
          setDefaults(d.data.defaults)
          setDraft(d.data.prompts)
        }
      })
    apiFetch(`${API}/api/admin/settings`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        const k = d.data?.settings?.aiKeywordsPerBrief
        if (typeof k === 'number') {
          setKeywordsOriginal(k)
          setKeywordsDraft(k)
        }
      })
  }, [API])

  const onChange = (key, value) => {
    setDraft(p => ({ ...p, [key]: value }))
    setDirty(p => ({ ...p, [key]: true }))
  }

  const restoreDefault = (key) => {
    const def = defaults?.[key] ?? ''
    setDraft(p => ({ ...p, [key]: def }))
    setDirty(p => ({ ...p, [key]: true }))
  }

  const keywordsDirty = keywordsOriginal !== null && keywordsDraft !== keywordsOriginal
  const promptsDirty  = Object.values(dirty).some(Boolean)

  const doSave = async (reason) => {
    setSaving(true)
    try {
      const tasks = []
      if (promptsDirty) {
        tasks.push(apiFetch(`${API}/api/admin/ai-prompts`, {
          method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompts: draft }),
        }))
      }
      if (keywordsDirty) {
        tasks.push(apiFetch(`${API}/api/admin/settings`, {
          method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ aiKeywordsPerBrief: keywordsDraft, reason: reason || 'AI target update' }),
        }))
      }
      await Promise.all(tasks)
      if (promptsDirty) { setPrompts({ ...draft }); setDirty({}) }
      if (keywordsDirty) setKeywordsOriginal(keywordsDraft)
      setToast('✓ AI settings saved')
    } catch (e) {
      setToast('Error saving')
    } finally {
      setSaving(false)
      setModal(null)
    }
  }

  const saveAll = () => {
    if (keywordsDirty) setModal({ label: 'Update AI settings' })
    else doSave(null)
  }

  const dirtyCount = Object.values(dirty).filter(Boolean).length + (keywordsDirty ? 1 : 0)

  if (!prompts) return null

  return (
    <div className="rounded-2xl overflow-hidden mb-4 border-2" style={{ background: '#160808', borderColor: '#5a1a1a' }}>
      <AnimatePresence>{toast && <Toast msg={toast} onClear={() => setToast('')} />}</AnimatePresence>
      {modal && <ConfirmModal title={modal.label} onConfirm={doSave} onCancel={() => setModal(null)} />}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-5 py-4 border-b flex items-center justify-between text-left"
        style={{ borderColor: '#5a1a1a', background: '#200c0c' }}
      >
        <div className="flex items-center gap-2">
          <span style={{ color: '#f87171', fontSize: 16 }}>⚠</span>
          <div>
            <h3 className="font-bold" style={{ color: '#fca5a5' }}>AI Prompts</h3>
            <p className="text-xs mt-0.5" style={{ color: '#f87171', opacity: 0.75 }}>Leave a field blank or click Restore to use the hardcoded default</p>
          </div>
          <span className="ml-1 text-xs font-semibold px-2 py-0.5 rounded-full self-start mt-0.5" style={{ background: '#3d1010', color: '#fca5a5' }}>Critical</span>
        </div>
        <div className="flex items-center gap-3">
          {dirtyCount > 0 && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: '#2d2000', color: '#fbbf24', border: '1px solid #7a4a00' }}>
              {dirtyCount} unsaved
            </span>
          )}
          {open && (
            <button
              onClick={e => { e.stopPropagation(); saveAll() }}
              disabled={saving || dirtyCount === 0}
              className="px-5 py-2 text-white text-sm font-bold rounded-xl transition-opacity disabled:opacity-40"
              style={{ background: '#991b1b' }}
            >
              {saving ? 'Saving…' : 'Save All'}
            </button>
          )}
          <span className="text-xs" style={{ color: '#f87171', opacity: 0.6 }}>{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && <div className="px-5 py-4 space-y-6">
        {keywordsDraft !== null && (
          <div className="flex items-center justify-between pb-4 border-b" style={{ borderColor: '#3d1010' }}>
            <div className="pr-3">
              <p className="text-sm font-bold" style={{ color: '#fca5a5' }}>
                Keywords per brief
                {keywordsDirty && <span className="ml-2 font-bold" style={{ color: '#fbbf24' }}>●</span>}
              </p>
              <p className="text-xs mt-0.5" style={{ color: '#f87171', opacity: 0.75 }}>
                Target for AI keyword generation and the K-badge completion threshold (pipeline ceiling is 30)
              </p>
            </div>
            <input
              type="number"
              min={1} max={30}
              value={keywordsDraft ?? ''}
              onChange={e => setKeywordsDraft(Number(e.target.value))}
              className="w-20 rounded-xl px-3 py-1.5 text-sm text-right outline-none"
              style={{ border: '1px solid #3d1010', background: '#0f0505', color: '#ddeaf8' }}
            />
          </div>
        )}
        {AI_PROMPT_GROUPS.map(({ group, items, accordion }) => {
          const isOpen = openGroup === group
          return (
            <div key={group}>
              {accordion ? (
                <button
                  onClick={() => setOpenGroup(isOpen ? null : group)}
                  className="w-full flex items-center justify-between py-2 text-left border-b"
                  style={{ borderColor: '#3d1010' }}
                >
                  <span className="text-sm font-bold" style={{ color: '#fca5a5' }}>{group}</span>
                  <span className="text-xs" style={{ color: '#f87171', opacity: 0.6 }}>{isOpen ? '▲ collapse' : `${items.length} prompts ▼`}</span>
                </button>
              ) : (
                <p className="text-sm font-bold border-b pb-2" style={{ color: '#fca5a5', borderColor: '#3d1010' }}>{group}</p>
              )}
              {(!accordion || isOpen) && (
                <div className="mt-3 space-y-4">
                  {items.map(({ key, label }) => {
                    const isDirty = dirty[key]
                    const isDefault = draft[key] === defaults?.[key]
                    return (
                      <div key={key}>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs font-semibold" style={{ color: '#f87171' }}>
                            {label}
                            {isDirty && <span className="ml-2 font-bold" style={{ color: '#fbbf24' }}>●</span>}
                          </label>
                          {!isDefault && (
                            <button
                              onClick={() => restoreDefault(key)}
                              className="text-[11px] transition-colors"
                              style={{ color: '#f87171', opacity: 0.65 }}
                            >
                              Restore default
                            </button>
                          )}
                        </div>
                        <textarea
                          value={draft[key] ?? ''}
                          onChange={e => onChange(key, e.target.value)}
                          rows={4}
                          className="w-full rounded-lg px-3 py-2 text-xs font-mono outline-none resize-y"
                          style={{ border: '1px solid #3d1010', background: '#0f0505', color: '#ddeaf8' }}
                        />
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>}
    </div>
  )
}

function SettingsTab({ API }) {
  const { apiFetch } = useAuth()
  const { refreshSettings } = useAppSettings()
  const [settings, setSettings] = useState(null)
  const [draft,    setDraft]    = useState({})
  const [modal,    setModal]    = useState(null)   // { label, fields }
  const [toast,    setToast]    = useState('')
  const [wtaSpawn,   setWtaSpawn]   = useState(null)
  const [cbatAircraft, setCbatAircraft] = useState(null)   // aircraft with a 3D model available
  const [gameGroupsOpen, setGameGroupsOpen] = useState({ quiz: false, wta: false, aptitudeSync: false, cbat: false, caseFiles: false, flashcards: false })
  const toggleGameGroup = (key) => setGameGroupsOpen(p => ({ ...p, [key]: !p[key] }))

  const [caseFilesList, setCaseFilesList] = useState(null) // null = loading, [] = empty, [...] = loaded
  const [caseFilesDraft, setCaseFilesDraft] = useState({}) // { [slug]: ['free','silver',...] }

  useEffect(() => {
    let cancelled = false
    fetch(`${API}/api/case-files`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(list => {
        if (cancelled) return
        const arr = Array.isArray(list) ? list : []
        setCaseFilesList(arr)
        setCaseFilesDraft(Object.fromEntries(arr.map(c => [c.slug, Array.isArray(c.tiers) ? [...c.tiers] : []])))
      })
      .catch(() => { if (!cancelled) setCaseFilesList([]) })
    return () => { cancelled = true }
  }, [API])

  function toggleCaseTier(slug, tier) {
    setCaseFilesDraft(prev => {
      const current = prev[slug] ?? []
      const next = current.includes(tier)
        ? current.filter(t => t !== tier)
        : [...current, tier]
      return { ...prev, [slug]: next }
    })
  }

  const load = useCallback(() => {
    apiFetch(`${API}/api/admin/settings`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { const s = d.data?.settings; if (s) { setSettings(s); setDraft(s) } })
    apiFetch(`${API}/api/users/me/wta-spawn`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d.data) setWtaSpawn(d.data) })
    apiFetch(`${API}/api/games/cbat/aircraft-cutouts`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        const list = (d.data || []).filter(a => has3DModel(a.briefId, a.title))
        setCbatAircraft(list)
      })
      .catch(() => setCbatAircraft([]))
  }, [API])

  useEffect(() => { load() }, [load])

  const save = (label, fields) => {
    setModal({ label, fields })
  }

  const confirmSave = async (reason) => {
    const updates = {}
    modal.fields.forEach(f => { updates[f] = draft[f] })
    await apiFetch(`${API}/api/admin/settings`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...updates, reason }),
    })
    setModal(null)
    invalidateSoundSettings()
    refreshSettings()
    setToast(`✓ ${modal.label} saved`)
    load()
  }

  const set = (key, val) => setDraft(p => ({ ...p, [key]: val }))
  const setPathwayUnlock = (category, field, value) => setDraft(p => {
    const current = p.pathwayUnlocks ?? []
    const exists  = current.some(u => u.category === category)
    const updated = exists
      ? current.map(u => u.category === category ? { ...u, [field]: value } : u)
      : [...current, { category, levelRequired: 1, rankRequired: 1, [field]: value }]
    return { ...p, pathwayUnlocks: updated }
  })
  const toggleCat = (key, cat) => setDraft(p => {
    const cats = p[key] ?? []
    return { ...p, [key]: cats.includes(cat) ? cats.filter(c => c !== cat) : [...cats, cat] }
  })

  const reorderPathways = (fromIndex, toIndex) => {
    if (fromIndex === toIndex) return
    setDraft(p => {
      const arr = [...(p.pathwayUnlocks ?? [])]
      arr.splice(toIndex, 0, arr.splice(fromIndex, 1)[0])
      return { ...p, pathwayUnlocks: arr }
    })
  }

  // Derive subscription tier for a category from the three tier arrays
  const getCatTier = (cat) => {
    if ((draft.guestCategories ?? []).includes(cat)) return 'guest'
    if ((draft.freeCategories  ?? []).includes(cat)) return 'free'
    if ((draft.silverCategories ?? []).includes(cat)) return 'silver'
    return 'gold'
  }

  // Set subscription tier for a category by updating the three tier arrays.
  // Arrays are inclusive: a category appears in every tier array that can access it.
  // guest  → guestCategories + freeCategories + silverCategories
  // free   → freeCategories + silverCategories
  // silver → silverCategories
  // gold   → none
  const setCatTier = (cat, tier) => setDraft(p => {
    const add    = arr => [...(arr ?? []).filter(c => c !== cat), cat]
    const remove = arr => (arr ?? []).filter(c => c !== cat)
    const inGuest  = tier === 'guest'
    const inFree   = tier === 'guest' || tier === 'free'
    const inSilver = tier === 'guest' || tier === 'free' || tier === 'silver'
    return {
      ...p,
      guestCategories:  inGuest  ? add(p.guestCategories)  : remove(p.guestCategories),
      freeCategories:   inFree   ? add(p.freeCategories)   : remove(p.freeCategories),
      silverCategories: inSilver ? add(p.silverCategories) : remove(p.silverCategories),
    }
  })

  if (!settings) return <div className="py-8 text-center text-slate-400 text-sm animate-pulse">Loading settings…</div>

  return (
    <div>
      <AnimatePresence>{toast && <Toast msg={toast} onClear={() => setToast('')} />}</AnimatePresence>

      {modal && (
        <ConfirmModal
          title={modal.label}
          confirmLabel="Save Changes"
          onConfirm={confirmSave}
          onCancel={() => setModal(null)}
        />
      )}

      {/* ── Pathway Access & Unlock Requirements ─────────────── */}
      <Section title="Pathway Access & Unlock Requirements" collapsible onSave={() => save('Update Pathway Access & Unlock Requirements', ['trialDurationDays', 'guestCategories', 'freeCategories', 'silverCategories', 'pathwayUnlocks'])}>
        <NumInput label="Trial duration (days)" value={draft.trialDurationDays} min={1} max={365} onChange={v => set('trialDurationDays', v)} />

        <p className="text-xs text-slate-400 mt-4 mb-3">
          Each row controls all access conditions for a pathway. A pathway is visible when the user's subscription tier, agent level, and RAF rank all meet the requirements.
          Gold tier users always have access to all categories. Set Level 1 / Rank 1 to impose no level/rank gate.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="py-2 pr-2 w-6"></th>
                <th className="text-left py-2 pr-3 text-xs font-bold text-slate-400 uppercase tracking-wide">Category</th>
                <th className="text-left py-2 pr-3 text-xs font-bold text-slate-400 uppercase tracking-wide">Subscription Tier</th>
                <th className="text-left py-2 pr-3 text-xs font-bold text-slate-400 uppercase tracking-wide">Level Required</th>
                <th className="text-left py-2 text-xs font-bold text-slate-400 uppercase tracking-wide">Rank Required</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(draft.pathwayUnlocks ?? []).map((unlock, idx) => {
                const cat  = unlock.category
                const tier = getCatTier(cat)
                const showCROWarning = tier === 'free' && ((unlock.rankRequired ?? 1) !== 1 || (unlock.levelRequired ?? 1) !== 1)
                const TIER_BADGE = { guest: 'bg-slate-100 text-slate-500', free: 'bg-green-100 text-green-700', silver: 'bg-blue-100 text-blue-700', gold: 'bg-amber-100 text-amber-700' }
                return (
                  <tr
                    key={cat}
                    draggable
                    onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', idx) }}
                    onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                    onDrop={e => { e.preventDefault(); reorderPathways(parseInt(e.dataTransfer.getData('text/plain')), idx) }}
                    className="border-b border-slate-50 last:border-0 transition-opacity"
                    style={{ cursor: 'grab' }}
                  >
                    <td className="py-2.5 pr-2 text-slate-300 select-none text-base leading-none">⠿</td>
                    <td className="py-2.5 pr-3 font-semibold text-slate-700 whitespace-nowrap">{cat}</td>
                    <td className="py-2.5 pr-3">
                      <select
                        value={tier}
                        onChange={e => setCatTier(cat, e.target.value)}
                        onClick={e => e.stopPropagation()}
                        className={`border border-slate-200 rounded-lg px-2 py-1 text-sm font-semibold focus:outline-none focus:border-brand-400 ${TIER_BADGE[tier]}`}
                      >
                        <option value="guest">Guest</option>
                        <option value="free">Free</option>
                        <option value="silver">Silver</option>
                        <option value="gold">Gold</option>
                      </select>
                    </td>
                    <td className="py-2.5 pr-3">
                      <input
                        type="number" min={1} max={10}
                        value={unlock.levelRequired ?? 1}
                        onChange={e => setPathwayUnlock(cat, 'levelRequired', Math.min(10, Math.max(1, parseInt(e.target.value) || 1)))}
                        className="w-16 border border-slate-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:border-brand-400"
                      />
                      <span className="ml-1.5 text-xs text-slate-400">/ 10</span>
                    </td>
                    <td className="py-2.5">
                      <select
                        value={unlock.rankRequired ?? 1}
                        onChange={e => setPathwayUnlock(cat, 'rankRequired', parseInt(e.target.value))}
                        onClick={e => e.stopPropagation()}
                        className="border border-slate-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-brand-400 max-w-[160px]"
                      >
                        {RAF_RANKS.map(r => (
                          <option key={r.n} value={r.n}>{r.n}. {r.abbr} — {r.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2.5 pl-3">
                      {showCROWarning && (
                        <span className="inline-flex items-start gap-1.5 text-xs text-amber-400 bg-amber-950/40 border border-amber-800 rounded-lg px-2.5 py-1.5 leading-snug max-w-[240px]">
                          <span className="shrink-0 mt-px">⚠</span>
                          It is advised that free categories stay rank 1 level 1 to avoid user facing CRO issues.
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── Airstars ─────────────────────────────────────────── */}
      {/* ── Airstars Economy ─────────────────────────────────── */}
      <AirstarsEconomy API={API} onToast={setToast} />

      {/* ── Game Options ────────────────────────────────────── */}
      <Section title="Game Options" collapsible onSave={async () => {
        // PATCH dirty per-case tier rows first
        if (Array.isArray(caseFilesList)) {
          const dirtyRows = caseFilesList.filter(cf => {
            const saved = new Set(Array.isArray(cf.tiers) ? cf.tiers : [])
            const draft = new Set(caseFilesDraft[cf.slug] ?? [])
            if (saved.size !== draft.size) return true
            for (const t of draft) if (!saved.has(t)) return true
            return false
          })
          await Promise.all(dirtyRows.map(cf =>
            fetch(`${API}/api/admin/case-files/${cf.slug}`, {
              method: 'PATCH',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tiers: caseFilesDraft[cf.slug] ?? [], reason: 'Update Case Files tier access' }),
            })
          ))
          if (dirtyRows.length > 0) {
            // Reflect saved tiers back into caseFilesList so subsequent dirty checks are accurate
            setCaseFilesList(prev => prev.map(c => dirtyRows.some(d => d.slug === c.slug) ? { ...c, tiers: caseFilesDraft[c.slug] ?? [] } : c))
          }
        }
        const gameOptionsFields = [
          'easyAnswerCount', 'mediumAnswerCount',
          'passThresholdEasy', 'passThresholdMedium',
          'aiQuestionsPerDifficulty',
          'aptitudeSyncEnabled',
          'aptitudeSyncTiers',
          'aptitudeSyncMaxRounds',
          'aptitudeSyncDailyLimitFree',
          'aptitudeSyncDailyLimitSilver',
          'aptitudeSyncDailyLimitGold',
          'cbatEnabled',
          'caseFilesEnabled',
          'caseFilesDailyLimitFree',
          'caseFilesDailyLimitSilver',
          'caseFilesDailyLimitGold',
          'newsFlashcardsEnabled',
        ]
        if (draft.cbatEnabled) {
          gameOptionsFields.push('cbatTargetAircraftBriefIds', 'cbatFlagAircraftBriefIds')
        }
        save('Update Game Options', gameOptionsFields)
      }}>
        <button
          type="button"
          onClick={() => toggleGameGroup('quiz')}
          className="w-full flex items-center justify-between text-base font-extrabold text-brand-600 uppercase tracking-widest pt-1 pb-2 mb-2 border-b-2 border-brand-600/40"
        >
          <span>Quiz</span>
          <span className="text-brand-600 text-xs">{gameGroupsOpen.quiz ? '▲' : '▼'}</span>
        </button>
        {gameGroupsOpen.quiz && (
          <>
            <NumInput
              label="Minimum questions per difficulty"
              hint="Used by admin 'Generate Missing' and the user-facing quiz availability gate"
              value={draft.aiQuestionsPerDifficulty}
              min={1}
              max={20}
              onChange={v => set('aiQuestionsPerDifficulty', v)}
            />
            <NumInput label="Answers shown — Easy"   value={draft.easyAnswerCount}   min={2} max={10} onChange={v => set('easyAnswerCount', v)} />
            <NumInput label="Answers shown — Medium" value={draft.mediumAnswerCount} min={2} max={10} onChange={v => set('mediumAnswerCount', v)} />
            <PctSlider label="Pass Threshold — Easy"   value={draft.passThresholdEasy}   onChange={v => set('passThresholdEasy', v)} />
            <PctSlider label="Pass Threshold — Medium" value={draft.passThresholdMedium} onChange={v => set('passThresholdMedium', v)} />
          </>
        )}

        <button
          type="button"
          onClick={() => toggleGameGroup('wta')}
          className="w-full flex items-center justify-between text-base font-extrabold text-brand-600 uppercase tracking-widest pt-6 pb-2 mb-2 border-b-2 border-brand-600/40"
        >
          <span>Where's That Aircraft</span>
          <span className="text-brand-600 text-xs">{gameGroupsOpen.wta ? '▲' : '▼'}</span>
        </button>
        {gameGroupsOpen.wta && (
          <div className="py-2.5 border-b border-slate-100">
            <p className="text-sm font-semibold text-slate-700 mb-1">Next Spawn</p>
            {!wtaSpawn ? (
              <p className="text-xs text-slate-400">Loading…</p>
            ) : !wtaSpawn.prereqsMet ? (
              <p className="text-xs text-slate-400">
                Prerequisites not met — requires ≥2 Bases reads ({wtaSpawn.basesRead ?? 0}/2) and ≥2 Aircrafts reads ({wtaSpawn.aircraftsRead ?? 0}/2).
              </p>
            ) : (
              <div className="flex items-center gap-3 text-sm">
                <div className="flex gap-1">
                  {Array.from({ length: wtaSpawn.threshold }).map((_, i) => (
                    <div
                      key={i}
                      className={`w-4 h-4 rounded-sm ${i < wtaSpawn.readsSince ? 'bg-brand-500' : 'bg-slate-200'}`}
                    />
                  ))}
                </div>
                <span className="text-slate-600">
                  {wtaSpawn.readsSince}/{wtaSpawn.threshold} aircraft briefs read
                  {wtaSpawn.remaining > 0
                    ? <> — <span className="font-semibold text-slate-800">{wtaSpawn.remaining} more to spawn</span></>
                    : <> — <span className="font-semibold text-green-600">ready to spawn</span></>
                  }
                </span>
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => toggleGameGroup('aptitudeSync')}
          className="w-full flex items-center justify-between text-base font-extrabold text-brand-600 uppercase tracking-widest pt-6 pb-2 mb-2 border-b-2 border-brand-600/40"
        >
          <span>APTITUDE_SYNC</span>
          <span className="text-brand-600 text-xs">{gameGroupsOpen.aptitudeSync ? '▲' : '▼'}</span>
        </button>
        {gameGroupsOpen.aptitudeSync && (
          <>
            <Toggle
              label="Enable APTITUDE_SYNC"
              hint="Show the APTITUDE_SYNC button on completed intel briefs for qualifying users"
              checked={draft.aptitudeSyncEnabled ?? false}
              onChange={v => set('aptitudeSyncEnabled', v)}
            />

            {/* Tier access */}
            <div className="py-2.5 border-b border-slate-100">
              <p className="text-sm font-semibold text-slate-700 mb-1">Tier access</p>
              <p className="text-xs text-slate-400 mb-2">Admin always has unlimited access regardless of this setting</p>
              <div className="flex flex-wrap gap-3">
                {['gold', 'silver', 'free'].map(tier => {
                  const tiers   = draft.aptitudeSyncTiers ?? ['admin']
                  const checked = tiers.includes(tier)
                  return (
                    <label key={tier} className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const next = checked
                            ? tiers.filter(t => t !== tier)
                            : [...tiers, tier]
                          set('aptitudeSyncTiers', next)
                        }}
                        className="w-4 h-4 accent-brand-600"
                      />
                      <span className="text-sm font-medium text-slate-700 capitalize">{tier}</span>
                    </label>
                  )
                })}
              </div>
            </div>

            <NumInput
              label="Max rounds per session"
              hint="Number of prompt/response exchanges before the terminal closes (1–5)"
              value={draft.aptitudeSyncMaxRounds ?? 3}
              min={1} max={5}
              onChange={v => set('aptitudeSyncMaxRounds', v)}
            />
            <NumInput
              label="Daily sessions — Free tier"
              hint="How many APTITUDE_SYNC sessions a free user can play per day"
              value={draft.aptitudeSyncDailyLimitFree ?? 1}
              min={0}
              onChange={v => set('aptitudeSyncDailyLimitFree', v)}
            />
            <NumInput
              label="Daily sessions — Silver / Trial tier"
              hint="How many APTITUDE_SYNC sessions a silver or active-trial user can play per day"
              value={draft.aptitudeSyncDailyLimitSilver ?? 3}
              min={0}
              onChange={v => set('aptitudeSyncDailyLimitSilver', v)}
            />
            <NumInput
              label="Daily sessions — Gold tier"
              hint="How many APTITUDE_SYNC sessions a gold user can play per day"
              value={draft.aptitudeSyncDailyLimitGold ?? 10}
              min={0}
              onChange={v => set('aptitudeSyncDailyLimitGold', v)}
            />
          </>
        )}

        <button
          type="button"
          onClick={() => toggleGameGroup('cbat')}
          className="w-full flex items-center justify-between text-base font-extrabold text-brand-600 uppercase tracking-widest pt-6 pb-2 mb-2 border-b-2 border-brand-600/40"
        >
          <span>CBAT</span>
          <span className="text-brand-600 text-xs">{gameGroupsOpen.cbat ? '▲' : '▼'}</span>
        </button>
        {gameGroupsOpen.cbat && (
          <>
            <Toggle
              label="CBAT Games enabled"
              hint="Show the Play CBAT button on the Play page"
              checked={draft.cbatEnabled ?? false}
              onChange={v => set('cbatEnabled', v)}
            />

            {(() => {
              const cbatLocked = !(draft.cbatEnabled ?? false)
              if (cbatLocked) {
                return (
                  <p className="text-xs text-slate-400 italic pt-1 pb-2">
                    Enable CBAT Games above to configure individual game settings.
                  </p>
                )
              }
              const targetEmpty = (draft.cbatTargetAircraftBriefIds ?? []).length === 0
              const flagEmpty   = (draft.cbatFlagAircraftBriefIds   ?? []).length === 0
              return (
                <>
                  <p className="text-sm font-bold text-slate-700 uppercase tracking-wide pt-2 pb-1">Target</p>
                  <div className="py-2.5 border-b border-slate-100">
                    <p className="text-sm font-semibold text-slate-700 mb-1">Aircraft in scan panels</p>
                    <p className="text-xs text-slate-400 mb-3">
                      Only ticked aircraft appear in the Target game's scan panels. New 3D models added to <code>/public/models/</code> start unticked until enabled here.
                    </p>
                    {cbatAircraft === null ? (
                      <p className="text-xs text-slate-400">Loading aircraft…</p>
                    ) : cbatAircraft.length === 0 ? (
                      <p className="text-xs text-slate-400">No aircraft with 3D models found.</p>
                    ) : (
                      <>
                        <div className="flex gap-3 mb-2 text-xs">
                          <button
                            type="button"
                            className="text-brand-600 hover:underline font-semibold"
                            onClick={() => set('cbatTargetAircraftBriefIds', cbatAircraft.map(a => String(a.briefId)))}
                          >
                            Select all
                          </button>
                          <button
                            type="button"
                            className="text-slate-500 hover:underline font-semibold"
                            onClick={() => set('cbatTargetAircraftBriefIds', [])}
                          >
                            Deselect all
                          </button>
                          <span className="ml-auto text-slate-400">
                            {(draft.cbatTargetAircraftBriefIds ?? []).length}/{cbatAircraft.length} enabled
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {cbatAircraft.map(a => {
                            const id      = String(a.briefId)
                            const enabled = (draft.cbatTargetAircraftBriefIds ?? []).includes(id)
                            return (
                              <label key={id} className="flex items-center gap-2 cursor-pointer select-none bg-slate-50 hover:bg-slate-100 rounded px-2 py-1.5 border border-slate-200">
                                <input
                                  type="checkbox"
                                  checked={enabled}
                                  onChange={() => {
                                    const current = draft.cbatTargetAircraftBriefIds ?? []
                                    const next    = enabled
                                      ? current.filter(x => x !== id)
                                      : [...current, id]
                                    set('cbatTargetAircraftBriefIds', next)
                                  }}
                                  className="w-4 h-4 accent-brand-600"
                                />
                                {a.cutoutUrl && (
                                  <img src={a.cutoutUrl} alt="" className="w-8 h-8 object-contain flex-shrink-0" />
                                )}
                                <span className="text-sm font-medium text-slate-700 truncate">{a.title}</span>
                              </label>
                            )
                          })}
                        </div>
                        {targetEmpty && (
                          <p className="text-xs text-red-500 mt-2">At least one aircraft must be enabled</p>
                        )}
                      </>
                    )}
                  </div>

                  <p className="text-sm font-bold text-slate-700 uppercase tracking-wide pt-3 pb-1">FLAG</p>
                  <div className="py-2.5 border-b border-slate-100">
                    <p className="text-sm font-semibold text-slate-700 mb-1">Aircraft in scan panels</p>
                    <p className="text-xs text-slate-400 mb-3">
                      Only ticked aircraft are used in the FLAG game. New 3D models added to <code>/public/models/</code> start unticked until enabled here.
                    </p>
                    {cbatAircraft === null ? (
                      <p className="text-xs text-slate-400">Loading aircraft…</p>
                    ) : cbatAircraft.length === 0 ? (
                      <p className="text-xs text-slate-400">No aircraft with 3D models found.</p>
                    ) : (
                      <>
                        <div className="flex gap-3 mb-2 text-xs">
                          <button
                            type="button"
                            className="text-brand-600 hover:underline font-semibold"
                            onClick={() => set('cbatFlagAircraftBriefIds', cbatAircraft.map(a => String(a.briefId)))}
                          >
                            Select all
                          </button>
                          <button
                            type="button"
                            className="text-slate-500 hover:underline font-semibold"
                            onClick={() => set('cbatFlagAircraftBriefIds', [])}
                          >
                            Deselect all
                          </button>
                          <span className="ml-auto text-slate-400">
                            {(draft.cbatFlagAircraftBriefIds ?? []).length}/{cbatAircraft.length} enabled
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {cbatAircraft.map(a => {
                            const id      = String(a.briefId)
                            const enabled = (draft.cbatFlagAircraftBriefIds ?? []).includes(id)
                            return (
                              <label key={id} className="flex items-center gap-2 cursor-pointer select-none bg-slate-50 hover:bg-slate-100 rounded px-2 py-1.5 border border-slate-200">
                                <input
                                  type="checkbox"
                                  checked={enabled}
                                  onChange={() => {
                                    const current = draft.cbatFlagAircraftBriefIds ?? []
                                    const next    = enabled
                                      ? current.filter(x => x !== id)
                                      : [...current, id]
                                    set('cbatFlagAircraftBriefIds', next)
                                  }}
                                  className="w-4 h-4 accent-brand-600"
                                />
                                {a.cutoutUrl && (
                                  <img src={a.cutoutUrl} alt="" className="w-8 h-8 object-contain flex-shrink-0" />
                                )}
                                <span className="text-sm font-medium text-slate-700 truncate">{a.title}</span>
                              </label>
                            )
                          })}
                        </div>
                        {flagEmpty && (
                          <p className="text-xs text-red-500 mt-2">At least one aircraft must be enabled</p>
                        )}
                      </>
                    )}
                  </div>
                </>
              )
            })()}
          </>
        )}

        <button
          type="button"
          onClick={() => toggleGameGroup('caseFiles')}
          className="w-full flex items-center justify-between text-base font-extrabold text-brand-600 uppercase tracking-widest pt-6 pb-2 mb-2 border-b-2 border-brand-600/40"
        >
          <span>Case Files</span>
          <span className="text-brand-600 text-xs">{gameGroupsOpen.caseFiles ? '▲' : '▼'}</span>
        </button>
        {gameGroupsOpen.caseFiles && (
          <>
            <Toggle
              label="Enable Case Files"
              hint="Show the Case Files button on the Play page for qualifying users"
              checked={draft.caseFilesEnabled ?? false}
              onChange={v => set('caseFilesEnabled', v)}
            />

            {/* Tier access per case */}
            <div className="py-2.5 border-b border-slate-100">
              <p className="text-sm font-semibold text-slate-700 mb-1">Tier access per case</p>
              <p className="text-xs text-slate-400 mb-2">Admin always has unlimited access. Each case can be enabled for a subset of subscription tiers.</p>
              {caseFilesList === null ? (
                <p className="text-xs text-slate-400">Loading…</p>
              ) : caseFilesList.length === 0 ? (
                <p className="text-xs text-slate-400">No case files in catalogue.</p>
              ) : (
                <div className="space-y-2">
                  {caseFilesList.map(cf => {
                    const tiers = caseFilesDraft[cf.slug] ?? []
                    return (
                      <div key={cf.slug} className="flex flex-wrap items-center gap-3 py-1.5 border-b border-slate-100 last:border-0">
                        <span className="text-sm font-semibold text-slate-700 min-w-[12rem]">{cf.title}</span>
                        <div className="flex flex-wrap gap-3">
                          {['free', 'silver', 'gold'].map(tier => (
                            <label key={tier} className="flex items-center gap-1.5 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={tiers.includes(tier)}
                                onChange={() => toggleCaseTier(cf.slug, tier)}
                                className="w-4 h-4 accent-brand-600"
                                data-testid={`case-tier-${cf.slug}-${tier}`}
                              />
                              <span className="text-sm font-medium text-slate-700 capitalize">{tier}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <NumInput
              label="Daily sessions — Free tier"
              hint="How many Case Files sessions a free user can play per day"
              value={draft.caseFilesDailyLimitFree ?? 0}
              min={0}
              onChange={v => set('caseFilesDailyLimitFree', v)}
            />
            <NumInput
              label="Daily sessions — Silver / Trial tier"
              hint="How many Case Files sessions a silver or active-trial user can play per day"
              value={draft.caseFilesDailyLimitSilver ?? 1}
              min={0}
              onChange={v => set('caseFilesDailyLimitSilver', v)}
            />
            <NumInput
              label="Daily sessions — Gold tier"
              hint="How many Case Files sessions a gold user can play per day"
              value={draft.caseFilesDailyLimitGold ?? 5}
              min={0}
              onChange={v => set('caseFilesDailyLimitGold', v)}
            />
          </>
        )}

        <button
          type="button"
          onClick={() => toggleGameGroup('flashcards')}
          className="w-full flex items-center justify-between text-base font-extrabold text-brand-600 uppercase tracking-widest pt-6 pb-2 mb-2 border-b-2 border-brand-600/40"
        >
          <span>Flashcards</span>
          <span className="text-brand-600 text-xs">{gameGroupsOpen.flashcards ? '▲' : '▼'}</span>
        </button>
        {gameGroupsOpen.flashcards && (
          <>
            <Toggle
              label="News brief flashcards enabled"
              hint="When off, News-category briefs skip the flashcard layout on section 4, suppress the collect animation, and are excluded from the flashcard deck and overall count. Reached-flashcard records still persist so re-enabling restores them immediately."
              checked={draft.newsFlashcardsEnabled ?? false}
              onChange={v => set('newsFlashcardsEnabled', v)}
            />
          </>
        )}
      </Section>

      {/* ── Account Settings ────────────────────────────────── */}
      <Section title="Account Settings" collapsible onSave={() => save('Update Account Settings', ['emailConfirmationEnabled', 'emailPasswordResetEnabled', 'betaTesterAutoGold', 'signupCaptchaEnabled'])}>
        <Toggle
          label="Require email confirmation"
          hint="When off, new users are registered instantly without entering a confirmation code"
          checked={draft.emailConfirmationEnabled !== false}
          onChange={v => set('emailConfirmationEnabled', v)}
        />
        <Toggle
          label="Allow password reset emails"
          hint="When off, users cannot reset their password via email — they will be directed to contact support for a manual reset"
          checked={draft.emailPasswordResetEnabled !== false}
          onChange={v => set('emailPasswordResetEnabled', v)}
        />
        <Toggle
          label="Beta Tester Auto-Gold"
          hint="When on, every newly registered account is automatically granted gold subscription"
          checked={draft.betaTesterAutoGold ?? false}
          onChange={v => set('betaTesterAutoGold', v)}
        />
        <Toggle
          label="Enable signup CAPTCHA"
          hint="Require a Cloudflare Turnstile check on the email signup form. Requires VITE_TURNSTILE_SITE_KEY (frontend) and TURNSTILE_SECRET_KEY (backend) to be set in .env. Does not apply to Google signups."
          checked={draft.signupCaptchaEnabled ?? false}
          onChange={v => set('signupCaptchaEnabled', v)}
        />
        {draft.signupCaptchaEnabled && !import.meta.env.VITE_TURNSTILE_SITE_KEY && (
          <p className="text-xs text-red-500 font-semibold mt-1">
            ⚠ CAPTCHA enabled but VITE_TURNSTILE_SITE_KEY is not set — the widget cannot render and signups remain unprotected.
          </p>
        )}
      </Section>

      {/* ── Feature Flags ───────────────────────────────────── */}
      <Section title="Feature Flags" collapsible onSave={() => save('Update Feature Flags', ['useLiveLeaderboard', 'mnemonicsClickEnabled', 'rsvpReaderEnabled'])}>
        <Toggle
          label="Live Leaderboard"
          hint="When off, mock placeholder data is shown on the Profile page"
          checked={draft.useLiveLeaderboard ?? false}
          onChange={v => set('useLiveLeaderboard', v)}
        />
        <Toggle
          label="Mnemonic Memory Aids"
          hint="When off, the 💡 beside stats is hidden, stat taps do nothing, and the mnemonic tutorial is suppressed"
          checked={draft.mnemonicsClickEnabled ?? false}
          onChange={v => set('mnemonicsClickEnabled', v)}
        />
        <Toggle
          label="RSVP Speed Reader"
          hint="Hold-to-engage rapid serial reading on brief description sections. When off, holds do nothing and the RSVP tutorial step is hidden."
          checked={draft.rsvpReaderEnabled ?? false}
          onChange={v => set('rsvpReaderEnabled', v)}
        />
      </Section>

      {/* ── Sound Effects ───────────────────────────────────── */}
      <Section title="Sound Effects" collapsible onSave={() => save('Update Sound Settings', ALL_SOUND_KEYS)}>
        {SOUND_GROUPS.map(group => (
          <div key={group.title} className="mb-4">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest pt-1 pb-1">{group.title}</p>
            {group.sounds.map(({ key, enabledKey, durationKey, durationMax, durationDefault, label, sound }) => (
              <SoundRowV2
                key={key}
                label={label}
                sound={sound}
                value={draft[key] ?? 100}
                onChange={v => set(key, v)}
                enabled={draft[enabledKey] !== false}
                onToggle={() => set(enabledKey, draft[enabledKey] === false ? true : false)}
                durationValue={durationKey ? draft[durationKey] : undefined}
                onDurationChange={durationKey ? v => set(durationKey, v) : undefined}
                durationMax={durationMax}
                durationDefault={durationDefault}
              />
            ))}
          </div>
        ))}
      </Section>

    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// USERS TAB
// ─────────────────────────────────────────────────────────────────────────────

const TIER_COLORS = {
  free:   'bg-slate-100 text-slate-600',
  trial:  'bg-amber-100 text-amber-700',
  silver: 'bg-slate-200 text-slate-700',
  gold:   'bg-yellow-100 text-yellow-700',
}

function SubscriptionTierRow({ u, action }) {
  const current = u.subscriptionTier ?? 'free'
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mr-1">Tier</p>
      {['free', 'trial', 'silver', 'gold'].map(tier => (
        <button
          key={tier}
          onClick={() => tier !== current && action(
            `Change subscription — Agent ${u.agentNumber} → ${tier}`,
            `/api/admin/users/${u._id}/subscription`,
            'PATCH',
            { tier },
          )}
          className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all
            ${tier === current
              ? TIER_BTN[tier] + ' ring-2 ring-offset-1 ring-slate-400 cursor-default'
              : TIER_BTN[tier] + ' opacity-50 hover:opacity-100 cursor-pointer'
            }`}
        >
          {tier.charAt(0).toUpperCase() + tier.slice(1)}
        </button>
      ))}
    </div>
  )
}

function UsersTab({ API }) {
  const { user: currentUser, refreshUser, apiFetch } = useAuth()
  const [users,   setUsers]   = useState([])
  const [q,       setQ]       = useState('')
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState(false) // is in search mode
  const [modal,   setModal]   = useState(null)
  const [toast,   setToast]   = useState('')
  const [resetPanel,  setResetPanel]  = useState(null) // user._id of open panel
  const [resetChecks, setResetChecks] = useState({})
  const [awardPanel,  setAwardPanel]  = useState(null) // user._id of open panel
  const [awardAmount, setAwardAmount] = useState('')
  const [tierPanel,   setTierPanel]   = useState(null) // user._id of open panel
  const [expanded,    setExpanded]    = useState(() => new Set()) // user._ids expanded

  const loadAll = useCallback(async () => {
    setLoading(true); setSearch(false)
    const res  = await apiFetch(`${API}/api/admin/users`, { credentials: 'include' })
    const data = await res.json()
    setUsers(data.data?.users ?? [])
    setLoading(false)
  }, [API])

  useEffect(() => { loadAll() }, [loadAll])

  // Default expansion: only the current user's row when browsing; all rows when in search mode
  useEffect(() => {
    if (search) {
      setExpanded(new Set(users.map(u => u._id)))
    } else {
      setExpanded(currentUser?._id ? new Set([currentUser._id]) : new Set())
    }
  }, [users, search, currentUser?._id])

  const toggleExpanded = (id) => {
    const isOpen = expanded.has(id)
    if (isOpen) {
      if (tierPanel === id)  setTierPanel(null)
      if (awardPanel === id) setAwardPanel(null)
      if (resetPanel === id) setResetPanel(null)
    }
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const expandAll = () => setExpanded(new Set(users.map(u => u._id)))
  const collapseAll = () => {
    setExpanded(new Set())
    setTierPanel(null)
    setAwardPanel(null)
    setResetPanel(null)
  }

  const runSearch = async () => {
    if (!q.trim()) { loadAll(); return }
    setLoading(true); setSearch(true)
    const res  = await apiFetch(`${API}/api/admin/users/search?q=${encodeURIComponent(q.trim())}`, { credentials: 'include' })
    const data = await res.json()
    setUsers(data.data?.users ?? [])
    setLoading(false)
  }

  const action = (label, endpoint, method = 'POST', extra = {}) => setModal({ label, endpoint, method, extra })

  const confirmAction = async (reason) => {
    const res  = await apiFetch(`${API}${modal.endpoint}`, {
      method: modal.method, credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason, ...modal.extra }),
    })
    const data = await res.json().catch(() => ({}))
    setModal(null)
    if (!res.ok) {
      setToast(data.message ?? 'Action failed')
      return
    }
    setToast('Action completed')
    search ? runSearch() : loadAll()
    refreshUser()
  }

  return (
    <div>
      <AnimatePresence>{toast && <Toast msg={toast} onClear={() => setToast('')} />}</AnimatePresence>
      {modal && (
        <ConfirmModal title={modal.label} danger={modal.label.toLowerCase().includes('ban') || modal.label.toLowerCase().includes('delete')}
          onConfirm={confirmAction} onCancel={() => setModal(null)} />
      )}

      {/* Search */}
      <form className="flex gap-2 mb-5" onSubmit={e => { e.preventDefault(); runSearch() }}>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search by email or agent number…"
          className="flex-1 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand-200 focus:border-brand-400"
        />
        <button type="submit" className="px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-xl transition-colors">
          Search
        </button>
        {search && (
          <button type="button" onClick={() => { setQ(''); loadAll() }}
            className="px-4 py-2.5 border border-slate-200 text-slate-600 text-sm font-semibold rounded-xl hover:bg-slate-50 transition-colors">
            Clear
          </button>
        )}
      </form>

      {loading && <div className="text-center py-8 text-slate-400 text-sm animate-pulse">Loading users…</div>}
      {!loading && users.length === 0 && (
        <div className="text-center py-12 text-slate-400">
          <div className="text-3xl mb-2">👤</div>
          <p>No users found</p>
        </div>
      )}

      {!loading && users.length > 0 && (
        <div className="flex items-center justify-end gap-3 mb-3 text-xs">
          <button onClick={expandAll}   className="text-brand-600 hover:text-brand-500 font-semibold transition-colors">Expand all</button>
          <span className="text-slate-500/60" aria-hidden="true">·</span>
          <button onClick={collapseAll} className="text-slate-400 hover:text-slate-200 font-semibold transition-colors">Collapse all</button>
        </div>
      )}

      <div className="space-y-3">
        {users.map(u => {
          const isExpanded = expanded.has(u._id)
          return (
          <div key={u._id} className={`rounded-2xl border overflow-hidden ${u._id === currentUser?._id ? 'bg-red-950/40 border-red-900/50' : 'bg-surface border-slate-200'}`}>
            {/* Header (clickable — toggles expansion) */}
            <div
              role="button"
              tabIndex={0}
              aria-expanded={isExpanded}
              aria-label={`${isExpanded ? 'Collapse' : 'Expand'} Agent ${u.agentNumber}`}
              onClick={() => toggleExpanded(u._id)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpanded(u._id) } }}
              className={`flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-surface-raised/40 transition-colors ${isExpanded ? 'border-b border-slate-100' : ''}`}
            >
              <div>
                <p className="font-bold text-slate-800 text-sm">
                  Agent {u.agentNumber}
                  {u.isAdmin && <span className="ml-2 text-[10px] bg-brand-100 text-brand-700 px-1.5 py-0.5 rounded-full font-bold">ADMIN</span>}
                  {u.isBanned && <span className="ml-2 text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-bold">BANNED</span>}
                </p>
                <p className="text-xs text-slate-400">{u.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={e => { e.stopPropagation(); setTierPanel(tierPanel === u._id ? null : u._id); if (!isExpanded) setExpanded(prev => new Set(prev).add(u._id)) }}
                  title="Change subscription tier"
                  aria-label="Change subscription tier"
                  className={`text-[10px] font-bold px-2 py-1 rounded-full border transition-colors ${
                    tierPanel === u._id
                      ? `${TIER_BTN[u.subscriptionTier ?? 'free']} ring-2 ring-offset-1 ring-slate-400`
                      : `${TIER_BTN[u.subscriptionTier ?? 'free']} opacity-70 hover:opacity-100`
                  }`}>
                  {TIER_LABELS[u.subscriptionTier ?? 'free'] ?? 'Free'} {tierPanel === u._id ? '▲' : '▼'}
                </button>
                {(() => {
                  const diff = (u.difficultySetting ?? 'easy')
                  const DIFF_COLORS = { easy: 'bg-green-100 text-green-700', medium: 'bg-amber-100 text-amber-700', hard: 'bg-red-100 text-red-600' }
                  return (
                    <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${DIFF_COLORS[diff] ?? DIFF_COLORS.easy}`}>
                      {diff.charAt(0).toUpperCase() + diff.slice(1)}
                    </span>
                  )
                })()}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className={`w-4 h-4 ml-1 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </div>
            </div>

            {isExpanded && (
            <>
            {/* Stats row */}
            <div className="grid grid-cols-4 sm:grid-cols-7 divide-x divide-slate-100 border-b border-slate-100">
              {[
                ['Coins', (u.totalAirstars ?? 0).toLocaleString()],
                ['Streak', u.loginStreak ?? 0],
                ['Briefs Read', u.profileStats?.brifsRead ?? 0],
                ['Games', (u.profileStats?.quizzesPlayed ?? 0) + (u.profileStats?.booPlayed ?? 0) + (u.profileStats?.wtaPlayed ?? 0) + (u.profileStats?.wherePlayed ?? 0) + (u.profileStats?.flashcardsPlayed ?? 0)],
                ['CBAT Games Finished', `${u.profileStats?.cbatPlayed ?? 0}/${u.profileStats?.cbatStarted ?? 0}`],
                ['Difficulty', (u.difficultySetting ?? 'easy').charAt(0).toUpperCase() + (u.difficultySetting ?? 'easy').slice(1)],
                ['Joined', new Date(u.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })],
              ].map(([l, v]) => (
                <div key={l} className="px-3 py-2 text-center">
                  <p className="text-xs font-bold text-slate-700">{v}</p>
                  <p className="text-[10px] text-slate-400">{l}</p>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-slate-100">
              {!u.isAdmin && (
                <button onClick={() => action(`Grant admin — Agent ${u.agentNumber}`, `/api/admin/users/${u._id}/make-admin`)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-brand-200 text-brand-700 hover:bg-brand-50 font-semibold transition-colors">
                  Make Admin
                </button>
              )}
              {u.isAdmin && u._id !== currentUser?._id && (
                <button onClick={() => action(`Remove admin — Agent ${u.agentNumber}`, `/api/admin/users/${u._id}/remove-admin`)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold transition-colors">
                  Remove Admin
                </button>
              )}
              {u._id !== currentUser?._id && (
                <button onClick={() => action(`${u.isBanned ? 'Unban' : 'Ban'} — Agent ${u.agentNumber}`, u.isBanned ? `/api/admin/users/${u._id}/unban` : `/api/admin/users/${u._id}/ban`)}
                  title={u.isBanned ? 'Unban user' : 'Ban user'}
                  aria-label={u.isBanned ? 'Unban user' : 'Ban user'}
                  className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border transition-colors
                    ${u.isBanned
                      ? 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                      : 'border-red-200 text-red-600 hover:bg-red-50'
                    }`}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m14.5 12.5-8 8a2.119 2.119 0 1 1-3-3l8-8" />
                    <path d="m16 16 6-6" />
                    <path d="m8 8 6-6" />
                    <path d="m9 7 8 8" />
                    <path d="m21 11-8-8" />
                    <path d="M5 21h14" />
                  </svg>
                </button>
              )}
              {u._id !== currentUser?._id && (
                <button onClick={() => action(`Delete account — Agent ${u.agentNumber}`, `/api/admin/users/${u._id}`, 'DELETE')}
                  title="Delete account"
                  aria-label="Delete account"
                  className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <line x1="10" x2="10" y1="11" y2="17" />
                    <line x1="14" x2="14" y1="11" y2="17" />
                  </svg>
                </button>
              )}
              <button onClick={() => { setAwardPanel(awardPanel === u._id ? null : u._id); setAwardAmount('') }}
                title="Award Airstars"
                aria-label="Award Airstars"
                className={`relative inline-flex items-center justify-center w-8 h-8 rounded-lg border transition-colors ${
                  awardPanel === u._id
                    ? 'border-amber-300 bg-amber-50'
                    : 'border-amber-200 hover:bg-amber-50'
                }`}>
                <span className="star-silver text-base leading-none" aria-hidden="true">⭐</span>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="absolute -top-1 -right-1 w-3.5 h-3.5 text-emerald-500 drop-shadow">
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
              </button>
              {(() => {
                const progressHasData = (
                  (u.totalAirstars ?? 0) > 0 ||
                  (u.profileStats?.quizzesPlayed ?? 0) > 0 || (u.profileStats?.booPlayed ?? 0) > 0 ||
                  (u.profileStats?.wtaPlayed ?? 0) > 0 || (u.profileStats?.wherePlayed ?? 0) > 0 ||
                  (u.profileStats?.flashcardsPlayed ?? 0) > 0 ||
                  (u.profileStats?.brifsRead ?? 0) > 0 ||
                  (u.loginStreak ?? 0) > 0 ||
                  Object.values(u.gameUnlocks ?? {}).some(g => g?.unlockedAt != null)
                )
                const anyHasData = progressHasData || TUTORIAL_KEYS.some(k => u.tutorials?.[k] === 'viewed' || u.tutorials?.[k] === 'skipped')
                const isOpen = resetPanel === u._id
                return (
                  <button
                    onClick={() => {
                      if (isOpen) { setResetPanel(null); return }
                      const PROGRESS_FIELDS = ['airstars', 'gameHistory', 'intelBriefsRead', 'streak', 'gameBadges']
                      const RESET_ITEMS = [
                        { key: 'progress',  defaultOn: true },
                        { key: 'tutorials', defaultOn: false },
                      ]
                      const defaults = {}
                      RESET_ITEMS.forEach(i => { defaults[i.key] = i.defaultOn })
                      setResetChecks(defaults)
                      setResetPanel(u._id)
                    }}
                    title={isOpen ? 'Close reset panel' : 'Reset user'}
                    aria-label={isOpen ? 'Close reset panel' : 'Reset user'}
                    className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border transition-colors ${
                      isOpen
                        ? 'border-slate-300 text-slate-600 bg-slate-50'
                        : anyHasData
                          ? 'border-amber-200 text-amber-700 hover:bg-amber-50'
                          : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                    }`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                      <path d="M3 3v5h5" />
                    </svg>
                  </button>
                )
              })()}
            </div>

            {/* Subscription tier panel (expanded) */}
            {tierPanel === u._id && (
              <div className="px-4 py-2.5 border-b border-slate-100">
                <SubscriptionTierRow u={u} action={action} />
              </div>
            )}

            {/* Award Airstars panel (expanded) */}
            {awardPanel === u._id && (
              <div className="px-4 py-2.5 border-b border-slate-100">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Award Airstars</p>
                <div className="flex items-center gap-2">
                  <input
                    type="number" min={1} placeholder="Amount…"
                    value={awardAmount}
                    onChange={e => setAwardAmount(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && parseInt(awardAmount, 10) > 0) {
                        action(`Award ${awardAmount} airstars — Agent ${u.agentNumber}`, `/api/admin/users/${u._id}/award-coins`, 'POST', { amount: parseInt(awardAmount, 10) })
                      }
                    }}
                    className="w-28 border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-amber-200"
                  />
                  <button
                    onClick={() => action(`Award ${awardAmount} airstars — Agent ${u.agentNumber}`, `/api/admin/users/${u._id}/award-coins`, 'POST', { amount: parseInt(awardAmount, 10) })}
                    disabled={!awardAmount || parseInt(awardAmount, 10) <= 0}
                    className="text-xs px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-semibold transition-colors disabled:opacity-40"
                  >
                    ⬡ Award
                  </button>
                </div>
              </div>
            )}

            {/* Reset panel (expanded) */}
            {resetPanel === u._id && (() => {
              const PROGRESS_FIELDS = ['airstars', 'gameHistory', 'intelBriefsRead', 'streak', 'gameBadges']
              const progressHasData = (
                (u.totalAirstars ?? 0) > 0 ||
                (u.profileStats?.quizzesPlayed ?? 0) > 0 || (u.profileStats?.booPlayed ?? 0) > 0 ||
                (u.profileStats?.wtaPlayed ?? 0) > 0 || (u.profileStats?.wherePlayed ?? 0) > 0 ||
                (u.profileStats?.flashcardsPlayed ?? 0) > 0 ||
                (u.profileStats?.brifsRead ?? 0) > 0 ||
                (u.loginStreak ?? 0) > 0 ||
                Object.values(u.gameUnlocks ?? {}).some(g => g?.unlockedAt != null)
              )
              const RESET_ITEMS = [
                { key: 'progress',  label: 'Progress',  fields: PROGRESS_FIELDS, defaultOn: true,  hasData: progressHasData },
                { key: 'tutorials', label: 'Tutorials', fields: ['tutorials'],   defaultOn: false, hasData: TUTORIAL_KEYS.some(k => u.tutorials?.[k] === 'viewed' || u.tutorials?.[k] === 'skipped') },
              ]
              return (
                <div className="px-4 py-2.5 border-b border-slate-100">
                  <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 inline-flex flex-col gap-2.5 min-w-[180px]">
                    {RESET_ITEMS.map(item => (
                      <label key={item.key} className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={resetChecks[item.key] ?? item.defaultOn}
                          onChange={e => setResetChecks(prev => ({ ...prev, [item.key]: e.target.checked }))}
                          className="rounded"
                        />
                        <span className="text-xs text-slate-600">{item.label}</span>
                        {item.hasData && (
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                        )}
                      </label>
                    ))}
                    <button
                      onClick={() => {
                        const fields = RESET_ITEMS
                          .filter(i => resetChecks[i.key] ?? i.defaultOn)
                          .flatMap(i => i.fields)
                        if (!fields.length) return
                        const labels = RESET_ITEMS.filter(i => resetChecks[i.key] ?? i.defaultOn).map(i => i.label).join(', ')
                        setResetPanel(null)
                        action(
                          `Reset ${labels} — Agent ${u.agentNumber}`,
                          `/api/admin/users/${u._id}/reset-stats`,
                          'POST',
                          { fields },
                        )
                      }}
                      className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 font-semibold transition-colors mt-1"
                    >
                      Apply Reset
                    </button>
                  </div>
                </div>
              )
            })()}
            </>
            )}
          </div>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PROBLEMS TAB
// ─────────────────────────────────────────────────────────────────────────────

function ProblemsTab({ API, onOpenBrief }) {
  const { apiFetch } = useAuth()
  const { refresh: refreshUnsolvedCount } = useUnsolvedReports()
  const [problems, setProblems] = useState([])
  const [filter,   setFilter]   = useState('unsolved')
  const [search,   setSearch]   = useState('')
  const [loading,  setLoading]  = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [updates,  setUpdates]  = useState({})       // { reportId: text }
  const [notify,   setNotify]   = useState({})        // { reportId: bool }
  const [delivery, setDelivery] = useState({})        // { reportId: 'email'|'notif' }
  const [confirm,  setConfirm]  = useState(null)      // { id, description, solved, sendEmail } | null
  const [busy,     setBusy]     = useState(null)
  const [toast,    setToast]    = useState('')
  const [tick,     setTick]     = useState(0)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filter !== 'all') params.set('solved', filter === 'solved' ? 'true' : 'false')
    apiFetch(`${API}/api/admin/problems?${params}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setProblems(d.data?.problems ?? []))
      .finally(() => setLoading(false))
  }, [API, filter, tick])

  const visible = search.trim()
    ? problems.filter(p => p.description.toLowerCase().includes(search.toLowerCase()) || p.pageReported?.toLowerCase().includes(search.toLowerCase()))
    : problems

  const executeUpdate = async ({ id, description, solved, notifyUser, sendEmail }) => {
    setBusy(id)
    setConfirm(null)
    await apiFetch(`${API}/api/admin/problems/${id}/update`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description,
        ...(solved !== undefined ? { solved } : {}),
        ...(notifyUser ? { notifyUser: true, sendEmail } : {}),
      }),
    })
    setUpdates(p => ({ ...p, [id]: '' }))
    setNotify(p => ({ ...p, [id]: false }))
    setBusy(null)
    setToast(solved !== undefined ? (solved ? '✓ Marked solved' : '✓ Reopened') : '✓ Updated')
    if (solved !== undefined) refreshUnsolvedCount()
    setTick(t => t + 1)
  }

  const handleSaveNote = (p) => {
    const description = updates[p._id]
    if (!description?.trim()) return
    const notifyUser = notify[p._id] ?? false
    const sendEmail  = notifyUser && (delivery[p._id] ?? 'notif') === 'email'
    if (notifyUser) {
      setConfirm({ id: p._id, description, solved: undefined, notifyUser, sendEmail })
    } else {
      executeUpdate({ id: p._id, description, solved: undefined, notifyUser: false })
    }
  }

  const handleToggleSolved = (p) => {
    const description = updates[p._id]?.trim() || (p.solved ? 'Reopened' : 'Marked as solved')
    const solved      = !p.solved
    const notifyUser  = notify[p._id] ?? false
    const sendEmail   = notifyUser && (delivery[p._id] ?? 'notif') === 'email'
    if (notifyUser) {
      setConfirm({ id: p._id, description, solved, notifyUser, sendEmail })
    } else {
      executeUpdate({ id: p._id, description, solved, notifyUser: false })
    }
  }

  return (
    <div>
      <AnimatePresence>{toast && <Toast msg={toast} onClear={() => setToast('')} />}</AnimatePresence>

      {/* Confirmation modal */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-surface rounded-2xl shadow-xl border border-slate-700 max-w-md w-full p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider">Confirm — send to user</h3>
            <p className="text-xs text-slate-400">
              The user will receive the following {confirm.sendEmail ? 'via email' : 'as an in-app notification'}:
            </p>
            <div className="bg-surface-raised border-l-4 border-brand-600 rounded-r-xl p-3 text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">
              {confirm.description}
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={() => setConfirm(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-300 border border-slate-600 rounded-lg hover:bg-surface-raised"
              >
                Cancel
              </button>
              <button
                onClick={() => executeUpdate(confirm)}
                className="px-4 py-2 text-xs font-bold bg-brand-600 text-white rounded-lg hover:bg-brand-700"
              >
                Confirm &amp; Send
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap gap-2 mb-5">
        {['unsolved', 'solved', 'all'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors capitalize
              ${filter === f ? 'bg-brand-600 text-white' : 'bg-surface border border-slate-700 text-slate-300 hover:border-brand-400'}`}>
            {f}
          </button>
        ))}
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Filter reports…"
          className="flex-1 min-w-40 border border-slate-700 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-600/40 bg-surface text-slate-200 placeholder:text-slate-500"
        />
      </div>

      {loading && <div className="text-center py-8 text-slate-400 text-sm animate-pulse">Loading…</div>}
      {!loading && visible.length === 0 && (
        <div className="text-center py-12 text-slate-400">
          <div className="text-3xl mb-2">✅</div>
          <p>No {filter !== 'all' ? filter : ''} reports</p>
        </div>
      )}

      <div className="space-y-3">
        {visible.map(p => (
          <div key={p._id} className={`bg-surface rounded-2xl border overflow-hidden transition-colors ${p.solved ? 'border-emerald-700' : 'border-slate-700'}`}>
            <button
              className="w-full flex items-start justify-between gap-3 px-4 py-3 text-left"
              onClick={() => setExpanded(e => e === p._id ? null : p._id)}
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-400 mb-0.5">{p.pageReported || 'Unknown page'} · {new Date(p.time).toLocaleDateString('en-GB')}</p>
                <p className="text-sm font-semibold text-slate-100 line-clamp-2">{p.description}</p>
                {p.intelligenceBrief && (
                  <span
                    role="link"
                    tabIndex={0}
                    onClick={e => { e.stopPropagation(); onOpenBrief?.(String(p.intelligenceBrief._id ?? p.intelligenceBrief)) }}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onOpenBrief?.(String(p.intelligenceBrief._id ?? p.intelligenceBrief)) } }}
                    className="inline-flex items-center gap-1 mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-900/30 text-amber-300 hover:bg-amber-800/40 cursor-pointer"
                  >
                    ⚑ Brief: {p.intelligenceBrief.title ?? String(p.intelligenceBrief).slice(-6)}
                  </span>
                )}
              </div>
              <span className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded-full ${p.solved ? 'bg-emerald-900/40 text-emerald-300' : 'bg-red-900/40 text-red-300'}`}>
                {p.solved ? 'Solved' : 'Open'}
              </span>
            </button>

            {expanded === p._id && (
              <div className="px-4 pb-4 border-t border-slate-700 pt-3 space-y-3">

                {/* Full original description */}
                <div className="bg-surface-raised rounded-xl p-3 text-xs text-slate-300">
                  <p className="font-semibold text-slate-400 mb-1 uppercase tracking-wider text-[10px]">Original report</p>
                  <p className="whitespace-pre-wrap leading-relaxed">{p.description}</p>
                  <p className="mt-1 text-slate-400">
                    {p.userId?.agentNumber ? `Agent ${p.userId.agentNumber}` : 'Unknown agent'}
                    {' · '}{new Date(p.time || p.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>
                </div>

                {/* Update history */}
                {p.updates?.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Update history</p>
                    {p.updates.map((u, i) => (
                      <div key={i} className={`border rounded-xl p-3 text-xs text-slate-300 ${u.isUserVisible ? 'bg-brand-600/10 border-brand-600/20' : 'bg-surface-raised border-slate-700'}`}>
                        <p className="whitespace-pre-wrap leading-relaxed mb-1">{u.description}</p>
                        <p className="text-slate-400 flex items-center gap-2">
                          <span>
                            {u.adminUserId?.agentNumber ? `Agent ${u.adminUserId.agentNumber}` : 'Admin'}
                            {' · '}{new Date(u.time).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                          </span>
                          {u.isUserVisible && (
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${u.emailSent ? 'bg-violet-900/40 text-violet-300' : 'bg-sky-900/40 text-sky-300'}`}>
                              {u.emailSent ? 'emailed' : 'notified'}
                            </span>
                          )}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {/* New note */}
                <textarea
                  rows={2}
                  placeholder="Add admin note…"
                  value={updates[p._id] ?? ''}
                  onChange={e => setUpdates(prev => ({ ...prev, [p._id]: e.target.value }))}
                  className="w-full border border-slate-500 rounded-xl px-3 py-2 text-sm resize-none outline-none focus:ring-2 focus:ring-brand-600/40 bg-surface-raised text-text placeholder:text-text-muted"
                />

                {/* Notify user controls */}
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={notify[p._id] ?? false}
                      onChange={e => setNotify(prev => ({ ...prev, [p._id]: e.target.checked }))}
                      className="accent-brand-600"
                    />
                    Send update to user
                  </label>

                  {(notify[p._id]) && (
                    <div className="flex gap-4 pl-5 text-xs text-slate-300">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name={`delivery-${p._id}`}
                          value="notif"
                          checked={(delivery[p._id] ?? 'notif') === 'notif'}
                          onChange={() => setDelivery(prev => ({ ...prev, [p._id]: 'notif' }))}
                          className="accent-brand-600"
                        />
                        In-app notification
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name={`delivery-${p._id}`}
                          value="email"
                          checked={(delivery[p._id] ?? 'notif') === 'email'}
                          onChange={() => setDelivery(prev => ({ ...prev, [p._id]: 'email' }))}
                          className="accent-brand-600"
                        />
                        Email
                      </label>
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => handleSaveNote(p)}
                    disabled={busy === p._id || !updates[p._id]?.trim()}
                    className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {busy === p._id ? 'Saving…' : 'Save Note'}
                  </button>
                  <button
                    onClick={() => handleToggleSolved(p)}
                    disabled={busy === p._id}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                      ${p.solved ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-emerald-600 text-white hover:bg-emerald-500'}`}
                  >
                    {p.solved ? 'Reopen' : 'Mark Solved'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTENT TAB
// ─────────────────────────────────────────────────────────────────────────────

const EMAIL_DEFAULTS = {
  welcomeEmailSubject: 'Welcome to SkyWatch — Mission Briefing',
  welcomeEmailHeading: 'Welcome to SkyWatch',
  welcomeEmailBody:    'Your intelligence briefings are ready.',
  welcomeEmailCta:     'Begin Mission',
  welcomeEmailFooter:  'SkyWatch — Intelligence Study Platform.',
}

const CR_DEFAULTS = {
  combatReadinessTitle:    'Combat Readiness Assessment',
  combatReadinessSubtitle: 'Choose your recall difficulty.',
  combatReadinessEasyLabel:    'Recruit',   combatReadinessEasyTag:    'EASY',   combatReadinessEasyStars:    '★★★☆☆', combatReadinessEasyFlavor:    'Direct recall questions.',
  combatReadinessMediumLabel:  'Operative', combatReadinessMediumTag:  'MEDIUM', combatReadinessMediumStars:  '★★★★☆', combatReadinessMediumFlavor:  'Contextual, deeper questions.',
}

function ContentTab({ API }) {
  const [draft,       setDraft]       = useState({})
  const [modal,       setModal]       = useState(null)
  const [toast,       setToast]       = useState('')
  const [emailBusy,   setEmailBusy]   = useState(false)
  const { apiFetch } = useAuth()

  const load = useCallback(() => {
    apiFetch(`${API}/api/admin/settings`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (d.data?.settings) {
          const s = d.data.settings
          // Pre-populate any empty fields with hardcoded defaults so inputs aren't blank on first visit
          const merged = { ...s }
          Object.entries({ ...EMAIL_DEFAULTS, ...CR_DEFAULTS }).forEach(([k, v]) => {
            if (!merged[k]) merged[k] = v
          })
          setDraft(merged)
        }
      })
  }, [API])

  useEffect(() => { load() }, [load])

  const save = (label, fields) => setModal({ label, fields })

  const confirmSave = async (reason) => {
    const updates = {}
    modal.fields.forEach(f => { updates[f] = draft[f] })
    await apiFetch(`${API}/api/admin/settings`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...updates, reason }),
    })
    setModal(null)
    setToast(`✓ ${modal.label} saved`)
    load()
  }

  const sendTestEmail = async () => {
    setEmailBusy(true)
    try {
      const res  = await apiFetch(`${API}/api/admin/test-email`, { method: 'POST', credentials: 'include' })
      const data = await res.json()
      setToast(data.status === 'success' ? `✓ ${data.message}` : `✗ ${data.message}`)
    } catch {
      setToast('✗ Failed to send test email')
    } finally {
      setEmailBusy(false)
    }
  }

  const field = (key, label, placeholder, rows) => (
    <div key={key} className="py-2.5 border-b border-slate-100 last:border-0">
      <label className="block text-xs font-semibold text-slate-500 mb-1">{label}</label>
      {rows ? (
        <textarea rows={rows} placeholder={placeholder} value={draft[key] ?? ''}
          onChange={e => setDraft(p => ({ ...p, [key]: e.target.value }))}
          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none outline-none focus:ring-2 focus:ring-brand-200" />
      ) : (
        <input type="text" placeholder={placeholder} value={draft[key] ?? ''}
          onChange={e => setDraft(p => ({ ...p, [key]: e.target.value }))}
          className="w-full border border-slate-400 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-600/40 bg-surface-raised text-text" />
      )}
    </div>
  )

  return (
    <div>
      <AnimatePresence>{toast && <Toast msg={toast} onClear={() => setToast('')} />}</AnimatePresence>
      {modal && <ConfirmModal title={modal.label} onConfirm={confirmSave} onCancel={() => setModal(null)} />}

      {/* ── Welcome Email ─────────────────────────────────────────── */}
      <Section title="Welcome Email" collapsible onSave={() => save('Update Welcome Email', ['emailWelcomeEnabled', 'welcomeEmailSubject', 'welcomeEmailHeading', 'welcomeEmailBody', 'welcomeEmailCta', 'welcomeEmailFooter'])}>
        <Toggle
          label="Send welcome email"
          hint="When off, new users will not receive a welcome email after registering"
          checked={draft.emailWelcomeEnabled !== false}
          onChange={v => setDraft(p => ({ ...p, emailWelcomeEnabled: v }))}
        />
        {field('welcomeEmailSubject', 'Subject',  EMAIL_DEFAULTS.welcomeEmailSubject)}
        {field('welcomeEmailHeading', 'Heading',  EMAIL_DEFAULTS.welcomeEmailHeading)}
        {field('welcomeEmailBody',    'Body',     EMAIL_DEFAULTS.welcomeEmailBody, 4)}
        {field('welcomeEmailCta',     'CTA text', EMAIL_DEFAULTS.welcomeEmailCta)}
        {field('welcomeEmailFooter',  'Footer',   EMAIL_DEFAULTS.welcomeEmailFooter, 2)}
        <div className="pt-3">
          <button
            onClick={sendTestEmail}
            disabled={emailBusy}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition-colors disabled:opacity-40"
          >
            {emailBusy ? 'Sending…' : '✉ Send Test Email'}
          </button>
          <p className="text-[11px] text-slate-400 mt-1.5">Sends a test email using the current saved content to your admin email address.</p>
        </div>
      </Section>

      {/* ── Difficulty Select Screen ─────────────────────────────── */}
      <Section title="Difficulty Select Screen" collapsible onSave={() => save('Update Combat Readiness Screen', [
        'combatReadinessTitle', 'combatReadinessSubtitle',
        'combatReadinessEasyLabel', 'combatReadinessEasyTag', 'combatReadinessEasyStars', 'combatReadinessEasyFlavor',
        'combatReadinessMediumLabel', 'combatReadinessMediumTag', 'combatReadinessMediumStars', 'combatReadinessMediumFlavor',
      ])}>
        {field('combatReadinessTitle',    'Title',    CR_DEFAULTS.combatReadinessTitle)}
        {field('combatReadinessSubtitle', 'Subtitle', CR_DEFAULTS.combatReadinessSubtitle)}
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest pt-3 pb-1">Easy Option</p>
        {field('combatReadinessEasyLabel',  'Label',  CR_DEFAULTS.combatReadinessEasyLabel)}
        {field('combatReadinessEasyTag',    'Tag',    CR_DEFAULTS.combatReadinessEasyTag)}
        {field('combatReadinessEasyStars',  'Stars',  CR_DEFAULTS.combatReadinessEasyStars)}
        {field('combatReadinessEasyFlavor', 'Flavour text', CR_DEFAULTS.combatReadinessEasyFlavor, 2)}
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest pt-3 pb-1">Medium Option</p>
        {field('combatReadinessMediumLabel',  'Label',  CR_DEFAULTS.combatReadinessMediumLabel)}
        {field('combatReadinessMediumTag',    'Tag',    CR_DEFAULTS.combatReadinessMediumTag)}
        {field('combatReadinessMediumStars',  'Stars',  CR_DEFAULTS.combatReadinessMediumStars)}
        {field('combatReadinessMediumFlavor', 'Flavour text', CR_DEFAULTS.combatReadinessMediumFlavor, 2)}
      </Section>

      {/* ── Tutorials ─────────────────────────────────────────────── */}
      <TutorialsEditor
        API={API}
        ConfirmModal={ConfirmModal}
        Toast={Toast}
        CollapsibleBox={CollapsibleBox}
      />

      {/* ── AI Prompts ────────────────────────────────────────────── */}
      <AiPromptsSection API={API} />

      {/* ── Socials ──────────────────────────────────────────────── */}
      <SocialsSection API={API} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SUBSCRIPTION EMULATOR
// ─────────────────────────────────────────────────────────────────────────────

const TIERS = ['free', 'trial', 'silver', 'gold']
const TIER_LABELS = { free: 'Free', trial: 'Trial (Silver)', silver: 'Silver', gold: 'Gold' }
const TIER_BTN = {
  free:   'bg-slate-100 text-slate-700 border-slate-200',
  trial:  'bg-amber-50  text-amber-700  border-amber-200',
  silver: 'bg-slate-200 text-slate-700  border-slate-300',
  gold:   'bg-yellow-50 text-yellow-700 border-yellow-200',
}

function SubEmulator({ user, API, onTierChange }) {
  const { apiFetch } = useAuth()
  const [busy, setBusy] = useState(false)
  const effectiveTier = (user.subscriptionTier === 'trial' && !user.isTrialActive)
    ? 'free'
    : (user.subscriptionTier ?? 'free')
  const setTier = async (tier) => {
    if (tier === effectiveTier || busy) return
    setBusy(true)
    const res  = await apiFetch(`${API}/api/admin/self/subscription`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier }),
    })
    const data = await res.json()
    if (data.status === 'success') onTierChange(data.data.user)
    setBusy(false)
  }
  return (
    <div className="bg-slate-900 rounded-2xl px-4 py-3 mb-6 flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Subscription Emulator</p>
        <p className="text-xs text-slate-500 mt-0.5">Test how each tier experiences the app</p>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {TIERS.map(tier => (
          <button
            key={tier}
            onClick={() => setTier(tier)}
            disabled={busy}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all
              ${effectiveTier === tier
                ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900 scale-105 ' + TIER_BTN[tier]
                : TIER_BTN[tier] + ' opacity-60 hover:opacity-100'
              }`}
          >
            {TIER_LABELS[tier]}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERATE BASES BUTTON
// ─────────────────────────────────────────────────────────────────────────────

function GenerateSectionLinksButton({ sourceTitle, sourceDescription, sourceCategory, linkType, pool, isHistoric, briefId, API, onResult }) {
  const { apiFetch } = useAuth()
  const [status, setStatus] = useState(null) // null | 'loading' | 'done' | 'error'
  const [msg, setMsg]       = useState('')

  const generate = async () => {
    if (!sourceTitle) { setStatus('error'); setMsg('Brief needs a title first'); return }
    if (!pool.length) { setStatus('error'); setMsg('No briefs loaded yet'); return }
    setStatus('loading')
    setMsg('')
    try {
      const res  = await apiFetch(`${API}/api/admin/ai/generate-links`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceTitle,
          sourceDescription,
          sourceCategory,
          linkType,
          pool: pool.map(b => ({ _id: b._id, title: b.title })),
          isHistoric: isHistoric ?? false,
          briefId: briefId || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Failed')
      const ids = data.data?.ids ?? []
      onResult(ids)
      setStatus('done')
      setMsg(ids.length ? `${ids.length} selected` : 'None matched')
    } catch (err) {
      setStatus('error')
      setMsg(err.message.slice(0, 60))
    }
  }

  return (
    <div className="flex items-center gap-2 shrink-0">
      {msg && (
        <span className={`text-[10px] ${status === 'error' ? 'text-red-500' : 'text-emerald-600'}`}>{msg}</span>
      )}
      <button
        onClick={generate}
        disabled={status === 'loading'}
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 transition-all"
      >
        {status === 'loading' ? '…' : '✦ Generate'}
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// BRIEFS TAB
// ─────────────────────────────────────────────────────────────────────────────

// Canonical empty descriptionSections row — {heading, body} object.
const EMPTY_SECTION_ROW = () => ({ heading: '', body: '' })
// Normalize any descriptionSections payload (legacy strings or {heading, body})
// to the canonical editor shape so the draft state is always consistent.
function normalizeDraftSections(sections) {
  if (!Array.isArray(sections) || sections.length === 0) {
    return [EMPTY_SECTION_ROW(), EMPTY_SECTION_ROW(), EMPTY_SECTION_ROW()]
  }
  return sections.map(s => {
    if (typeof s === 'string') return { heading: '', body: s }
    return {
      heading: typeof s?.heading === 'string' ? s.heading : '',
      body:    typeof s?.body    === 'string' ? s.body    : '',
    }
  })
}

const EMPTY_DRAFT = {
  title: '', nickname: '', subtitle: '', category: 'News', subcategory: '', historic: false, eventDate: null,
  priorityNumber: null,
  status: 'published',
  flaggedForEdit: false,
  descriptionSections: [EMPTY_SECTION_ROW(), EMPTY_SECTION_ROW(), EMPTY_SECTION_ROW()],
  keywords: [],
  sources: [],
  gameData: {},
  mnemonics: {},
  associatedBaseBriefIds:     [],
  associatedSquadronBriefIds: [],
  associatedAircraftBriefIds: [],
  associatedTechBriefIds:     [],
  relatedBriefIds:            [],
  relatedHistoric:            [],
}

const BOO_CATEGORIES = ['Aircrafts', 'Ranks', 'Training', 'Missions', 'Tech', 'Treaties', 'Bases', 'Squadrons', 'Threats']

// Rough duplicate detection — returns true if headline is similar to an existing title
function isSimilarTitle(headline, existingTitles) {
  const h = headline.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
  return existingTitles.some(t => {
    const e = t.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
    if (e === h) return true
    // Overlap: if >60% of words in the headline appear in the existing title
    const hWords = h.split(' ').filter(w => w.length > 3)
    if (!hWords.length) return false
    const matches = hWords.filter(w => e.includes(w))
    return matches.length / hWords.length >= 0.6
  })
}

function LeadRow({ lead, picked, busy, stubBusy, onGenerate, onCreateStub }) {
  const isPublished = lead.isPublished ?? false
  const hasBrief    = lead.hasBrief    ?? false
  return (
    <div className={`flex items-start justify-between gap-3 py-2 px-3 rounded-xl mb-1 transition-colors ${
      isPublished ? 'opacity-50' : picked?.title === lead.title ? 'bg-amber-50 border border-amber-200' : 'hover:bg-slate-50'
    }`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className={`text-sm ${isPublished ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{lead.title}</p>
          {isPublished && <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full shrink-0">✓ Generated</span>}
        </div>
        {lead.nickname && (
          <p className="text-[11px] text-slate-400 mt-0.5">"{lead.nickname}"</p>
        )}
        {lead.subtitle && (
          <p className="text-[11px] text-slate-400 mt-0.5 truncate">{lead.subtitle}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {!hasBrief && (
          <button
            onClick={() => onCreateStub(lead)}
            disabled={stubBusy === lead.title}
            title="Create an empty stub brief for this lead (no AI generation)"
            className="text-xs px-3 py-1 rounded-lg border border-slate-300 bg-white text-slate-600 font-semibold whitespace-nowrap hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {stubBusy === lead.title ? '…' : '+ Stub'}
          </button>
        )}
        <button
          onClick={() => onGenerate(lead)}
          disabled={busy === lead.title || isPublished}
          className="text-xs px-3 py-1 rounded-lg border border-brand-300 bg-brand-50 text-brand-700 font-semibold whitespace-nowrap hover:bg-brand-100 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy === lead.title ? '…' : 'Generate →'}
        </button>
      </div>
    </div>
  )
}

function NewsModal({ API, onClose, onGenerate }) {
  const { apiFetch } = useAuth()
  const [headlines,      setHeadlines]      = useState([])
  const [existingTitles, setExistingTitles] = useState([])
  const [newsBusy,       setNewsBusy]       = useState(false)
  const [busy,           setBusy]           = useState(null)
  const [dupConfirm,     setDupConfirm]     = useState(null) // { headline, eventDate } awaiting confirmation
  const [newsDate,       setNewsDate]       = useState(() => new Date().toISOString().slice(0, 10))
  // Bulk news generation
  const [bulkNewsOpen,      setBulkNewsOpen]      = useState(false)
  const [bulkNewsMonth,     setBulkNewsMonth]     = useState(() => new Date().toISOString().slice(0, 7))
  const [bulkNewsHeadlines, setBulkNewsHeadlines] = useState([])
  const [bulkNewsSelected,  setBulkNewsSelected]  = useState(new Set())
  const [bulkNewsRunning,   setBulkNewsRunning]   = useState(false)
  const [bulkNewsLog,       setBulkNewsLog]       = useState([])
  const bulkNewsCancelRef = useRef(false)
  const bulkNewsLogRef    = useRef(null)

  useEffect(() => {
    // Pre-load existing titles for duplicate detection
    fetch(`${API}/api/admin/briefs/titles`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d.status === 'success') setExistingTitles(d.data.titles.map(t => t.title)) })
      .catch(() => {})
  }, [API])

  const generate = async (headline, eventDate) => {
    setBusy(headline)
    try {
      const todayStr = new Date().toISOString().slice(0, 10)
      const res  = await apiFetch(`${API}/api/admin/ai/generate-brief`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headline, eventDate, isHistoric: !!(eventDate && eventDate !== todayStr) }),
      })
      const data = await res.json()
      if (data.status === 'success') {
        onGenerate(data.data.brief, null)
        onClose()
      } else {
        alert(`Generation failed: ${data.message}`)
      }
    } finally {
      setBusy(null)
    }
  }

  const fetchHeadlines = async () => {
    setNewsBusy(true)
    setHeadlines([])
    try {
      const res  = await apiFetch(`${API}/api/admin/ai/news-headlines`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: newsDate }),
      })
      const data = await res.json()
      if (!res.ok || data.status !== 'success') {
        alert(`Headlines fetch failed: ${data.message ?? res.status}`)
        return
      }
      setHeadlines(data.data.headlines ?? [])
    } finally {
      setNewsBusy(false)
    }
  }

  const handleHeadlineClick = (headline, eventDate) => {
    if (isSimilarTitle(headline, existingTitles)) {
      setDupConfirm({ headline, eventDate })
    } else {
      generate(headline, eventDate)
    }
  }

  const fetchBulkNewsHeadlines = async () => {
    setBulkNewsHeadlines([])
    setBulkNewsSelected(new Set())
    setBulkNewsLog([])
    setNewsBusy(true)
    try {
      const res  = await apiFetch(`${API}/api/admin/ai/news-headlines-month`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: bulkNewsMonth }),
      })
      const data = await res.json()
      if (!res.ok || data.status !== 'success') {
        alert(`Bulk headlines fetch failed: ${data.message ?? res.status}`)
        return
      }
      const items = data.data.headlines ?? []
      setBulkNewsHeadlines(items)
      if (!items.length) {
        const sample = data.data.rawSample
          ? `\n\nWhat the AI actually returned:\n\n${data.data.rawSample}`
          : ''
        alert(`The AI returned ${data.data.rawCount ?? 0} headline(s) for ${bulkNewsMonth}, none usable.${sample}`)
      }
      // Default: select all non-duplicates
      const defaultSelected = new Set(
        items.reduce((acc, item, i) => {
          if (!isSimilarTitle(item.headline, existingTitles)) acc.push(i)
          return acc
        }, [])
      )
      setBulkNewsSelected(defaultSelected)
    } finally {
      setNewsBusy(false)
    }
  }

  const handleBulkNewsGenerate = async () => {
    const selected = [...bulkNewsSelected].sort((a, b) => a - b).filter(i => i < bulkNewsHeadlines.length)
    if (!selected.length) return
    setBulkNewsRunning(true)
    bulkNewsCancelRef.current = false
    setBulkNewsLog(selected.map(i => ({
      idx: i,
      headline: bulkNewsHeadlines[i].headline,
      status: 'pending',
      startedAt: null,
      completedAt: null,
      warnings: [],
      error: null,
    })))
    const updateEntry = (idx, patch) => {
      setBulkNewsLog(prev => prev.map(e => e.idx === idx ? { ...e, ...patch } : e))
      setTimeout(() => {
        if (bulkNewsLogRef.current) bulkNewsLogRef.current.scrollTop = bulkNewsLogRef.current.scrollHeight
      }, 50)
    }
    for (const idx of selected) {
      if (bulkNewsCancelRef.current) break
      const item = bulkNewsHeadlines[idx]
      updateEntry(idx, { status: 'running', startedAt: Date.now() })
      try {
        const res  = await apiFetch(`${API}/api/admin/ai/bulk-generate-news-item`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ headline: item.headline, eventDate: item.eventDate }),
        })
        const data = await res.json()
        if (!res.ok || data.status !== 'success') {
          updateEntry(idx, { status: 'error', completedAt: Date.now(), error: data.message ?? 'Unknown error' })
        } else {
          updateEntry(idx, { status: 'done', completedAt: Date.now(), warnings: data.warnings ?? [] })
        }
      } catch (err) {
        updateEntry(idx, { status: 'error', completedAt: Date.now(), error: err.message })
      }
    }
    setBulkNewsRunning(false)
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh] relative" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-slate-700">📡 News</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 px-4 py-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center gap-2 flex-1">
              <label className="text-xs text-slate-500 whitespace-nowrap">Date</label>
              <input
                type="date"
                value={newsDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={e => { setNewsDate(e.target.value); setHeadlines([]) }}
                className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 focus:outline-none focus:border-brand-400"
              />
              {newsDate !== new Date().toISOString().slice(0, 10) && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Historic</span>
              )}
            </div>
            <button
              onClick={fetchHeadlines}
              disabled={newsBusy}
              className="text-xs px-3 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {newsBusy ? '⏳ Fetching…' : '🔄 Fetch Headlines'}
            </button>
          </div>

          {headlines.length === 0 && !newsBusy && (
            <p className="text-sm text-slate-400 text-center py-8">Select a date and press "Fetch Headlines".</p>
          )}

          {newsBusy && (
            <div className="space-y-2">
              {[1,2,3].map(i => (
                <div key={i} className="h-12 bg-slate-100 rounded-xl animate-pulse" />
              ))}
            </div>
          )}

          <div className="space-y-2">
            {headlines.map((item, i) => {
              const isDup = isSimilarTitle(item.headline, existingTitles)
              return (
                <div
                  key={i}
                  className={`flex items-start gap-3 px-3 py-2.5 rounded-xl border transition-all
                    ${isDup ? 'border-slate-200 bg-slate-50 opacity-60' : 'border-slate-200 bg-surface hover:border-brand-300 hover:bg-brand-50/30'}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold leading-snug ${isDup ? 'text-slate-400' : 'text-slate-800'}`}>
                      {item.headline}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {item.eventDate && (
                        <span className="text-[10px] text-slate-400 font-medium">{item.eventDate}</span>
                      )}
                      {isDup && (
                        <span className="text-[10px] text-amber-600 font-semibold">⚠️ Possible duplicate brief</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleHeadlineClick(item.headline, item.eventDate)}
                    disabled={busy === item.headline}
                    className={`shrink-0 text-xs px-3 py-1.5 rounded-lg font-bold transition-colors whitespace-nowrap
                      ${isDup
                        ? 'border border-slate-300 text-slate-500 hover:bg-slate-100'
                        : 'border border-brand-300 bg-brand-50 text-brand-700 hover:bg-brand-100'
                      } disabled:opacity-40`}
                  >
                    {busy === item.headline ? '…' : isDup ? 'Create anyway' : 'Generate →'}
                  </button>
                </div>
              )
            })}
          </div>

          {/* ── Bulk Month Generate ─────────────────────────────────────── */}
          <div className="mt-4 rounded-xl border border-slate-200 overflow-hidden">
            <button
              onClick={() => { if (!bulkNewsRunning) setBulkNewsOpen(o => !o) }}
              className={`w-full flex items-center justify-between px-4 py-3 text-sm font-semibold transition-colors ${bulkNewsRunning ? 'cursor-default' : 'hover:bg-slate-50'} text-slate-700`}
            >
              <span className="flex items-center gap-2">
                {bulkNewsRunning
                  ? <span className="inline-block w-2 h-2 rounded-full bg-brand-600 animate-pulse" />
                  : '📅'}
                {bulkNewsRunning
                  ? `Generating ${bulkNewsLog.filter(e => e.status === 'done' || e.status === 'error').length + 1} of ${bulkNewsLog.length}…`
                  : 'Bulk Month Generate'}
              </span>
              {!bulkNewsRunning && <span className="text-slate-400 text-xs">{bulkNewsOpen ? '▲' : '▼'}</span>}
            </button>

            {bulkNewsOpen && (
              <div className="border-t border-slate-200 px-4 py-4">
                {/* Controls */}
                <div className={`transition-opacity duration-200 ${bulkNewsRunning ? 'opacity-40 pointer-events-none' : ''}`}>
                  <p className="text-xs font-semibold text-slate-500 mb-2">Fetch top 10 RAF headlines for a month:</p>
                  <div className="flex items-center gap-2 mb-4">
                    <input
                      type="month"
                      value={bulkNewsMonth}
                      max={new Date().toISOString().slice(0, 7)}
                      onChange={e => { setBulkNewsMonth(e.target.value); setBulkNewsHeadlines([]); setBulkNewsSelected(new Set()); setBulkNewsLog([]) }}
                      className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 focus:outline-none focus:border-brand-400"
                    />
                    <button
                      onClick={fetchBulkNewsHeadlines}
                      disabled={newsBusy}
                      className="text-xs px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-bold transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                      {newsBusy ? '⏳ Fetching…' : '🔄 Fetch Top 10'}
                    </button>
                  </div>

                  {bulkNewsHeadlines.length > 0 && (
                    <>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold text-slate-500">
                          {bulkNewsSelected.size} of {bulkNewsHeadlines.length} selected
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setBulkNewsSelected(new Set(bulkNewsHeadlines.map((_, i) => i)))}
                            className="text-[10px] text-brand-600 hover:underline"
                          >All</button>
                          <button
                            onClick={() => setBulkNewsSelected(new Set())}
                            className="text-[10px] text-slate-400 hover:underline"
                          >None</button>
                        </div>
                      </div>
                      <div className="space-y-1.5 mb-4">
                        {bulkNewsHeadlines.map((item, i) => {
                          const isDup = isSimilarTitle(item.headline, existingTitles)
                          const checked = bulkNewsSelected.has(i)
                          return (
                            <label
                              key={i}
                              className={`flex items-start gap-2.5 px-3 py-2 rounded-xl border cursor-pointer transition-all
                                ${isDup ? 'border-slate-200 bg-slate-50 opacity-60' : checked ? 'border-brand-300 bg-brand-50/40' : 'border-slate-200 bg-surface hover:border-slate-300'}`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={e => {
                                  setBulkNewsSelected(prev => {
                                    const next = new Set(prev)
                                    e.target.checked ? next.add(i) : next.delete(i)
                                    return next
                                  })
                                }}
                                className="mt-0.5 accent-brand-600 shrink-0"
                              />
                              <div className="flex-1 min-w-0">
                                <p className={`text-xs font-semibold leading-snug ${isDup ? 'text-slate-400' : 'text-slate-800'}`}>
                                  {item.headline}
                                </p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  {item.eventDate && (
                                    <span className="text-[10px] text-slate-400">{item.eventDate}</span>
                                  )}
                                  {isDup && (
                                    <span className="text-[10px] text-amber-600 font-semibold">⚠️ Possible duplicate</span>
                                  )}
                                </div>
                              </div>
                            </label>
                          )
                        })}
                      </div>
                    </>
                  )}
                </div>

                {/* Action button */}
                {bulkNewsHeadlines.length > 0 && (
                  <div className="flex items-center gap-3 mb-0">
                    {!bulkNewsRunning ? (
                      <button
                        onClick={handleBulkNewsGenerate}
                        disabled={bulkNewsSelected.size === 0}
                        className="text-xs px-4 py-1.5 rounded-lg bg-brand-600 text-white font-semibold hover:bg-brand-700 transition-colors disabled:opacity-40"
                      >
                        Generate Selected ({bulkNewsSelected.size})
                      </button>
                    ) : (
                      <button
                        onClick={() => { bulkNewsCancelRef.current = true }}
                        className="text-xs px-4 py-1.5 rounded-lg border border-red-300 text-red-600 font-semibold hover:bg-red-50 transition-colors"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                )}

                {/* Terminal log */}
                {bulkNewsLog.length > 0 && (
                  <div className="mt-4">
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-brand-600 rounded-full transition-all duration-500"
                          style={{ width: bulkNewsLog.length > 0 ? `${(bulkNewsLog.filter(e => e.status === 'done' || e.status === 'error').length / bulkNewsLog.length) * 100}%` : '0%' }}
                        />
                      </div>
                      <span className="text-[10px] text-slate-400 tabular-nums shrink-0">
                        {bulkNewsLog.filter(e => e.status === 'done' || e.status === 'error').length}/{bulkNewsLog.length}
                      </span>
                    </div>
                    <div
                      ref={bulkNewsLogRef}
                      className="bg-slate-900 rounded-xl p-3 font-mono text-[11px] max-h-64 overflow-y-auto space-y-0.5 select-text"
                    >
                      {bulkNewsLog.map(entry => {
                        const ts = entry.startedAt
                          ? new Date(entry.startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                          : '--:--:--'
                        const dur = (entry.completedAt && entry.startedAt)
                          ? `(${Math.round((entry.completedAt - entry.startedAt) / 1000)}s)`
                          : ''
                        const icon =
                          entry.status === 'done'    ? '✓' :
                          entry.status === 'error'   ? '✗' :
                          entry.status === 'running' ? '⟳' : '○'
                        const iconCls =
                          entry.status === 'done'    ? 'text-emerald-400' :
                          entry.status === 'error'   ? 'text-red-400' :
                          entry.status === 'running' ? 'text-cyan-400 animate-pulse' :
                          'text-slate-600'
                        const titleCls =
                          entry.status === 'running' ? 'text-slate-100' :
                          entry.status === 'done'    ? 'text-slate-300' :
                          entry.status === 'error'   ? 'text-slate-300' :
                          'text-slate-600'
                        return (
                          <div key={entry.idx} className="leading-5">
                            <div className="flex items-baseline gap-2">
                              <span className="text-slate-600 shrink-0">[{ts}]</span>
                              <span className={`shrink-0 ${iconCls}`}>{icon}</span>
                              <span className={`${titleCls} truncate`}>{entry.headline}</span>
                              {dur && <span className="text-slate-600 shrink-0">{dur}</span>}
                            </div>
                            {entry.status === 'error' && entry.error && (
                              <div className="text-red-400 italic pl-[7.5rem] leading-4 mt-0.5 whitespace-pre-wrap break-all">{entry.error}</div>
                            )}
                            {entry.warnings?.map((w, wi) => (
                              <div key={wi} className="text-amber-400 pl-[7.5rem] leading-4 mt-0.5 whitespace-pre-wrap break-all">⚠ {w}</div>
                            ))}
                          </div>
                        )
                      })}
                      {!bulkNewsRunning && bulkNewsLog.filter(e => e.status === 'done' || e.status === 'error').length === bulkNewsLog.length && bulkNewsLog.length > 0 && (
                        <div className="text-slate-500 mt-1 pt-1 border-t border-slate-700">
                          — {bulkNewsLog.filter(e => e.status === 'done').length} succeeded · {bulkNewsLog.filter(e => e.status === 'error').length} failed
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Duplicate confirmation overlay */}
        {dupConfirm && (
          <div className="absolute inset-0 bg-surface/95 rounded-2xl flex flex-col items-center justify-center p-6 text-center z-10">
            <p className="text-2xl mb-3">⚠️</p>
            <p className="font-bold text-slate-800 mb-2">Possible Duplicate</p>
            <p className="text-sm text-slate-500 mb-6 max-w-xs">
              A brief with a similar title already exists. Generate anyway?
            </p>
            <p className="text-xs font-semibold text-slate-700 bg-slate-100 rounded-xl px-3 py-2 mb-6 max-w-xs">
              "{dupConfirm?.headline}"
            </p>
            <div className="flex gap-3 w-full max-w-xs">
              <button onClick={() => setDupConfirm(null)} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold text-sm hover:bg-slate-50">
                Cancel
              </button>
              <button
                onClick={() => { const d = dupConfirm; setDupConfirm(null); generate(d.headline, d.eventDate) }}
                className="flex-1 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-sm"
              >
                Generate Anyway
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function LeadsModal({ API, onClose, onGenerate, onReset, initialSearch = '' }) {
  const { apiFetch } = useAuth()
  const [leads,           setLeads]           = useState([])
  const [search,          setSearch]          = useState(initialSearch)
  const [picked,          setPicked]          = useState(null)
  const [busy,            setBusy]            = useState(null)
  const [openSections,    setOpenSections]    = useState(new Set())
  const [openSubsections, setOpenSubsections] = useState(new Set())
  const [resetBusy,       setResetBusy]       = useState(false)
  const [resetModal,      setResetModal]      = useState(false)
  const [showCompleted,   setShowCompleted]   = useState(false)
  const [stubBusy,        setStubBusy]        = useState(null)
  const [syncBusy,        setSyncBusy]        = useState(false)

  const toggleSection = (sec) => setOpenSections(prev => {
    const next = new Set(prev); next.has(sec) ? next.delete(sec) : next.add(sec); return next
  })
  const toggleSubsection = (key) => setOpenSubsections(prev => {
    const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next
  })

  useEffect(() => {
    // Backfill isPublished on leads that already have a generated brief, then load
    fetch(`${API}/api/admin/intel-leads/backfill-published`, { method: 'POST', credentials: 'include' })
      .catch(() => {})
      .finally(() => {
        fetch(`${API}/api/admin/intel-leads`, { credentials: 'include' })
          .then(r => r.json())
          .then(d => { if (d.status === 'success') setLeads(d.data.leads) })
          .catch(() => {})
      })
  }, [API])

  const filtered = leads.filter(l => {
    if (showCompleted && !l.isPublished) return false
    if (!search) return true
    return (
      (l.title ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (l.nickname ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (l.section ?? '').toLowerCase().includes(search.toLowerCase())
    )
  })

  const publishedCount   = leads.filter(l => l.isPublished).length
  const unpublishedCount = leads.length - publishedCount

  const pickRandom = () => {
    const pool = filtered.filter(l => !l.isPublished)
    if (!pool.length) return
    const lead = pool[Math.floor(Math.random() * pool.length)]
    setPicked(lead)
    // Ensure the section and subsection containing this lead are open
    const sec = lead.section || 'General'
    const sub = lead.subsection || ''
    setOpenSections(prev => { const next = new Set(prev); next.add(sec); return next })
    if (sub) setOpenSubsections(prev => { const next = new Set(prev); next.add(`${sec}::${sub}`); return next })
  }

  const generate = async (lead) => {
    setBusy(lead.title)
    try {
      const res  = await apiFetch(`${API}/api/admin/ai/generate-brief`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic:       lead.title,
          category:    lead.category ?? 'News',
          subcategory: lead.subcategory ?? '',
        }),
      })
      const data = await res.json()
      if (data.status === 'success') {
        onGenerate(data.data.brief, lead)
        onClose()
      } else {
        alert(`Generation failed: ${data.message}`)
      }
    } finally {
      setBusy(null)
    }
  }

  const createStub = async (lead) => {
    setStubBusy(lead.title)
    try {
      const res  = await apiFetch(`${API}/api/admin/intel-leads/${lead._id}/create-stub`, {
        method: 'POST', credentials: 'include',
      })
      const data = await res.json()
      if (data.status === 'success') {
        // Reload leads so hasBrief flips and the button disappears
        const r = await fetch(`${API}/api/admin/intel-leads`, { credentials: 'include' })
        const d = await r.json()
        if (d.status === 'success') setLeads(d.data.leads)
      } else {
        alert(`Stub creation failed: ${data.message}`)
      }
    } catch (err) {
      alert(`Stub creation error: ${err.message}`)
    } finally {
      setStubBusy(null)
    }
  }

  const syncLeadsFromBriefs = async () => {
    // Two-step: dry run first, confirm the diff, then write.
    setSyncBusy(true)
    try {
      const dryRes = await apiFetch(`${API}/api/admin/intel-leads/sync-from-briefs?dryRun=true`, {
        method: 'POST', credentials: 'include',
      })
      const dry = await dryRes.json()
      if (dry.status !== 'success') throw new Error(dry.message ?? 'Dry-run failed')

      if (dry.changedLeads === 0) {
        alert(`All ${dry.matchedBriefs} matched leads already in sync. ${dry.unmatchedLeads} leads have no matching brief.`)
        return
      }

      const ok = window.confirm(
        `Dry run found ${dry.changedLeads} lead(s) to update, across ${dry.totalLeads} total leads (${dry.unmatchedLeads} unmatched).\n\nProceed with the write?`
      )
      if (!ok) return

      const res  = await apiFetch(`${API}/api/admin/intel-leads/sync-from-briefs`, {
        method: 'POST', credentials: 'include',
      })
      const data = await res.json()
      if (data.status !== 'success') throw new Error(data.message ?? 'Sync failed')

      // Reload leads list so the updated fields show immediately
      const r = await fetch(`${API}/api/admin/intel-leads`, { credentials: 'include' })
      const d = await r.json()
      if (d.status === 'success') setLeads(d.data.leads)

      alert(`Synced ${data.changedLeads} lead(s) from briefs.`)
    } catch (err) {
      alert(`Sync error: ${err.message}`)
    } finally {
      setSyncBusy(false)
    }
  }

  const resetLeads = async (reason) => {
    setResetModal(false)
    setResetBusy(true)
    try {
      const res  = await apiFetch(`${API}/api/admin/leads/reset`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      const data = await res.json()
      if (data.status === 'success') {
        // Reload the leads list
        fetch(`${API}/api/admin/intel-leads`, { credentials: 'include' })
          .then(r => r.json())
          .then(d => { if (d.status === 'success') setLeads(d.data.leads) })
          .catch(() => {})
        onReset?.()
        alert(`Reset complete: ${data.data.leadsInserted} leads, ${data.data.stubsCreated} stub briefs`)
      } else {
        alert(`Reset failed: ${data.message}`)
      }
    } catch (err) {
      alert(`Reset error: ${err.message}`)
    } finally {
      setResetBusy(false)
    }
  }

  // Group leads by section → subsection
  const grouped = {}
  for (const l of filtered) {
    const sec = l.section || 'General'
    const sub = l.subsection || ''
    if (!grouped[sec]) grouped[sec] = {}
    if (!grouped[sec][sub]) grouped[sec][sub] = []
    grouped[sec][sub].push(l)
  }

  // When searching, auto-expand everything so results are visible
  const effectiveOpenSections    = search ? new Set(Object.keys(grouped)) : openSections
  const effectiveOpenSubsections = search ? new Set(
    Object.entries(grouped).flatMap(([sec, subs]) => Object.keys(subs).map(sub => `${sec}::${sub}`))
  ) : openSubsections

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-slate-700">📋 Leads</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">✕</button>
        </div>

        <div className="px-4 pt-3 pb-2 flex gap-2">
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search leads…"
                className="flex-1 border border-slate-200 rounded-xl px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-200"
              />
              <button onClick={pickRandom} className="text-xs px-3 py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-700 font-semibold transition-colors hover:bg-amber-100">
                Pick Random
              </button>
            </div>
            <div className="px-4 pb-2 flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setResetModal(true)}
                disabled={resetBusy}
                className="text-xs px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 text-red-600 font-semibold hover:bg-red-100 transition-colors disabled:opacity-50"
              >
                {resetBusy ? '…Resetting' : '🔄 Reset All Leads & Stubs'}
              </button>
              <button
                onClick={syncLeadsFromBriefs}
                disabled={syncBusy}
                className="text-xs px-3 py-1.5 rounded-lg border border-brand-400/60 bg-brand-100 text-brand-600 font-semibold hover:bg-brand-200 transition-colors disabled:opacity-50"
                title="Overwrite each lead's title/subtitle/nickname/category/subcategory/isHistoric from its matching brief. Dry-run first."
              >
                {syncBusy ? '…Syncing' : '↻ Sync Leads From Briefs'}
              </button>
              <button
                onClick={() => setShowCompleted(v => !v)}
                className={`text-xs px-3 py-1.5 rounded-lg border font-semibold transition-colors ${
                  showCompleted
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-surface text-slate-600 border-slate-200 hover:border-emerald-300'
                }`}
              >
                ✓ Generated ({publishedCount})
              </button>
              <span className="text-[10px] text-slate-400 ml-auto">{unpublishedCount} remaining</span>
            </div>
            <div className="overflow-y-auto flex-1 px-4 py-2">
              {Object.entries(grouped).map(([section, subsections]) => {
                const sectionOpen = effectiveOpenSections.has(section)
                const totalCount  = Object.values(subsections).reduce((n, arr) => n + arr.length, 0)
                const subKeys     = Object.keys(subsections)
                const hasSubs     = !(subKeys.length === 1 && subKeys[0] === '')

                return (
                  <div key={section} className="border-b border-slate-100 last:border-b-0">
                    {/* Section header */}
                    <button
                      onClick={() => toggleSection(section)}
                      className="w-full flex items-center justify-between py-3 px-1 text-left group"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{section}</span>
                        <span className="text-[10px] bg-slate-100 text-slate-500 rounded-full px-1.5 py-0.5 font-bold">{totalCount}</span>
                      </div>
                      <span className={`text-slate-400 text-[10px] transition-transform duration-200 ${sectionOpen ? 'rotate-180' : ''}`}>▼</span>
                    </button>

                    {/* Section contents */}
                    <AnimatePresence initial={false}>
                      {sectionOpen && (
                        <motion.div
                          key="section-content"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2, ease: 'easeInOut' }}
                          className="overflow-hidden"
                        >
                          {hasSubs ? (
                            // Two-level: render subsection accordions
                            <div className="pb-2">
                              {subKeys.map(sub => {
                                const subKey  = `${section}::${sub}`
                                const subOpen = effectiveOpenSubsections.has(subKey)
                                const items   = subsections[sub]
                                return (
                                  <div key={sub} className="ml-2 border-l-2 border-slate-100 pl-2 mb-1">
                                    <button
                                      onClick={() => toggleSubsection(subKey)}
                                      className="w-full flex items-center justify-between py-2 px-2 text-left"
                                    >
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{sub || 'General'}</span>
                                        <span className="text-[10px] bg-slate-100 text-slate-400 rounded-full px-1.5 py-0.5 font-bold">{items.length}</span>
                                      </div>
                                      <span className={`text-slate-300 text-[9px] transition-transform duration-200 ${subOpen ? 'rotate-180' : ''}`}>▼</span>
                                    </button>
                                    <AnimatePresence initial={false}>
                                      {subOpen && (
                                        <motion.div
                                          key="sub-content"
                                          initial={{ height: 0, opacity: 0 }}
                                          animate={{ height: 'auto', opacity: 1 }}
                                          exit={{ height: 0, opacity: 0 }}
                                          transition={{ duration: 0.18, ease: 'easeInOut' }}
                                          className="overflow-hidden"
                                        >
                                          {items.map((lead, i) => (
                                            <LeadRow key={i} lead={lead} picked={picked} busy={busy} stubBusy={stubBusy} onGenerate={generate} onCreateStub={createStub} />
                                          ))}
                                        </motion.div>
                                      )}
                                    </AnimatePresence>
                                  </div>
                                )
                              })}
                            </div>
                          ) : (
                            // Single group: render items directly
                            <div className="pb-2">
                              {subsections[''].map((lead, i) => (
                                <LeadRow key={i} lead={lead} picked={picked} busy={busy} stubBusy={stubBusy} onGenerate={generate} onCreateStub={createStub} />
                              ))}
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )
              })}
              {filtered.length === 0 && <p className="text-sm text-slate-400 text-center py-8">No leads found</p>}
            </div>

        {resetModal && (
          <ConfirmModal
            title="Reset All Leads & Stubs"
            body="This wipes all briefs, quiz questions, game data, and reading history — then re-seeds from the leads array. Cannot be undone."
            confirmLabel="Yes, Reset Everything"
            danger
            onConfirm={resetLeads}
            onCancel={() => setResetModal(false)}
          />
        )}
      </div>
    </div>
  )
}

function GeneratingOverlay({ label = 'AI Generation Underway' }) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-white/75 backdrop-blur-[2px] rounded-2xl pointer-events-none">
      <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-xs font-bold text-brand-700 tracking-wide">{label}</p>
    </div>
  )
}

function BriefsTab({ API, initialSearch = '', openLeads = false, editBriefIdOnMount = null, onBootstrapConsumed }) {
  const { apiFetch } = useAuth()
  const { settings: appSettings } = useAppSettings() ?? {}
  const questionsPerDifficulty = appSettings?.aiQuestionsPerDifficulty ?? 7
  const [view,          setView]          = useState('list')
  // List state
  const [briefs,        setBriefs]        = useState([])
  const [total,         setTotal]         = useState(0)
  const [loading,       setLoading]       = useState(false)
  const [page,          setPage]          = useState(1)
  const [search,        setSearch]        = useState('')
  const [category,      setCategory]      = useState('')
  const [subcategory,   setSubcategory]   = useState('')
  const [sort,          setSort]          = useState('default')
  const [hideStubs,     setHideStubs]     = useState(true)
  const [flaggedOnly,   setFlaggedOnly]   = useState(false)
  const [toast,         setToast]         = useState('')
  const [showLeads,     setShowLeads]     = useState(false)
  const [showNews,      setShowNews]      = useState(false)

  useEffect(() => {
    if (openLeads) setShowLeads(true)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Editor state
  const [draft,         setDraft]         = useState({ ...EMPTY_DRAFT, descriptionSections: normalizeDraftSections(null) })
  const [easyQuestions, setEasyQuestions] = useState([])
  const [mediumQuestions,setMediumQuestions] = useState([])
  const [media,         setMedia]         = useState([])
  const [pendingImages, setPendingImages] = useState([])
  const [extractingMediaId, setExtractingMediaId] = useState(null) // mediaId currently running subject extraction
  const [originalPreviewIds, setOriginalPreviewIds] = useState(() => new Set()) // per-row toggle: user explicitly chose to view the original instead of the cutout
  const [qTab,          setQTab]          = useState('easy')
  const [generating,    setGenerating]    = useState(null)
  // Fill-missing flows run concurrently with each other and with full-regen
  // flows, so they need their own booleans instead of sharing `generating`.
  // Previously both used `generating = 'keywords-single' | 'questions-single'`,
  // which clobbered when clicked near-simultaneously and prematurely re-enabled
  // the first button when the second one resolved.
  const [genKeywordsSingle,  setGenKeywordsSingle]  = useState(false)
  const [genQuestionsSingle, setGenQuestionsSingle] = useState(false)
  const [autoGenerating,  setAutoGenerating]  = useState(false)
  const [regeneratingAll, setRegeneratingAll] = useState(false)
  const [saveStatus,    setSaveStatus]    = useState(null)
  const [briefId,       setBriefId]       = useState(null)
  const [pendingLead,   setPendingLead]   = useState(null)
  const [confirmDelete,     setConfirmDelete]     = useState(false)
  const [confirmRegen,      setConfirmRegen]      = useState(false)
  const [confirmDescRegen,  setConfirmDescRegen]  = useState(false)
  const [staleSourceWarning,    setStaleSourceWarning]    = useState(false)
  const [missingGameDataWarning, setMissingGameDataWarning] = useState(false)
  // Section open/close
  const [openSections,  setOpenSections]  = useState({ core: true, desc: false, keywords: false, questions: false, images: false, sources: false, stats: false, linkedBriefs: false })
  const [allBasesBriefs,     setAllBasesBriefs]     = useState([]) // Bases briefs for Aircraft/Squadrons picker
  const [allSquadronsBriefs, setAllSquadronsBriefs] = useState([]) // Squadrons briefs for Bases/Aircraft picker
  const [allAircraftBriefs,  setAllAircraftBriefs]  = useState([]) // Aircraft briefs for Bases/Squadrons/Tech picker
  const [allMissionsBriefs,  setAllMissionsBriefs]  = useState([]) // Missions briefs for Aircrafts/Squadrons picker
  const [allTrainingsBriefs, setAllTrainingsBriefs] = useState([]) // Training briefs for Roles picker
  const [allTechBriefs,      setAllTechBriefs]      = useState([]) // Tech briefs for Aircrafts picker
  const [allRelatedPool,     setAllRelatedPool]     = useState([]) // All non-typed-link briefs for Related picker
  const [relatedSearch,      setRelatedSearch]      = useState('')
  const [dupePanel,          setDupePanel]          = useState(false)
  const [dupeGroups,         setDupeGroups]         = useState(null)
  const [dupesLoading,       setDupesLoading]       = useState(false)
  const keywordsPerBrief = appSettings?.aiKeywordsPerBrief ?? 20

  // ── Bulk auto-generate state ─────────────────────────────────────────────
  const [bulkOpen,     setBulkOpen]     = useState(false)
  const [bulkCats,     setBulkCats]     = useState(new Set(['Bases', 'Aircrafts']))
  const [bulkCount,    setBulkCount]    = useState(5)
  const [bulkRunning,  setBulkRunning]  = useState(false)
  const [bulkLog,      setBulkLog]      = useState([]) // [{ _id, title, category, status, startedAt?, completedAt?, error? }]
  const [bulkTotal,    setBulkTotal]    = useState(0)
  const [bulkDone,     setBulkDone]     = useState(0)
  const bulkCancelRef = useRef(false)
  const bulkLogRef    = useRef(null)

  // Auto-scroll terminal log to bottom on each update
  useEffect(() => {
    if (bulkLogRef.current) bulkLogRef.current.scrollTop = bulkLogRef.current.scrollHeight
  }, [bulkLog])

  const toggleSection = (key) => setOpenSections(p => ({ ...p, [key]: !p[key] }))

  // ── Find duplicates ──────────────────────────────────────────────────────────
  const findDuplicates = async () => {
    setDupesLoading(true)
    setDupePanel(true)
    try {
      const res  = await apiFetch(`${API}/api/admin/briefs/duplicates`, { credentials: 'include' })
      const data = await res.json()
      setDupeGroups(data.data?.duplicates ?? [])
    } catch {
      setDupeGroups([])
    } finally {
      setDupesLoading(false)
    }
  }

  const deleteOlderDupe = async (brief) => {
    await apiFetch(`${API}/api/admin/briefs/${brief._id}`, {
      method: 'DELETE', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Delete duplicate brief' }),
    })
    setToast('Duplicate deleted')
    loadList()
    const res  = await apiFetch(`${API}/api/admin/briefs/duplicates`, { credentials: 'include' })
    const data = await res.json()
    setDupeGroups(data.data?.duplicates ?? [])
  }

  // ── Bulk auto-generate ───────────────────────────────────────────────────
  const handleBulkGenerate = async () => {
    if (bulkCats.size === 0) return
    setBulkOpen(true)
    setBulkRunning(true)
    setBulkLog([])
    setBulkTotal(0)
    setBulkDone(0)
    bulkCancelRef.current = false

    try {
      const cats = [...bulkCats].join(',')
      const res  = await apiFetch(`${API}/api/admin/briefs/stubs-for-bulk?categories=${encodeURIComponent(cats)}&countPerCategory=${bulkCount}`, { credentials: 'include' })
      const data = await res.json()
      const stubs = data.data?.stubs ?? []
      if (!stubs.length) { setToast('No stubs found for selected categories'); setBulkRunning(false); return }

      setBulkTotal(stubs.length)
      setBulkLog(stubs.map(s => ({ _id: s._id, title: s.title, category: s.category, status: 'pending' })))

      let done = 0
      for (const stub of stubs) {
        if (bulkCancelRef.current) break

        const startedAt = Date.now()
        setBulkLog(prev => prev.map(s => s._id === stub._id ? { ...s, status: 'running', startedAt } : s))
        try {
          const r = await apiFetch(`${API}/api/admin/ai/bulk-generate-stub/${stub._id}`, { method: 'POST', credentials: 'include' })
          const d = await r.json()
          if (d.status !== 'success') throw new Error(d.message ?? 'Generation failed')
          setBulkLog(prev => prev.map(s => s._id === stub._id ? { ...s, status: 'done', completedAt: Date.now(), warnings: d.warnings?.length ? d.warnings : null } : s))
        } catch (err) {
          setBulkLog(prev => prev.map(s => s._id === stub._id ? { ...s, status: 'error', completedAt: Date.now(), error: err.message } : s))
        }
        done++
        setBulkDone(done)
      }
    } catch (err) {
      setToast(`Bulk generate failed: ${err.message}`)
    } finally {
      setBulkRunning(false)
      loadList()
    }
  }

  // ── Load list ───────────────────────────────────────────────────────────────
  const loadList = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page, limit: 20 })
      if (search)   params.set('search', search)
      if (category) params.set('category', category)
      if (category && subcategory) params.set('subcategory', subcategory)
      if (sort && sort !== 'default') params.set('sort', sort)
      if (hideStubs) params.set('hideStubs', 'true')
      if (flaggedOnly) params.set('flaggedForEdit', 'true')
      const res  = await apiFetch(`${API}/api/admin/briefs?${params}`, { credentials: 'include' })
      const data = await res.json()
      if (data.status === 'success') {
        setBriefs(data.data.briefs)
        setTotal(data.data.total)
      }
    } finally {
      setLoading(false)
    }
  }, [API, page, search, category, subcategory, sort, hideStubs, flaggedOnly])

  useEffect(() => {
    if (view === 'list') loadList()
  }, [view, loadList])

  // ── Toggle flag-for-edit inline from the list (auto-save, no reason prompt) ──
  const toggleFlagInline = async (b, next) => {
    // Optimistic update so the row flips immediately
    setBriefs(prev => prev.map(x => x._id === b._id ? { ...x, flaggedForEdit: next, flaggedAt: next ? new Date().toISOString() : null } : x))
    try {
      const res  = await apiFetch(`${API}/api/admin/briefs/${b._id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: next ? 'Flag for edit (inline)' : 'Unflag for edit (inline)', flaggedForEdit: next }),
      })
      const data = await res.json()
      if (data.status !== 'success') throw new Error(data.message || 'Flag update failed')
      setToast(next ? '⚑ Flagged for edit' : 'Flag cleared')
      // If the list is filtered to flagged-only, drop the row after unflagging
      if (flaggedOnly && !next) {
        setBriefs(prev => prev.filter(x => x._id !== b._id))
        setTotal(t => Math.max(0, t - 1))
      }
    } catch (err) {
      // Revert on failure
      setBriefs(prev => prev.map(x => x._id === b._id ? { ...x, flaggedForEdit: !next, flaggedAt: b.flaggedAt ?? null } : x))
      setToast('Flag update failed')
    }
  }

  // ── Open brief in editor ─────────────────────────────────────────────────
  const openBrief = async (b) => {
    const res  = await apiFetch(`${API}/api/admin/briefs/${b._id}`, { credentials: 'include' })
    const data = await res.json()
    if (data.status !== 'success') return
    const br = data.data.brief
    setDraft({
      title:               br.title ?? '',
      nickname:            br.nickname ?? '',
      subtitle:            br.subtitle ?? '',
      category:            br.category ?? 'News',
      subcategory:         br.subcategory ?? '',
      historic:            br.historic ?? false,
      eventDate:           br.eventDate ? new Date(br.eventDate).toISOString().slice(0, 10) : null,
      priorityNumber:      br.priorityNumber ?? null,
      status:              br.status ?? 'published',
      flaggedForEdit:      br.flaggedForEdit ?? false,
      flaggedAt:           br.flaggedAt ?? null,
      descriptionSections: normalizeDraftSections(br.descriptionSections),
      keywords:            (br.keywords ?? []).map(k => {
        const linked = k.linkedBriefId
        const linkedId = linked?._id ?? linked ?? null
        return {
          ...k,
          linkedBriefId: linkedId ? String(linkedId) : null,
          linkedBriefTitle: linked?.title ?? null,
        }
      }),
      sources:             br.sources ?? [],
      gameData:            br.gameData ?? {},
      mnemonics:           br.mnemonics ?? {},
      associatedBaseBriefIds:     (br.associatedBaseBriefIds     ?? []).map(b => String(b._id ?? b)),
      associatedSquadronBriefIds: (br.associatedSquadronBriefIds ?? []).map(b => String(b._id ?? b)),
      associatedAircraftBriefIds: (br.associatedAircraftBriefIds ?? []).map(b => String(b._id ?? b)),
      associatedMissionBriefIds:  (br.associatedMissionBriefIds  ?? []).map(b => String(b._id ?? b)),
      associatedTrainingBriefIds: (br.associatedTrainingBriefIds ?? []).map(b => String(b._id ?? b)),
      associatedTechBriefIds:     (br.associatedTechBriefIds     ?? []).map(b => String(b._id ?? b)),
      relatedBriefIds:            (br.relatedBriefIds            ?? []).map(b => String(b._id ?? b)),
      relatedHistoric:            (br.relatedHistoric            ?? []).map(b => String(b._id ?? b)),
    })
    setEasyQuestions(br.quizQuestionsEasy?.map(q => ({
      question: q.question,
      answers: q.answers.map(a => ({ title: a.title })),
      correctAnswerIndex: q.answers.findIndex(a => String(a._id) === String(q.correctAnswerId)),
    })) ?? [])
    setMediumQuestions(br.quizQuestionsMedium?.map(q => ({
      question: q.question,
      answers: q.answers.map(a => ({ title: a.title })),
      correctAnswerIndex: q.answers.findIndex(a => String(a._id) === String(q.correctAnswerId)),
    })) ?? [])
    setMedia(br.media ?? [])
    setPendingImages([])
    setBriefId(String(br._id))
    setQTab('easy')
    setSaveStatus(null)
    setStaleSourceWarning(false)
    // Pre-load briefs for linked-brief pickers
    const needsBases     = ['Aircrafts', 'Squadrons', 'Training', 'Roles'].includes(br.category)
    const needsSquadrons = ['Bases', 'Aircrafts', 'Training'].includes(br.category)
    const needsAircraft  = ['Bases', 'Squadrons', 'Tech'].includes(br.category)
    const needsMissions  = ['Aircrafts', 'Squadrons'].includes(br.category)
    const needsTraining  = ['Roles'].includes(br.category)
    const needsTech      = ['Aircrafts'].includes(br.category)
    const fetches = []
    if (needsBases     && allBasesBriefs.length === 0)
      fetches.push(fetch(`${API}/api/admin/briefs?category=Bases&limit=200`, { credentials: 'include' })
        .then(r => r.json()).then(d => { if (d.data?.briefs) setAllBasesBriefs(d.data.briefs) }).catch(() => {}))
    if (needsSquadrons && allSquadronsBriefs.length === 0)
      fetches.push(fetch(`${API}/api/admin/briefs?category=Squadrons&limit=200`, { credentials: 'include' })
        .then(r => r.json()).then(d => { if (d.data?.briefs) setAllSquadronsBriefs(d.data.briefs) }).catch(() => {}))
    if (needsAircraft  && allAircraftBriefs.length === 0)
      fetches.push(fetch(`${API}/api/admin/briefs?category=Aircrafts&limit=200`, { credentials: 'include' })
        .then(r => r.json()).then(d => { if (d.data?.briefs) setAllAircraftBriefs(d.data.briefs) }).catch(() => {}))
    if (needsMissions  && allMissionsBriefs.length === 0)
      fetches.push(fetch(`${API}/api/admin/briefs?category=Missions&limit=200`, { credentials: 'include' })
        .then(r => r.json()).then(d => { if (d.data?.briefs) setAllMissionsBriefs(d.data.briefs) }).catch(() => {}))
    if (needsTraining  && allTrainingsBriefs.length === 0)
      fetches.push(fetch(`${API}/api/admin/briefs?category=Training&limit=200`, { credentials: 'include' })
        .then(r => r.json()).then(d => { if (d.data?.briefs) setAllTrainingsBriefs(d.data.briefs) }).catch(() => {}))
    if (needsTech      && allTechBriefs.length === 0)
      fetches.push(fetch(`${API}/api/admin/briefs?category=Tech&limit=200`, { credentials: 'include' })
        .then(r => r.json()).then(d => { if (d.data?.briefs) setAllTechBriefs(d.data.briefs) }).catch(() => {}))
    if (allRelatedPool.length === 0)
      fetches.push(fetch(`${API}/api/admin/briefs/related-pool`, { credentials: 'include' })
        .then(r => r.json()).then(d => { if (d.data?.briefs) setAllRelatedPool(d.data.briefs) }).catch(() => {}))
    if (fetches.length) Promise.all(fetches).catch(() => {})
    setRelatedSearch('')
    setView('editor')
  }

  useEffect(() => {
    if (!editBriefIdOnMount) return
    openBrief({ _id: editBriefIdOnMount }).finally(() => {
      onBootstrapConsumed?.()
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const newBrief = () => {
    setDraft({ ...EMPTY_DRAFT, descriptionSections: normalizeDraftSections(null) })
    setEasyQuestions([])
    setMediumQuestions([])
    setMedia([])
    setPendingImages([])
    setBriefId(null)
    setQTab('easy')
    setSaveStatus(null)
    setStaleSourceWarning(false)
    setRelatedSearch('')
    setView('editor')
  }

  // ── Save brief ────────────────────────────────────────────────────────────
  const saveBrief = async () => {
    setSaveStatus('saving')
    try {
      const body = {
        ...draft,
        descriptionSections: draft.descriptionSections
          .filter(s => (s?.body ?? '').trim())
          .map(s => ({ heading: (s.heading ?? '').trim(), body: s.body.trim() })),
        reason: briefId ? 'Admin edit' : 'Admin create',
      }
      const url    = briefId ? `${API}/api/admin/briefs/${briefId}` : `${API}/api/admin/briefs`
      const method = briefId ? 'PATCH' : 'POST'
      const res    = await apiFetch(url, {
        method, credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.status !== 'success') throw new Error(data.message)
      const id = String(data.data.brief._id)
      setBriefId(id)

      // Save questions if present
      if (easyQuestions.length > 0 || mediumQuestions.length > 0) {
        await apiFetch(`${API}/api/admin/briefs/${id}/questions`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ easyQuestions, mediumQuestions }),
        })
      }

      // Add any selected pending images (reuse existing Media doc by mediaId)
      const selected = pendingImages.filter(img => img.selected)
      for (const img of selected) {
        await apiFetch(`${API}/api/admin/briefs/${id}/media`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(img.mediaId
            ? { mediaId: img.mediaId }
            : { mediaType: 'picture', mediaUrl: img.url, cloudinaryPublicId: img.publicId, name: img.wikiPage || img.term }),
        })
      }

      // Reload full brief
      const reloadRes  = await apiFetch(`${API}/api/admin/briefs/${id}`, { credentials: 'include' })
      const reloadData = await reloadRes.json()
      if (reloadData.status === 'success') {
        const br = reloadData.data.brief
        setMedia(br.media ?? [])
        setPendingImages([])
        setDraft(p => ({
          ...p,
          keywords: (br.keywords ?? []).map(k => {
            const linked = k.linkedBriefId
            const linkedId = linked?._id ?? linked ?? null
            return {
              ...k,
              linkedBriefId: linkedId ? String(linkedId) : null,
              linkedBriefTitle: linked?.title ?? null,
            }
          }),
        }))
      }

      // Mark lead complete if applicable
      if (pendingLead) {
        await apiFetch(`${API}/api/admin/intel-leads/mark-complete`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: pendingLead }),
        }).catch(() => {})
        setPendingLead(null)
      }

      setSaveStatus('saved')
      setToast('Saved successfully')
      loadList()
    } catch (err) {
      setSaveStatus('error')
      setToast(`Error: ${err.message}`)
    }
  }

  // ── Delete brief ──────────────────────────────────────────────────────────
  const deleteBrief = async (reason) => {
    const res  = await apiFetch(`${API}/api/admin/briefs/${briefId}`, {
      method: 'DELETE', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
    const data = await res.json()
    setConfirmDelete(false)
    setView('list')
    if (data.leadError) {
      setToast(`Brief deleted — ⚠ Lead file error: ${data.leadError}`)
    } else if (!data.leadUnmarked) {
      setToast('Brief deleted — ⚠ No matching entry found in leads file')
    } else {
      setToast('Brief deleted — lead file updated')
    }
  }

  // ── AI: Generate brief from lead ─────────────────────────────────────────
  const handleLeadGenerate = async (briefData, lead) => {
    // lead is the full { text, section, subsection } object for topic leads, null for news headlines
    const category    = lead ? (lead.category ?? 'News') : 'News'
    const subcategory = lead ? (lead.subcategory ?? '') : ''
    const title       = lead ? lead.title : (briefData.title ?? '')  // always use lead title — never the AI-generated one
    const nickname    = lead ? (lead.nickname ?? '') : (briefData.nickname ?? '')
    const subtitle    = briefData.subtitle ?? ''
    const description = normalizeDraftSections(briefData.descriptionSections)
      .map(s => s.body)
      .join('\n\n')

    setDraft({
      title,
      nickname,
      subtitle,
      category,
      subcategory,
      historic:            briefData.historic ?? false,
      eventDate:           briefData.eventDate ?? null,
      priorityNumber:      lead?.priorityNumber ?? null,
      status:              'published',
      descriptionSections: normalizeDraftSections(briefData.descriptionSections),
      keywords:                  Array.isArray(briefData.keywords) ? briefData.keywords : [],
      sources:                   Array.isArray(briefData.sources) ? briefData.sources : [],
      gameData:                  (briefData.gameData && typeof briefData.gameData === 'object') ? briefData.gameData : {},
      associatedBaseBriefIds:     [],
      associatedSquadronBriefIds: [],
      associatedAircraftBriefIds: [],
      associatedMissionBriefIds:  [],
      associatedTrainingBriefIds: [],
      associatedTechBriefIds:     [],
      relatedBriefIds:            [],
      relatedHistoric:            [],
    })
    setEasyQuestions([])
    setMediumQuestions([])
    setMedia([])
    setPendingImages([])
    setBriefId(null)
    setPendingLead(lead ? lead.title : null)
    setStaleSourceWarning(briefData.staleSourceWarning ?? false)
    // Warn if BOO-eligible category brief came back with missing game data
    const BOO_NEEDS_AI_DATA = ['Aircrafts', 'Training', 'Missions', 'Tech', 'Treaties', 'Bases', 'Squadrons', 'Threats']
    if (BOO_NEEDS_AI_DATA.includes(category)) {
      const gd = briefData.gameData ?? {}
      let missing = false
      if (category === 'Aircrafts') missing = gd.topSpeedKph == null && gd.yearIntroduced == null
      else if (category === 'Training') missing = gd.trainingWeekStart == null && gd.weeksOfTraining == null
      else missing = gd.startYear == null
      setMissingGameDataWarning(missing)
    } else {
      setMissingGameDataWarning(false)
    }
    setRelatedSearch('')
    setView('editor')

    // Fetch pools needed for this category — awaited so we can use them for link suggestions
    const needsBases     = ['Aircrafts', 'Squadrons'].includes(category)
    const needsSquadrons = ['Bases', 'Aircrafts', 'Training'].includes(category)
    const needsAircraft  = ['Bases', 'Squadrons', 'Tech'].includes(category)
    const needsMissions  = ['Aircrafts', 'Squadrons'].includes(category)
    const needsTraining  = ['Roles'].includes(category)
    const needsTech      = ['Aircrafts'].includes(category)

    const fetchPool = (cat, current, setter) => {
      if (current.length > 0) return Promise.resolve(current)
      return apiFetch(`${API}/api/admin/briefs?category=${cat}&limit=200`, { credentials: 'include' })
        .then(r => r.json())
        .then(d => { const briefs = d.data?.briefs ?? []; setter(briefs); return briefs })
        .catch(() => [])
    }

    const fetchRelatedPool = () => {
      if (allRelatedPool.length > 0) return Promise.resolve()
      return apiFetch(`${API}/api/admin/briefs/related-pool`, { credentials: 'include' })
        .then(r => r.json()).then(d => { if (d.data?.briefs) setAllRelatedPool(d.data.briefs) }).catch(() => {})
    }

    const [poolBases, poolSquadrons, poolAircraft, poolMissions, poolTraining, poolTech] = await Promise.all([
      needsBases     ? fetchPool('Bases',     allBasesBriefs,     setAllBasesBriefs)     : Promise.resolve([]),
      needsSquadrons ? fetchPool('Squadrons', allSquadronsBriefs, setAllSquadronsBriefs) : Promise.resolve([]),
      needsAircraft  ? fetchPool('Aircrafts', allAircraftBriefs,  setAllAircraftBriefs)  : Promise.resolve([]),
      needsMissions  ? fetchPool('Missions',  allMissionsBriefs,  setAllMissionsBriefs)  : Promise.resolve([]),
      needsTraining  ? fetchPool('Training',  allTrainingsBriefs, setAllTrainingsBriefs) : Promise.resolve([]),
      needsTech      ? fetchPool('Tech',      allTechBriefs,      setAllTechBriefs)      : Promise.resolve([]),
      fetchRelatedPool(),
    ])

    // Helper: call generate-links for one type
    const suggestLinks = (linkType, pool) => {
      if (!pool.length) return Promise.resolve(null)
      return apiFetch(`${API}/api/admin/ai/generate-links`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceTitle: title,
          sourceDescription: description,
          sourceCategory: category,
          linkType,
          pool: pool.map(b => ({ _id: b._id, title: b.title })),
          isHistoric: draft.historic ?? false,
          briefId: briefId || null,
        }),
      }).then(r => r.json()).catch(() => null)
    }

    // Auto-generate everything in parallel
    setAutoGenerating(true)
    try {
      const [qRes, imgRes, kwRes, basesRes, squadronsRes, aircraftRes, missionsRes, trainingRes, techRes] = await Promise.all([
        fetch(`${API}/api/admin/ai/generate-quiz`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, description, briefId: briefId || null }),
        }),
        fetch(`${API}/api/admin/ai/generate-image`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, subtitle, briefId: briefId || null }),
        }),
        fetch(`${API}/api/admin/ai/generate-keywords`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description, existingKeywords: [], needed: keywordsPerBrief, title, briefId: briefId || null }),
        }),
        needsBases     ? suggestLinks('bases',     poolBases)     : Promise.resolve(null),
        needsSquadrons ? suggestLinks('squadrons', poolSquadrons) : Promise.resolve(null),
        needsAircraft  ? suggestLinks('aircraft',  poolAircraft)  : Promise.resolve(null),
        needsMissions  ? suggestLinks('missions',  poolMissions)  : Promise.resolve(null),
        needsTraining  ? suggestLinks('training',  poolTraining)  : Promise.resolve(null),
        needsTech      ? suggestLinks('tech',      poolTech)      : Promise.resolve(null),
      ])
      const [qData, imgData, kwData] = await Promise.all([qRes.json(), imgRes.json(), kwRes.json()])

      if (qData.status === 'success') {
        setEasyQuestions(qData.data.easyQuestions ?? [])
        setMediumQuestions(qData.data.mediumQuestions ?? [])
      }
      if (imgData.status === 'success') {
        setPendingImages((imgData.data.images ?? []).map(img => ({ ...img, selected: true })))
      }
      if (kwData.status === 'success') {
        setDraft(p => ({ ...p, keywords: kwData.data.keywords ?? [] }))
      }

      // Apply AI-suggested linked brief IDs
      setDraft(p => ({
        ...p,
        ...(basesRes?.status === 'success'    && { associatedBaseBriefIds:     basesRes.data.ids }),
        ...(squadronsRes?.status === 'success'&& { associatedSquadronBriefIds: squadronsRes.data.ids }),
        ...(aircraftRes?.status === 'success' && { associatedAircraftBriefIds: aircraftRes.data.ids }),
        ...(missionsRes?.status === 'success' && { associatedMissionBriefIds:  missionsRes.data.ids }),
        ...(trainingRes?.status === 'success' && { associatedTrainingBriefIds: trainingRes.data.ids }),
        ...(techRes?.status === 'success'     && { associatedTechBriefIds:     techRes.data.ids }),
      }))
    } finally {
      setAutoGenerating(false)
    }
  }

  // ── AI: Generate keywords ─────────────────────────────────────────────────
  const generateKeywords = async () => {
    setGenerating('keywords')
    try {
      const description = draft.descriptionSections.map(s => s.body ?? '').join(' ')
      const res  = await apiFetch(`${API}/api/admin/ai/generate-keywords`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, existingKeywords: [], needed: keywordsPerBrief, title: draft.title, briefId: briefId || null }),
      })
      const data = await res.json()
      if (data.status === 'success') {
        setDraft(p => ({ ...p, keywords: data.data.keywords }))
      }
    } finally {
      setGenerating(null)
    }
  }

  // ── AI: Generate quiz questions ───────────────────────────────────────────
  const generateQuestions = async () => {
    setGenerating('questions')
    try {
      const res  = await apiFetch(`${API}/api/admin/ai/generate-quiz`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: draft.title, description: draft.descriptionSections.map(s => s.body ?? '').join('\n\n'), briefId: briefId || null }),
      })
      const data = await res.json()
      if (data.status === 'success') {
        setEasyQuestions(data.data.easyQuestions ?? [])
        setMediumQuestions(data.data.mediumQuestions ?? [])
      }
    } finally {
      setGenerating(null)
    }
  }

  // ── AI: Generate single (fill gap) keywords ───────────────────────────────
  const generateSingleKeyword = async () => {
    const needed = keywordsPerBrief - draft.keywords.length
    if (needed <= 0) return
    setGenKeywordsSingle(true)
    try {
      const description = draft.descriptionSections.map(s => s.body ?? '').join(' ')
      const res = await apiFetch(`${API}/api/admin/ai/generate-keywords`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, existingKeywords: draft.keywords.map(k => k.keyword), needed, title: draft.title, briefId: briefId || null }),
      })
      const data = await res.json()
      if (data.status === 'success') {
        setDraft(p => ({ ...p, keywords: [...p.keywords, ...data.data.keywords] }))
      }
    } finally {
      setGenKeywordsSingle(false)
    }
  }

  // ── AI: Generate missing (fill gap) questions for both difficulties ──────
  const generateMissingQuestionsBoth = async () => {
    const missingEasy = Math.max(0, questionsPerDifficulty - easyQuestions.length)
    const missingMedium = Math.max(0, questionsPerDifficulty - mediumQuestions.length)
    if (missingEasy === 0 && missingMedium === 0) return
    setGenQuestionsSingle(true)
    const fillOne = async (difficulty, existing, needed, setter) => {
      if (needed <= 0) return
      try {
        const res = await apiFetch(`${API}/api/admin/ai/generate-quiz-missing`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: draft.title,
            description: draft.descriptionSections.map(s => s.body ?? '').join('\n\n'),
            difficulty,
            existingQuestions: existing,
            needed,
            briefId: briefId || null,
          }),
        })
        const data = await res.json()
        if (data.status === 'success') setter(p => [...p, ...(data.data.questions ?? [])])
      } catch {}
    }
    try {
      await fillOne('easy', easyQuestions, missingEasy, setEasyQuestions)
      await fillOne('medium', mediumQuestions, missingMedium, setMediumQuestions)
    } finally {
      setGenQuestionsSingle(false)
    }
  }

  // ── Add blank question ────────────────────────────────────────────────────
  const addBlankQuestion = () => {
    const blank = { question: '', correctAnswerIndex: 0, answers: Array(10).fill(null).map(() => ({ title: '' })) }
    if (qTab === 'easy') setEasyQuestions(p => [...p, blank])
    else setMediumQuestions(p => [...p, blank])
  }


  // ── AI: Generate images ───────────────────────────────────────────────────
  const generateImages = async () => {
    setGenerating('images')
    try {
      const res  = await apiFetch(`${API}/api/admin/ai/generate-image`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: draft.title, subtitle: draft.subtitle, briefId: briefId || null }),
      })
      const data = await res.json()
      if (data.status === 'success') {
        const imgs = (data.data.images ?? []).map(img => ({ ...img, selected: true }))
        setPendingImages(imgs)
      }
    } finally {
      setGenerating(null)
    }
  }

  // ── Regenerate description, keywords, and quiz questions (two-step) ──────
  // Step 1: open confirmation modal
  const regenerateAll = () => {
    if (!briefId) return
    setConfirmRegen(true)
  }

  // Step 2: cascade-delete user data, then call AI regeneration
  const handleConfirmRegen = async (reason) => {
    setConfirmRegen(false)
    setRegeneratingAll(true)
    // Optimistic clear — cascade + regeneration will replace all of these, so
    // don't leave stale draft values visible during the AI wait. Description
    // sections stay put to avoid a flash of empty textareas; they're visibly
    // replaced when the response arrives.
    setDraft(p => ({ ...p, keywords: [], sources: [] }))
    setEasyQuestions([])
    setMediumQuestions([])
    try {
      // Cascade: wipe all user stats / coins tied to this brief
      const cascadeRes  = await apiFetch(`${API}/api/admin/briefs/${briefId}/confirm-regeneration`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      const cascadeData = await cascadeRes.json()
      if (cascadeData.status !== 'success') throw new Error(cascadeData.message ?? 'Cascade failed')

      // AI regeneration
      const regenRes  = await apiFetch(`${API}/api/admin/ai/regenerate-brief/${briefId}`, {
        method: 'POST', credentials: 'include',
      })
      const regenData = await regenRes.json()
      if (regenData.status !== 'success') throw new Error(regenData.message ?? 'Regeneration failed')

      const { descriptionSections, keywords, sources, easyQuestions, mediumQuestions, gameData, mnemonics } = regenData.data
      setDraft(p => ({
        ...p,
        descriptionSections: normalizeDraftSections(descriptionSections),
        keywords,
        sources: Array.isArray(sources) ? sources : [],
        ...(gameData ? { gameData } : {}),
        ...(mnemonics ? { mnemonics } : {}),
      }))
      setEasyQuestions(easyQuestions ?? [])
      setMediumQuestions(mediumQuestions ?? [])
      setToast('Regenerated — review and save when ready')
    } catch (err) {
      setToast(`Regenerate failed: ${err.message}`)
    } finally {
      setRegeneratingAll(false)
    }
  }

  // ── Regenerate subtitle only (lightweight — no cascade, no reason required) ─
  const regenerateSubtitle = async () => {
    if (!briefId) return
    setGenerating('subtitle')
    try {
      const res  = await apiFetch(`${API}/api/admin/ai/regenerate-subtitle/${briefId}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (data.status !== 'success') throw new Error(data.message ?? 'Generation failed')
      setDraft(p => ({ ...p, subtitle: data.data.subtitle }))
      setToast('Subtitle regenerated — review and save when ready')
    } catch (err) {
      setToast(`Regenerate subtitle failed: ${err.message}`)
    } finally {
      setGenerating(null)
    }
  }

  // ── Generate description sections (cascades all user data first) ────────
  const generateDescription = () => {
    if (!briefId) return
    setConfirmDescRegen(true)
  }

  const handleConfirmDescRegen = async (reason) => {
    setConfirmDescRegen(false)
    setGenerating('description')
    // Optimistic clear — the server-side cascade wipes keywords and quiz
    // questions the moment the POST is received, so match that state in the
    // UI rather than leaving stale values visible during the AI wait. Sources
    // are tied to the old description and about to be replaced, so drop them
    // too. Description sections stay put — they're visibly replaced when the
    // response arrives, and keeping the old ones avoids a flash of empty
    // textareas during the long AI wait.
    setDraft(p => ({ ...p, keywords: [], sources: [] }))
    setEasyQuestions([])
    setMediumQuestions([])
    try {
      const res  = await apiFetch(`${API}/api/admin/ai/regenerate-description/${briefId}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      const data = await res.json()
      if (data.status !== 'success') throw new Error(data.message ?? 'Generation failed')
      const nextSources = Array.isArray(data.data.sources) ? data.data.sources : []
      setDraft(p => ({ ...p, descriptionSections: normalizeDraftSections(data.data.descriptionSections), sources: nextSources }))
      setToast('Description generated — keywords, quiz, and sources refreshed. Review and save when ready')
    } catch (err) {
      setToast(`Generate description failed: ${err.message}`)
    } finally {
      setGenerating(null)
    }
  }

  // ── Add selected pending images ───────────────────────────────────────────
  const addSelectedImages = async () => {
    if (!briefId) return
    const selected = pendingImages.filter(img => img.selected)
    for (const img of selected) {
      await apiFetch(`${API}/api/admin/briefs/${briefId}/media`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(img.mediaId
          ? { mediaId: img.mediaId }
          : { mediaType: 'picture', mediaUrl: img.url, cloudinaryPublicId: img.publicId, name: img.wikiPage || img.term }),
      })
    }
    // Reload media
    const res  = await apiFetch(`${API}/api/admin/briefs/${briefId}`, { credentials: 'include' })
    const data = await res.json()
    if (data.status === 'success') setMedia(data.data.brief.media ?? [])
    setPendingImages([])
    setToast('Images added')
  }

  // ── Remove media item ─────────────────────────────────────────────────────
  const removeMedia = async (mediaId) => {
    await apiFetch(`${API}/api/admin/briefs/${briefId}/media/${mediaId}`, {
      method: 'DELETE', credentials: 'include',
    })
    setMedia(p => p.filter(m => String(m._id) !== String(mediaId)))
  }

  // ── Extract aircraft subject (background removal via OpenRouter Gemini) ───
  // Aircraft briefs only. Overwrites any previous cutout for this media.
  const extractSubject = async (mediaId) => {
    if (!briefId) return
    setExtractingMediaId(mediaId)
    try {
      const res  = await apiFetch(`${API}/api/admin/briefs/${briefId}/media/${mediaId}/extract-subject`, {
        method: 'POST', credentials: 'include',
      })
      const data = await res.json()
      if (data.status !== 'success') throw new Error(data.message ?? 'Extraction failed')
      setMedia(p => p.map(m => String(m._id) === String(mediaId)
        ? { ...m, cutoutUrl: data.data.media.cutoutUrl, cutoutPublicId: data.data.media.cutoutPublicId }
        : m
      ))
      // Clear any prior "show original" override so the freshly generated cutout is visible
      setOriginalPreviewIds(prev => {
        if (!prev.has(String(mediaId))) return prev
        const next = new Set(prev); next.delete(String(mediaId)); return next
      })
      setToast('Aircraft extracted')
    } catch (err) {
      setToast(`Extract failed: ${err.message}`)
    } finally {
      setExtractingMediaId(null)
    }
  }

  const removeCutout = async (mediaId) => {
    if (!briefId) return
    if (!window.confirm('Remove this cutout? The original image stays, but the transparent cutout will be permanently deleted.')) return
    try {
      const res  = await apiFetch(`${API}/api/admin/briefs/${briefId}/media/${mediaId}/cutout`, {
        method: 'DELETE', credentials: 'include',
      })
      const data = await res.json()
      if (data.status !== 'success') throw new Error(data.message ?? 'Remove failed')
      setMedia(p => p.map(m => String(m._id) === String(mediaId)
        ? { ...m, cutoutUrl: null, cutoutPublicId: null }
        : m
      ))
      setOriginalPreviewIds(prev => {
        if (!prev.has(String(mediaId))) return prev
        const next = new Set(prev); next.delete(String(mediaId)); return next
      })
      setToast('Cutout removed')
    } catch (err) {
      setToast(`Remove failed: ${err.message}`)
    }
  }

  const toggleCutoutPreview = (mediaId) => {
    setOriginalPreviewIds(prev => {
      const next = new Set(prev)
      const key  = String(mediaId)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  // ── Status badge helper ───────────────────────────────────────────────────
  function BriefStatusPills({ brief }) {
    const hasKeywords    = (brief.keywords?.length ?? 0) >= keywordsPerBrief
    const hasEasy        = (brief.quizQuestionsEasy?.length ?? 0) >= questionsPerDifficulty
    const hasMedium      = (brief.quizQuestionsMedium?.length ?? 0) >= questionsPerDifficulty
    const hasQuiz        = hasEasy && hasMedium
    const hasMedia       = (brief.media ?? []).some(m => m.cloudinaryPublicId)
    const hasDescription = (brief.descriptionSections ?? []).filter(s => {
      if (typeof s === 'string') return s.trim()
      return (s?.body ?? '').trim()
    }).length >= 4
    const hasPriority    = brief.priorityNumber != null
    const priorityNA     = brief.category === 'News'
    return (
      <span className="flex gap-1 items-center">
        <span
          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${priorityNA ? 'bg-slate-100 text-slate-400 line-through decoration-red-500 decoration-2' : hasPriority ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}
          title={`Priority — ${priorityNA ? 'not applicable for News briefs' : hasPriority ? `set (#${brief.priorityNumber})` : 'not set'}`}
        >P</span>
        <span
          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${hasDescription ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}
          title={`Description — ${hasDescription ? 'complete (4 sections)' : 'incomplete (needs 4 sections)'}`}
        >D</span>
        <span
          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${hasKeywords ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}
          title={`Keywords — ${(brief.keywords?.length ?? 0)}/${keywordsPerBrief} ${hasKeywords ? 'complete' : 'required'}`}
        >K</span>
        <span
          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${hasQuiz ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}
          title={`Quiz — easy ${(brief.quizQuestionsEasy?.length ?? 0)}/${questionsPerDifficulty}, medium ${(brief.quizQuestionsMedium?.length ?? 0)}/${questionsPerDifficulty}${hasQuiz ? ' (complete)' : ''}`}
        >Q</span>
        <span
          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${hasMedia ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}
          title={`Media — ${hasMedia ? 'attached' : 'missing'}`}
        >M</span>
      </span>
    )
  }

  // ── Word count for description ────────────────────────────────────────────
  const wordCount = draft.descriptionSections.map(s => s.body ?? '').join(' ').split(/\s+/).filter(Boolean).length

  // ── Keyword verbatim warning ─────────────────────────────────────────────
  const descLower = draft.descriptionSections.map(s => s.body ?? '').join(' ').toLowerCase()
  const badKeywords = draft.keywords.filter(k => k.keyword && !descLower.includes(k.keyword.toLowerCase()))

  // ──────────────────────────────────────────────────────────────────────────
  // LIST VIEW
  // ──────────────────────────────────────────────────────────────────────────
  if (view === 'list') {
    const totalPages = Math.ceil(total / 20)
    return (
      <div>
        <AnimatePresence>{toast && <Toast msg={toast} onClear={() => setToast('')} />}</AnimatePresence>
        {showLeads && (
          <LeadsModal
            API={API}
            onClose={() => { setShowLeads(false); onBootstrapConsumed?.() }}
            onGenerate={handleLeadGenerate}
            onReset={loadList}
            initialSearch={initialSearch}
          />
        )}
        {showNews && (
          <NewsModal
            API={API}
            onClose={() => setShowNews(false)}
            onGenerate={handleLeadGenerate}
          />
        )}

        {/* Top bar */}
        <div className="flex flex-wrap gap-2 mb-4">
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search briefs…"
            className="flex-1 min-w-[160px] border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-200 bg-surface text-text"
          />
          <select
            value={category}
            onChange={e => { setCategory(e.target.value); setSubcategory(''); setPage(1) }}
            className="border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-200 bg-surface text-text"
          >
            <option value="">All Categories</option>
            {BRIEF_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {category && (BRIEF_SUBCATEGORIES[category] ?? []).length > 0 && (
            <select
              value={subcategory}
              onChange={e => { setSubcategory(e.target.value); setPage(1) }}
              className="border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-200 bg-surface text-text"
            >
              <option value="">All Subcategories</option>
              {BRIEF_SUBCATEGORIES[category].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          <select
            value={sort}
            onChange={e => { setSort(e.target.value); setPage(1) }}
            className="border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-200 bg-surface text-text"
          >
            <option value="default">Sort: Published (newest)</option>
            <option value="newest">Sort: Recently modified</option>
            <option value="oldest">Sort: Oldest modified</option>
            <option value="no-priority">Sort: No priority first</option>
            <option value="uncompleted-keywords">Sort: Uncompleted keywords</option>
            <option value="uncompleted-questions">Sort: Uncompleted questions</option>
            <option value="uncompleted-description">Sort: Uncompleted description</option>
          </select>
          <label className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-xl bg-surface cursor-pointer select-none">
            <input
              type="checkbox"
              checked={hideStubs}
              onChange={e => { setHideStubs(e.target.checked); setPage(1) }}
              className="accent-brand-600"
            />
            Hide stubs
          </label>
          <label className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-xl bg-surface cursor-pointer select-none">
            <input
              type="checkbox"
              checked={flaggedOnly}
              onChange={e => { setFlaggedOnly(e.target.checked); setPage(1) }}
              className="accent-amber-500"
            />
            Flagged only
          </label>
          <button
            onClick={newBrief}
            className="text-xs px-3 py-1.5 rounded-lg bg-brand-600 text-white font-semibold hover:bg-brand-700 transition-colors"
          >
            + New Brief
          </button>
          <button
            onClick={() => setShowLeads(true)}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50 transition-colors"
          >
            Leads
          </button>
          <button
            onClick={() => setShowNews(true)}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50 transition-colors"
          >
            News
          </button>
          <button
            onClick={findDuplicates}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50 transition-colors"
          >
            Find Duplicates
          </button>
        </div>

        {/* Bulk Auto-Generate panel */}
        <div className={`mb-4 bg-surface rounded-2xl overflow-hidden border transition-colors duration-300 ${bulkRunning ? 'border-brand-600' : 'border-slate-200'}`}>
          {/* Header — locked while running */}
          <button
            onClick={() => { if (!bulkRunning) setBulkOpen(p => !p) }}
            className={`w-full flex items-center justify-between px-4 py-3 text-sm font-semibold transition-colors ${bulkRunning ? 'cursor-default' : 'hover:bg-slate-50'} text-slate-700`}
          >
            <span className="flex items-center gap-2">
              {bulkRunning
                ? <span className="inline-block w-2 h-2 rounded-full bg-brand-600 animate-pulse" />
                : '⚡'}
              {bulkRunning
                ? `Generating ${Math.min(bulkDone + 1, bulkTotal)} of ${bulkTotal}…`
                : 'Bulk Auto-Generate'}
            </span>
            {!bulkRunning && <span className="text-slate-400 text-xs">{bulkOpen ? '▲' : '▼'}</span>}
          </button>

          {bulkOpen && (
            <div className="border-t border-slate-200 px-4 py-4">
              {/* Controls — faded + locked while running */}
              <div className={`transition-opacity duration-200 ${bulkRunning ? 'opacity-40 pointer-events-none' : ''}`}>
                <p className="text-xs font-semibold text-slate-500 mb-2">Categories to generate:</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-4">
                  {BRIEF_CATEGORIES.map(cat => (
                    <label key={cat} className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={bulkCats.has(cat)}
                        onChange={e => setBulkCats(prev => {
                          const next = new Set(prev)
                          e.target.checked ? next.add(cat) : next.delete(cat)
                          return next
                        })}
                        className="accent-brand-600"
                      />
                      <span className="text-xs text-slate-700">{cat}</span>
                    </label>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-600 mb-4">
                  Briefs per category:
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={bulkCount}
                    onChange={e => setBulkCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                    className="w-16 border border-slate-200 rounded-lg px-2 py-1 text-xs text-center outline-none focus:ring-2 focus:ring-brand-200 bg-surface text-text"
                  />
                </label>
              </div>

              {/* Action button */}
              <div className="flex items-center gap-3">
                {!bulkRunning ? (
                  <button
                    onClick={handleBulkGenerate}
                    disabled={bulkCats.size === 0}
                    className="text-xs px-4 py-1.5 rounded-lg bg-brand-600 text-white font-semibold hover:bg-brand-700 transition-colors disabled:opacity-40"
                  >
                    Generate Briefs
                  </button>
                ) : (
                  <button
                    onClick={() => { bulkCancelRef.current = true }}
                    className="text-xs px-4 py-1.5 rounded-lg border border-red-300 text-red-600 font-semibold hover:bg-red-50 transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>

              {/* Terminal log */}
              {bulkLog.length > 0 && (
                <div className="mt-4">
                  {/* Progress bar */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand-600 rounded-full transition-all duration-500"
                        style={{ width: bulkTotal > 0 ? `${(bulkDone / bulkTotal) * 100}%` : '0%' }}
                      />
                    </div>
                    <span className="text-[10px] text-slate-400 tabular-nums shrink-0">
                      {bulkDone}/{bulkTotal} · {bulkTotal > 0 ? Math.round((bulkDone / bulkTotal) * 100) : 0}%
                    </span>
                  </div>
                  {/* Terminal box */}
                  <div
                    ref={bulkLogRef}
                    className="bg-slate-900 rounded-xl p-3 font-mono text-[11px] max-h-96 overflow-y-auto space-y-0.5 select-text"
                  >
                    {bulkLog.map(entry => {
                      const ts = entry.startedAt
                        ? new Date(entry.startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                        : '--:--:--'
                      const dur = (entry.completedAt && entry.startedAt)
                        ? `(${Math.round((entry.completedAt - entry.startedAt) / 1000)}s)`
                        : ''
                      const icon =
                        entry.status === 'done'    ? '✓' :
                        entry.status === 'error'   ? '✗' :
                        entry.status === 'running' ? '⟳' : '○'
                      const iconCls =
                        entry.status === 'done'    ? 'text-emerald-400' :
                        entry.status === 'error'   ? 'text-red-400'     :
                        entry.status === 'running' ? 'text-cyan-400 animate-pulse' :
                        'text-slate-600'
                      const titleCls =
                        entry.status === 'running' ? 'text-slate-100' :
                        entry.status === 'done'    ? 'text-slate-300' :
                        entry.status === 'error'   ? 'text-slate-300' :
                        'text-slate-600'
                      return (
                        <div key={entry._id} className="leading-5">
                          <div className="flex items-baseline gap-2">
                            <span className="text-slate-600 shrink-0">[{ts}]</span>
                            <span className={`shrink-0 ${iconCls}`}>{icon}</span>
                            <span className={titleCls}>{entry.title}</span>
                            <span className="text-slate-500 shrink-0">{entry.category}</span>
                            {dur && <span className="text-slate-600 shrink-0">{dur}</span>}
                          </div>
                          {entry.status === 'error' && entry.error && (
                            <div className="text-red-400 italic pl-[7.5rem] leading-4 mt-0.5 whitespace-pre-wrap break-all">{entry.error}</div>
                          )}
                          {entry.warnings?.map((w, i) => (
                            <div key={i} className="text-amber-400 pl-[7.5rem] leading-4 mt-0.5 whitespace-pre-wrap break-all">⚠ {w}</div>
                          ))}
                        </div>
                      )
                    })}
                    {!bulkRunning && bulkDone > 0 && (
                      <div className="text-slate-500 mt-1 pt-1 border-t border-slate-700">
                        — {bulkLog.filter(l => l.status === 'done').length} succeeded · {bulkLog.filter(l => l.status === 'error').length} failed
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Duplicates panel */}
        {dupePanel && (
          <div className="mb-4 bg-surface border border-slate-200 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-slate-700">Duplicate Briefs</p>
              <button onClick={() => setDupePanel(false)} className="text-xs text-slate-400 hover:text-slate-600">✕ Close</button>
            </div>
            {dupesLoading && <p className="text-sm text-slate-400 animate-pulse">Scanning…</p>}
            {!dupesLoading && dupeGroups !== null && dupeGroups.length === 0 && (
              <p className="text-sm text-emerald-600 font-medium">No duplicates found.</p>
            )}
            {!dupesLoading && dupeGroups && dupeGroups.map((group, gi) => (
              <div key={gi} className="mb-3 last:mb-0 border border-amber-200 bg-amber-50 rounded-xl p-3">
                <p className="text-xs font-bold text-amber-700 mb-2">{group[0].title} — {group.length} copies ({group[0].category})</p>
                {group.map((b, bi) => (
                  <div key={b._id} className="flex items-center justify-between gap-2 py-1 border-t border-amber-100 first:border-0">
                    <div>
                      <span className="text-xs text-slate-700">{new Date(b.dateAdded).toLocaleDateString('en-GB')} · {b.status ?? 'published'}</span>
                      <span className="ml-2 text-[10px] text-slate-400">{b._id}</span>
                    </div>
                    {bi === 0 && (
                      <button
                        onClick={() => deleteOlderDupe(b)}
                        className="text-xs px-2 py-1 rounded-lg bg-red-100 text-red-700 font-semibold hover:bg-red-200 transition-colors whitespace-nowrap"
                      >
                        Delete Older
                      </button>
                    )}
                    {bi > 0 && <span className="text-[10px] text-emerald-600 font-semibold">Keep</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Brief list */}
        <div className="bg-surface rounded-2xl border border-slate-300 overflow-hidden mb-4">
          {loading && <p className="py-8 text-center text-slate-400 text-sm animate-pulse">Loading…</p>}
          {!loading && briefs.length === 0 && <p className="py-8 text-center text-slate-400 text-sm">No briefs found</p>}
          {briefs.map((b, i) => {
            const isStub = b.status === 'stub';
            return (
              <div
                key={b._id}
                className={`w-full flex items-center gap-3 px-4 py-3 transition-colors ${i !== 0 ? 'border-t border-slate-100' : ''} ${isStub ? 'bg-slate-50' : ''}`}
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={!!b.flaggedForEdit}
                  aria-label={`Flag ${b.title} for editing`}
                  title={b.flaggedForEdit ? 'Flagged for editing — click to unflag' : 'Flag for editing'}
                  onClick={(e) => { e.stopPropagation(); toggleFlagInline(b, !b.flaggedForEdit); }}
                  className={`h-6 w-6 shrink-0 flex items-center justify-center rounded-md text-base leading-none transition-colors ${b.flaggedForEdit ? 'text-orange-500 hover:text-orange-600' : 'text-slate-300 hover:text-slate-400'}`}
                >
                  <span aria-hidden="true">{b.flaggedForEdit ? '⚑' : '⚐'}</span>
                </button>
                <button
                  onClick={() => openBrief(b)}
                  className={`flex-1 flex items-center gap-3 min-w-0 text-left transition-colors ${isStub ? 'hover:bg-slate-100' : 'hover:bg-slate-50'}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold truncate ${isStub ? 'text-slate-400' : 'text-slate-800'}`}>{b.title}</p>
                    <p className="text-xs text-slate-400 truncate">{b.subtitle}</p>
                  </div>
                  {isStub && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-600 whitespace-nowrap">STUB</span>
                  )}
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 whitespace-nowrap">{b.category}</span>
                  <BriefStatusPills brief={b} />
                  <span className="text-slate-300 text-sm">›</span>
                </button>
              </div>
            );
          })}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 font-semibold disabled:opacity-40 hover:bg-slate-50 transition-colors"
            >
              ← Prev
            </button>
            <span className="text-xs text-slate-400">Page {page} of {totalPages} ({total} total)</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 font-semibold disabled:opacity-40 hover:bg-slate-50 transition-colors"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    )
  }

  // ──────────────────────────────────────────────────────────────────────────
  // EDITOR VIEW
  // ──────────────────────────────────────────────────────────────────────────

  const currentQuestions = qTab === 'easy' ? easyQuestions : mediumQuestions
  const setCurrentQuestions = qTab === 'easy' ? setEasyQuestions : setMediumQuestions

  const updateQuestion = (idx, field, value) => {
    setCurrentQuestions(p => {
      const next = [...p]
      next[idx] = { ...next[idx], [field]: value }
      return next
    })
  }

  const updateAnswer = (qIdx, aIdx, value) => {
    setCurrentQuestions(p => {
      const next = [...p]
      const answers = [...next[qIdx].answers]
      answers[aIdx] = { title: value }
      next[qIdx] = { ...next[qIdx], answers }
      return next
    })
  }

  return (
    <div>
      <AnimatePresence>{toast && <Toast msg={toast} onClear={() => setToast('')} />}</AnimatePresence>
      {confirmDelete && (
        <ConfirmModal
          title="Delete Brief"
          body="This will permanently delete the brief and all associated questions, reads, and results."
          confirmLabel="Delete"
          danger
          onConfirm={deleteBrief}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
      {confirmRegen && (
        <ConfirmModal
          title="Regenerate Brief Content"
          body="This will replace this brief's description, subtitle, sources, keywords, recall questions, game data, and mnemonics with fresh AI output; clear all linked-brief relationships (bases, squadrons, aircraft, related); delete every user's read history, Intel Recall results, Battle of Order, Where's That Aircraft, and Flashcards plays tied to this brief; and reverse every Airstar awarded for it. This cannot be undone."
          confirmLabel="Confirm & Regenerate"
          danger
          onConfirm={handleConfirmRegen}
          onCancel={() => setConfirmRegen(false)}
        />
      )}
      {confirmDescRegen && (
        <ConfirmModal
          title="Regenerate Description"
          body="This will replace the description and sources on this brief with fresh AI output; wipe its keywords and recall questions (these are NOT regenerated — regenerate them separately afterwards); clear all linked-brief relationships; delete every user's read history, Intel Recall results, Battle of Order, Where's That Aircraft, and Flashcards plays tied to this brief; and reverse every Airstar awarded for it. This cannot be undone."
          confirmLabel="Confirm & Regenerate"
          danger
          onConfirm={handleConfirmDescRegen}
          onCancel={() => setConfirmDescRegen(false)}
        />
      )}

      {/* Top bar */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <button
          onClick={() => setView('list')}
          className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50 transition-colors"
        >
          ← Briefs
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-slate-800 truncate">{draft.title || 'New Brief'}</h2>
          {briefId && (
            <a
              href={`/brief/${briefId}`}
              className="text-[10px] text-brand-500 font-mono truncate hover:underline"
            >
              {briefId}
            </a>
          )}
        </div>
        {pendingLead && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Lead</span>}
        {briefId && (
          <button
            onClick={regenerateAll}
            disabled={regeneratingAll || autoGenerating || saveStatus === 'saving'}
            className="text-xs px-3 py-1.5 rounded-lg border border-violet-300 bg-violet-50 text-violet-700 font-semibold hover:bg-violet-100 transition-colors disabled:opacity-40"
          >
            {regeneratingAll ? '↺ Regenerating…' : '↺ Regenerate All'}
          </button>
        )}
        <button
          onClick={saveBrief}
          disabled={saveStatus === 'saving' || regeneratingAll}
          className="text-xs px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold transition-colors disabled:opacity-40"
        >
          {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? '✓ Saved' : 'Save Brief'}
        </button>
        {briefId && (
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 font-semibold hover:bg-red-50 transition-colors"
          >
            Delete
          </button>
        )}
      </div>

      {/* ── Stale source warning ───────────────────────────────────────── */}
      {staleSourceWarning && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 mb-4">
          <span className="text-amber-500 text-sm mt-px">⚠️</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-800">This news is potentially outdated</p>
            <p className="text-xs text-amber-600 mt-0.5">One or more sources are older than 24 hours or have no date. Verify the content is current before publishing.</p>
          </div>
          <button onClick={() => setStaleSourceWarning(false)} className="text-amber-400 hover:text-amber-600 text-lg leading-none">×</button>
        </div>
      )}

      {/* ── Missing game data warning ──────────────────────────────────── */}
      {missingGameDataWarning && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 mb-4">
          <span className="text-amber-500 text-sm mt-px">⚠️</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-800">Game data missing — Battle of Order unavailable</p>
            <p className="text-xs text-amber-600 mt-0.5">The AI did not return game data for this brief. Open the Game Data section below and use Generate Stats to populate it before publishing.</p>
          </div>
          <button onClick={() => setMissingGameDataWarning(false)} className="text-amber-400 hover:text-amber-600 text-lg leading-none">×</button>
        </div>
      )}

      {/* ── Flag for editing toggle ─────────────────────────────────────── */}
      {briefId && (
        <div className={`flex items-center gap-2 px-4 py-2 mb-4 rounded-xl border ${draft.flaggedForEdit ? 'bg-amber-50 border-amber-300' : 'bg-surface border-slate-300'}`}>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!!draft.flaggedForEdit}
              onChange={e => setDraft(p => ({ ...p, flaggedForEdit: e.target.checked }))}
              className="h-4 w-4 accent-amber-500"
            />
            <span className={`text-xs font-semibold ${draft.flaggedForEdit ? 'text-amber-800' : 'text-slate-500'}`}>
              {draft.flaggedForEdit ? '⚑ Flagged for editing' : 'Flag for editing'}
            </span>
          </label>
          {draft.flaggedForEdit && draft.flaggedAt && (
            <span className="text-[10px] text-amber-600">
              since {new Date(draft.flaggedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          )}
        </div>
      )}

      {/* ── Section A: Core Fields ─────────────────────────────────────── */}
      <div className="bg-surface rounded-2xl border border-slate-300 overflow-hidden mb-4">
        <button
          onClick={() => toggleSection('core')}
          className="w-full flex items-center justify-between px-5 py-4 border-b border-slate-300 text-left"
        >
          <h3 className="font-bold text-slate-800">Core Fields</h3>
          <span className="text-slate-400 text-xs">{openSections.core ? '▲' : '▼'}</span>
        </button>
        {openSections.core && (
          <div className="px-5 py-4 space-y-3">
            {/* Category */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Category</label>
              <div className="flex flex-wrap gap-2 pt-1">
                {BRIEF_CATEGORIES.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      setDraft(p => ({ ...p, category: c, subcategory: '' }))
                      if (['Aircrafts', 'Squadrons', 'Training', 'Roles'].includes(c) && allBasesBriefs.length === 0)
                        fetch(`${API}/api/admin/briefs?category=Bases&limit=200`, { credentials: 'include' })
                          .then(r => r.json()).then(d => { if (d.data?.briefs) setAllBasesBriefs(d.data.briefs) }).catch(() => {})
                      if (['Bases', 'Aircrafts', 'Training'].includes(c) && allSquadronsBriefs.length === 0)
                        fetch(`${API}/api/admin/briefs?category=Squadrons&limit=200`, { credentials: 'include' })
                          .then(r => r.json()).then(d => { if (d.data?.briefs) setAllSquadronsBriefs(d.data.briefs) }).catch(() => {})
                      if (['Bases', 'Squadrons', 'Tech'].includes(c) && allAircraftBriefs.length === 0)
                        fetch(`${API}/api/admin/briefs?category=Aircrafts&limit=200`, { credentials: 'include' })
                          .then(r => r.json()).then(d => { if (d.data?.briefs) setAllAircraftBriefs(d.data.briefs) }).catch(() => {})
                      if (['Aircrafts', 'Squadrons'].includes(c) && allMissionsBriefs.length === 0)
                        fetch(`${API}/api/admin/briefs?category=Missions&limit=200`, { credentials: 'include' })
                          .then(r => r.json()).then(d => { if (d.data?.briefs) setAllMissionsBriefs(d.data.briefs) }).catch(() => {})
                      if (['Roles'].includes(c) && allTrainingsBriefs.length === 0)
                        fetch(`${API}/api/admin/briefs?category=Training&limit=200`, { credentials: 'include' })
                          .then(r => r.json()).then(d => { if (d.data?.briefs) setAllTrainingsBriefs(d.data.briefs) }).catch(() => {})
                      if (['Aircrafts'].includes(c) && allTechBriefs.length === 0)
                        fetch(`${API}/api/admin/briefs?category=Tech&limit=200`, { credentials: 'include' })
                          .then(r => r.json()).then(d => { if (d.data?.briefs) setAllTechBriefs(d.data.briefs) }).catch(() => {})
                    }}
                    className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors
                      ${draft.category === c
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-surface-raised text-slate-600 border-slate-400 hover:border-brand-500'
                      }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            {/* Subcategory */}
            {(BRIEF_SUBCATEGORIES[draft.category] ?? []).length > 0 && (
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Subcategory</label>
                <div className="flex flex-wrap gap-2 pt-1">
                  {(BRIEF_SUBCATEGORIES[draft.category] ?? []).map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setDraft(p => ({ ...p, subcategory: p.subcategory === s ? '' : s }))}
                      className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors
                        ${draft.subcategory === s
                          ? 'bg-brand-600 text-white border-brand-600'
                          : 'bg-surface-raised text-slate-600 border-slate-400 hover:border-brand-500'
                        }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* Historic */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.historic}
                onChange={e => setDraft(p => ({ ...p, historic: e.target.checked }))}
                className="rounded"
              />
              <span className="text-sm text-slate-700 font-medium">Historic (retired/outdated)</span>
            </label>
            {/* Status */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Status</label>
              <div className="flex flex-wrap gap-2 pt-1">
                {['published', 'stub'].map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setDraft(p => ({ ...p, status: s }))}
                    className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors
                      ${draft.status === s
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-surface-raised text-slate-600 border-slate-400 hover:border-brand-500'
                      }`}
                  >
                    {s === 'published' ? 'Published' : 'Stub (placeholder)'}
                  </button>
                ))}
              </div>
            </div>
            {/* Event Date — News briefs only */}
            {draft.category === 'News' && (
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  Event Date <span className="font-normal text-slate-400">(optional — date the news event occurred)</span>
                </label>
                <input
                  type="date"
                  value={draft.eventDate ?? ''}
                  onChange={e => setDraft(p => ({ ...p, eventDate: e.target.value || null }))}
                  className="w-full border border-slate-400 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-600/40 bg-surface-raised text-text"
                />
              </div>
            )}
            {/* Title */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Title</label>
              <input
                type="text"
                value={draft.title}
                onChange={e => setDraft(p => ({ ...p, title: e.target.value }))}
                className="w-full border border-slate-400 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-600/40 bg-surface-raised text-text"
              />
            </div>
            {/* Nickname */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Nickname <span className="font-normal text-slate-400">(optional — informal/popular name)</span></label>
              <input
                type="text"
                value={draft.nickname ?? ''}
                onChange={e => setDraft(p => ({ ...p, nickname: e.target.value }))}
                placeholder="e.g. Typhoon, Tonka, Widow Maker"
                className="w-full border border-slate-400 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-600/40 bg-surface-raised text-text"
              />
            </div>
            {/* Subtitle */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Subtitle</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={draft.subtitle}
                  onChange={e => setDraft(p => ({ ...p, subtitle: e.target.value }))}
                  className="flex-1 border border-slate-400 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-600/40 bg-surface-raised text-text"
                />
                {briefId && (
                  <button
                    type="button"
                    onClick={regenerateSubtitle}
                    disabled={generating === 'subtitle'}
                    className="px-3 py-2 text-xs font-semibold rounded-xl border border-brand-400/60 bg-brand-100 text-brand-600 hover:bg-brand-200 transition-colors disabled:opacity-40 whitespace-nowrap"
                  >
                    {generating === 'subtitle' ? '↺ Regenerating…' : '↺ Regenerate'}
                  </button>
                )}
              </div>
            </div>
            {/* Priority Number */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">
                Pathway Priority <span className="font-normal text-slate-400">(optional — sets order in Learn Pathway; leave blank to exclude from pathway)</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={1}
                  value={draft.priorityNumber ?? ''}
                  onChange={e => setDraft(p => ({ ...p, priorityNumber: e.target.value === '' ? null : parseInt(e.target.value) || null }))}
                  placeholder="e.g. 1 (first), 2 (second)…"
                  className="flex-1 border border-slate-400 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-600/40 bg-surface-raised text-text"
                />
                <button
                  type="button"
                  onClick={async () => {
                    if (!draft.title) return
                    try {
                      const r = await apiFetch(`${API}/api/admin/intel-leads/priority?title=${encodeURIComponent(draft.title)}`, { credentials: 'include' })
                      const d = await r.json()
                      if (d.status === 'success' && d.data.priorityNumber != null) {
                        setDraft(p => ({ ...p, priorityNumber: d.data.priorityNumber }))
                        addToast('Loaded priority ' + d.data.priorityNumber + ' from lead', 'success')
                      } else {
                        addToast('No priority found for this lead', 'warning')
                      }
                    } catch { addToast('Failed to load priority from lead', 'error') }
                  }}
                  className="px-3 py-2 text-xs font-semibold rounded-xl border border-brand-600 bg-brand-600 text-white hover:bg-brand-700 transition-colors whitespace-nowrap"
                >
                  Load from Lead
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Section B: Description ─────────────────────────────────────── */}
      <div className="relative bg-surface rounded-2xl border border-slate-300 overflow-hidden mb-4">
        {(generating === 'description' || regeneratingAll) && <GeneratingOverlay />}
        <button
          onClick={() => toggleSection('desc')}
          className="w-full flex items-center justify-between px-5 py-4 border-b border-slate-300 text-left"
        >
          <h3 className="font-bold text-slate-800">Description Sections</h3>
          <span className="text-slate-400 text-xs">{openSections.desc ? '▲' : '▼'}</span>
        </button>
        {openSections.desc && (
          <div className="px-5 py-4 space-y-3">
            {draft.descriptionSections.map((sec, idx) => {
              const isFlashcardSection = idx === 3
              return (
                <div key={idx}>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-slate-500">{isFlashcardSection ? 'Flashcard Section' : `Section ${idx + 1}`}</label>
                    <button
                      onClick={() => setDraft(p => ({ ...p, descriptionSections: p.descriptionSections.filter((_, i) => i !== idx) }))}
                      disabled={draft.descriptionSections.length <= 1}
                      className="text-xs text-red-400 hover:text-red-600 disabled:opacity-30"
                    >
                      Remove
                    </button>
                  </div>
                  {!isFlashcardSection && (
                    <input
                      type="text"
                      value={sec.heading ?? ''}
                      onChange={e => setDraft(p => {
                        const s = [...p.descriptionSections]
                        s[idx] = { ...s[idx], heading: e.target.value }
                        return { ...p, descriptionSections: s }
                      })}
                      placeholder="Heading (2–5 words, e.g. Role and Structure)"
                      className="w-full border border-slate-500 rounded-xl px-3 py-2 text-sm mb-2 outline-none focus:ring-2 focus:ring-brand-600/40 bg-surface-raised text-text placeholder:text-text-muted"
                    />
                  )}
                  <textarea
                    rows={4}
                    value={sec.body ?? ''}
                    onChange={e => setDraft(p => {
                      const s = [...p.descriptionSections]
                      s[idx] = { ...s[idx], body: e.target.value }
                      return { ...p, descriptionSections: s }
                    })}
                    className="w-full border border-slate-500 rounded-xl px-3 py-2 text-sm resize-none outline-none focus:ring-2 focus:ring-brand-600/40 bg-surface-raised text-text placeholder:text-text-muted"
                  />
                </div>
              )
            })}
            <div className="flex items-center justify-between pt-1 gap-2 flex-wrap">
              {draft.descriptionSections.length < 4 && (
                <button
                  onClick={() => setDraft(p => ({ ...p, descriptionSections: [...p.descriptionSections, { heading: '', body: '' }] }))}
                  className="text-xs px-3 py-1.5 rounded-lg border border-slate-400 text-slate-600 font-semibold hover:bg-surface-raised transition-colors"
                >
                  + Add Section
                </button>
              )}
              {briefId && (
                <button
                  onClick={generateDescription}
                  disabled={generating === 'description' || regeneratingAll}
                  className="text-xs px-3 py-1.5 rounded-lg border border-brand-400/60 bg-brand-100 text-brand-600 font-semibold hover:bg-brand-200 transition-colors disabled:opacity-40"
                >
                  {generating === 'description' ? '↺ Generating…' : '↺ Generate Description'}
                </button>
              )}
              <span className={`text-xs font-semibold ${wordCount > 240 ? 'text-red-500' : 'text-slate-400'}`}>
                {wordCount} / 240 words
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── Section C: Sources ────────────────────────────────────────── */}
      <div className="bg-surface rounded-2xl border border-slate-300 overflow-hidden mb-4">
        <button
          onClick={() => toggleSection('sources')}
          className="w-full flex items-center justify-between px-5 py-4 border-b border-slate-300 text-left"
        >
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-slate-800">Sources</h3>
            {draft.sources.length > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-surface-raised text-text-muted">
                {draft.sources.length} {draft.sources.length === 1 ? 'source' : 'sources'}
              </span>
            )}
          </div>
          <span className="text-slate-400 text-xs">{openSections.sources ? '▲' : '▼'}</span>
        </button>
        {openSections.sources && (
          <div className="px-5 py-4 space-y-3">
            {draft.sources.map((src, idx) => (
              <div key={idx} className="border border-slate-300 rounded-xl p-3 bg-surface-raised space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500">Source {idx + 1}</span>
                  <button
                    onClick={() => setDraft(p => ({ ...p, sources: p.sources.filter((_, i) => i !== idx) }))}
                    className="text-xs text-red-400 hover:text-red-600"
                  >
                    Remove
                  </button>
                </div>
                <input
                  type="text"
                  value={src.url}
                  onChange={e => setDraft(p => { const s = [...p.sources]; s[idx] = { ...s[idx], url: e.target.value }; return { ...p, sources: s } })}
                  placeholder="URL"
                  className="w-full border border-slate-400 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-600/40 bg-surface text-text"
                />
                <input
                  type="text"
                  value={src.siteName ?? ''}
                  onChange={e => setDraft(p => { const s = [...p.sources]; s[idx] = { ...s[idx], siteName: e.target.value }; return { ...p, sources: s } })}
                  placeholder="Site Name"
                  className="w-full border border-slate-400 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-600/40 bg-surface text-text"
                />
                <input
                  type="text"
                  value={src.articleDate ?? ''}
                  onChange={e => setDraft(p => { const s = [...p.sources]; s[idx] = { ...s[idx], articleDate: e.target.value }; return { ...p, sources: s } })}
                  placeholder="Date (YYYY-MM-DD)"
                  className="w-full border border-slate-400 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-600/40 bg-surface text-text"
                />
              </div>
            ))}
            <button
              onClick={() => setDraft(p => ({ ...p, sources: [...p.sources, { url: '', siteName: '', articleDate: '' }] }))}
              className="text-xs px-3 py-1.5 rounded-lg border border-slate-400 text-slate-600 font-semibold hover:bg-surface-raised transition-colors"
            >
              + Add Source
            </button>
          </div>
        )}
      </div>

      {/* ── Section D: Images ─────────────────────────────────────────── */}
      <div className="relative bg-surface rounded-2xl border border-slate-300 overflow-hidden mb-4">
        {(generating === 'images' || autoGenerating) && <GeneratingOverlay />}
        <button
          onClick={() => toggleSection('images')}
          className="w-full flex items-center justify-between px-5 py-4 border-b border-slate-300 text-left"
        >
          <h3 className="font-bold text-slate-800">Images</h3>
          <span className="text-slate-400 text-xs">{openSections.images ? '▲' : '▼'}</span>
        </button>
        {openSections.images && (
          <div className="px-5 py-4">
            {draft.category === 'Ranks' ? (
              <p className="text-sm text-slate-400 italic">Rank briefs use the auto-generated SVG insignia — no images needed.</p>
            ) : (<>
            {/* Existing media */}
            {media.length > 0 && (
              <div className="grid grid-cols-2 gap-3 mb-4">
                {media.map(m => {
                  const isExtracting = String(extractingMediaId) === String(m._id)
                  const showCutout   = Boolean(m.cutoutUrl) && !originalPreviewIds.has(String(m._id))
                  const canExtract   = draft.category === 'Aircrafts' && m.mediaType !== 'video'
                  const displaySrc   = showCutout ? m.cutoutUrl : m.mediaUrl
                  const displayBg    = showCutout
                    ? { backgroundImage: 'repeating-conic-gradient(#1e293b 0 25%, #0f172a 0 50%)', backgroundSize: '12px 12px' }
                    : undefined
                  return (
                    <div key={m._id} className="flex flex-col gap-1.5">
                      {/* Thumbnail */}
                      <div className="relative group">
                        <img
                          src={displaySrc}
                          alt={m.name || 'Brief media'}
                          style={displayBg}
                          className={`w-full h-32 rounded-xl border border-slate-200 ${showCutout ? 'object-contain' : 'object-cover'}`}
                        />
                        <button
                          onClick={() => removeMedia(m._id)}
                          className="absolute top-1 right-1 bg-red-500 text-white text-xs rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          ✕
                        </button>
                        {isExtracting && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-xl">
                            <span className="text-[11px] text-white font-semibold animate-pulse">Extracting aircraft…</span>
                          </div>
                        )}
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 rounded-b-xl px-2 py-1 pointer-events-none">
                          <p className="text-[10px] text-white truncate">
                            {m.name ?? m.cloudinaryPublicId ?? m.mediaUrl.split('/').pop().replace(/\.[^.]+$/, '')}
                            {m.cutoutUrl && <span className="ml-1 text-emerald-300">● cutout</span>}
                          </p>
                        </div>
                      </div>
                      {/* Always-visible action row — Aircraft briefs only */}
                      {canExtract && (
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => extractSubject(m._id)}
                            disabled={isExtracting}
                            title={m.cutoutUrl ? 'Re-run extraction (overwrites current cutout)' : 'Extract aircraft from background via AI'}
                            className="flex-1 text-[11px] px-2 py-1 rounded-lg bg-brand-600 text-white font-semibold hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isExtracting
                              ? 'Extracting…'
                              : (m.cutoutUrl ? '↻ Re-extract aircraft' : '✂ Extract aircraft')}
                          </button>
                          {m.cutoutUrl && (
                            <button
                              onClick={() => toggleCutoutPreview(m._id)}
                              title="Toggle original / cutout preview"
                              className={`text-[11px] px-2 py-1 rounded-lg font-semibold transition-colors ${showCutout ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-slate-700 text-slate-100 hover:bg-slate-600'}`}
                            >
                              {showCutout ? 'Show Original' : 'Show Cutout'}
                            </button>
                          )}
                          {m.cutoutUrl && (
                            <button
                              onClick={() => removeCutout(m._id)}
                              title="Permanently remove the cutout (original image stays)"
                              className="text-[11px] px-2 py-1 rounded-lg font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors"
                            >
                              ✕ Remove Cutout
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {media.length === 0 && <p className="text-sm text-slate-400 mb-4">No images yet</p>}

            {/* Generate button */}
            <button
              onClick={generateImages}
              disabled={generating === 'images' || autoGenerating}
              className="text-xs px-3 py-1.5 rounded-lg border border-brand-300 bg-brand-50 text-brand-700 font-semibold hover:bg-brand-100 transition-colors disabled:opacity-40 mb-4"
            >
              {generating === 'images' || autoGenerating ? 'Generating…' : 'Generate 3 Images'}
            </button>

            {/* Pending images */}
            {pendingImages.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 mb-2">Preview — select to include:</p>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  {pendingImages.map((img, i) => (
                    <label key={i} className="relative cursor-pointer">
                      <img src={img.url} alt="Generated image preview" className={`w-full h-32 object-cover rounded-xl border-2 transition-all ${img.selected ? 'border-brand-500' : 'border-slate-200 opacity-50'}`} />
                      <input
                        type="checkbox"
                        checked={img.selected}
                        onChange={e => setPendingImages(p => p.map((x, j) => j === i ? { ...x, selected: e.target.checked } : x))}
                        className="absolute top-2 left-2"
                      />
                      {(img.wikiPage || img.term) && (
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 rounded-b-xl px-2 py-1 pointer-events-none">
                          <p className="text-[10px] text-white truncate">{img.wikiPage || img.term}</p>
                        </div>
                      )}
                    </label>
                  ))}
                </div>
                {briefId && (
                  <button
                    onClick={addSelectedImages}
                    className="text-xs px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 font-semibold hover:bg-emerald-100 transition-colors"
                  >
                    Add Selected Images
                  </button>
                )}
                {!briefId && (
                  <p className="text-xs text-slate-400">Save the brief first to add images.</p>
                )}
              </div>
            )}
            </>)}
          </div>
        )}
      </div>

      {/* ── Section D: Stats & Mnemonics (BOO categories only) ────────── */}
      {BOO_CATEGORIES.includes(draft.category) && (
        <div className="relative bg-surface rounded-2xl border border-slate-300 overflow-hidden mb-4">
          {(autoGenerating || regeneratingAll) && <GeneratingOverlay />}
          <button
            onClick={() => toggleSection('stats')}
            className="w-full flex items-center justify-between px-5 py-4 border-b border-slate-300 text-left"
          >
            <h3 className="font-bold text-slate-800">📊 Stats & Mnemonics</h3>
            <span className="text-slate-400 text-xs">{openSections.stats ? '▲' : '▼'}</span>
          </button>
          {openSections.stats && (
            <div className="px-5 py-4 space-y-3">
              {draft.category === 'Aircrafts' && (
                <AircraftDataSection draft={draft} setDraft={setDraft} briefId={briefId} API={API} />
              )}
              {draft.category === 'Ranks' && (
                <RankDataField draft={draft} setDraft={setDraft} briefId={briefId} API={API} />
              )}
              {draft.category === 'Training' && (
                <TrainingDataSection draft={draft} setDraft={setDraft} briefId={briefId} API={API} />
              )}
              {['Missions', 'Tech', 'Treaties', 'Bases', 'Squadrons', 'Threats'].includes(draft.category) && (<>
                <GameDataField
                  label={{ Bases: 'Year Opened', Squadrons: 'Year Formed', Threats: 'Year Introduced' }[draft.category] ?? 'Start Year'}
                  field="startYear" draft={draft} setDraft={setDraft}
                />
                <MnemonicField mnemonicKey="startYear" draft={draft} setDraft={setDraft} briefId={briefId} API={API} />

                <GameDataField
                  label={{ Bases: 'Year Closed (blank = still active)', Squadrons: 'Year Disbanded (blank = still active)', Threats: 'Year Retired (blank = in service)' }[draft.category] ?? 'End Year (blank = ongoing)'}
                  field="endYear" draft={draft} setDraft={setDraft} nullable
                />
                {['Missions', 'Tech', 'Treaties'].includes(draft.category)
                  ? <MnemonicField mnemonicKey="period" draft={draft} setDraft={setDraft} briefId={briefId} API={API} />
                  : <MnemonicField mnemonicKey="status" draft={draft} setDraft={setDraft} briefId={briefId} API={API} />
                }

                <div className="pt-1 flex flex-wrap gap-2 items-center">
                  <GenerateStatsButton draft={draft} setDraft={setDraft} briefId={briefId} API={API} />
                  <GenerateAllMnemonicsButton draft={draft} setDraft={setDraft} briefId={briefId} API={API} />
                </div>
              </>)}
            </div>
          )}
        </div>
      )}


      {/* ── Section D2: Linked Briefs ────────────────────────────────── */}
      {(() => {
        const cat = draft.category
        const linkedSections = []

        if (['Aircrafts', 'Squadrons', 'Training', 'Roles'].includes(cat))
          linkedSections.push({
            label: '🗺️ Home Bases', desc: 'Link base briefs', field: 'associatedBaseBriefIds', pool: allBasesBriefs, linkType: 'bases',
          })
        if (['Bases', 'Aircrafts', 'Training'].includes(cat))
          linkedSections.push({
            label: '✈️ Squadrons', desc: 'Link squadron briefs', field: 'associatedSquadronBriefIds', pool: allSquadronsBriefs, linkType: 'squadrons',
          })
        if (['Bases', 'Squadrons', 'Tech'].includes(cat))
          linkedSections.push({
            label: '🛩️ Aircraft', desc: 'Link aircraft briefs', field: 'associatedAircraftBriefIds', pool: allAircraftBriefs, linkType: 'aircraft',
          })
        if (['Aircrafts', 'Squadrons'].includes(cat))
          linkedSections.push({
            label: '🎖️ Missions', desc: 'Link mission/operation briefs', field: 'associatedMissionBriefIds', pool: allMissionsBriefs, linkType: 'missions',
          })
        if (['Roles'].includes(cat))
          linkedSections.push({
            label: '🎓 Training', desc: 'Link training programme briefs', field: 'associatedTrainingBriefIds', pool: allTrainingsBriefs, linkType: 'training',
          })
        if (['Aircrafts'].includes(cat))
          linkedSections.push({
            label: '🛠️ Tech', desc: 'Link weapons, sensors, EW, and C2 tech briefs', field: 'associatedTechBriefIds', pool: allTechBriefs, linkType: 'tech',
          })
        // Related Briefs uses its own dedicated pool + search — handled separately below

        const relatedFiltered = allRelatedPool.filter(b =>
          !relatedSearch || b.title.toLowerCase().includes(relatedSearch.toLowerCase())
        )
        const selectedRelated = (draft.relatedBriefIds ?? [])
        const selectedRelatedBriefs = allRelatedPool.filter(b => selectedRelated.includes(String(b._id)))

        const totalLinked =
          (linkedSections.reduce((sum, sec) => sum + (draft[sec.field] ?? []).length, 0))
          + (draft.relatedBriefIds ?? []).length

        return (
          <div className="relative bg-surface rounded-2xl border border-slate-300 overflow-hidden mb-4">
            {autoGenerating && <GeneratingOverlay />}
            <button
              onClick={() => toggleSection('linkedBriefs')}
              className="w-full flex items-center justify-between px-5 py-4 border-b border-slate-300 text-left"
            >
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-slate-800">🕸️ Linked Briefs</h3>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${totalLinked > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-surface-raised text-text-muted'}`}>
                    {totalLinked} selected
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">Connect related briefs to build the knowledge graph</p>
              </div>
              <span className="text-slate-400 text-xs">{openSections.linkedBriefs ? '▲' : '▼'}</span>
            </button>
            {openSections.linkedBriefs && (
            <div className="px-5 py-4 space-y-5">
              {linkedSections.map(sec => (
                <div key={sec.field}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-bold text-slate-600">{sec.label}</p>
                      {(() => { const n = (draft[sec.field] ?? []).length; return (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${n > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-surface-raised text-text-muted'}`}>{n} selected</span>
                      )})()}
                    </div>
                    <GenerateSectionLinksButton
                      sourceTitle={draft.title}
                      sourceDescription={draft.descriptionSections.map(s => s.body ?? '').join(' ')}
                      sourceCategory={draft.category}
                      linkType={sec.linkType}
                      pool={sec.pool}
                      isHistoric={draft.historic ?? false}
                      briefId={briefId}
                      API={API}
                      onResult={ids => setDraft(p => ({ ...p, [sec.field]: ids }))}
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 mb-2">{sec.desc}</p>
                  {sec.pool.length === 0 ? (
                    <p className="text-xs text-slate-400">No briefs available yet.</p>
                  ) : (
                    <div className="space-y-1 max-h-40 overflow-y-auto border border-slate-300 rounded-xl p-2">
                      {sec.pool.slice().sort((a, b) => a.title.localeCompare(b.title)).map(b => {
                        const checked = (draft[sec.field] ?? []).includes(String(b._id))
                        return (
                          <label key={b._id} className="flex items-center gap-2 cursor-pointer py-0.5">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={e => setDraft(p => {
                                const ids = p[sec.field] ?? []
                                return {
                                  ...p,
                                  [sec.field]: e.target.checked
                                    ? [...ids, String(b._id)]
                                    : ids.filter(id => id !== String(b._id)),
                                }
                              })}
                              className="rounded"
                            />
                            <span className="text-sm text-slate-700">{b.title}</span>
                            {b.status === 'stub' && (
                              <span className="text-[10px] text-slate-400 ml-auto">stub</span>
                            )}
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))}

              {/* ── Related Briefs (searchable, all non-typed categories) ── */}
              <div>
                <p className="text-xs font-bold text-slate-600 mb-1">🔗 Related Briefs</p>
                <p className="text-[11px] text-slate-400 mb-2">Cross-category links — Threats, Allies, Terminology, AOR, etc.</p>
                {selectedRelatedBriefs.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {selectedRelatedBriefs.map(b => (
                      <span key={b._id} className="flex items-center gap-1 text-[11px] bg-brand-50 border border-brand-200 text-brand-700 rounded-full px-2 py-0.5">
                        {b.title}
                        <button
                          onClick={() => setDraft(p => ({ ...p, relatedBriefIds: p.relatedBriefIds.filter(id => id !== String(b._id)) }))}
                          className="text-brand-400 hover:text-brand-700 leading-none"
                        >×</button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="relative mb-1">
                  <input
                    type="text"
                    value={relatedSearch}
                    onChange={e => setRelatedSearch(e.target.value)}
                    placeholder="Search briefs…"
                    className="w-full border border-slate-400 rounded-xl px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-600/40 focus:border-brand-500 bg-surface-raised text-text"
                  />
                  {relatedSearch && (
                    <button onClick={() => setRelatedSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs">✕</button>
                  )}
                </div>
                {relatedSearch && (
                  <div className="space-y-1 max-h-48 overflow-y-auto border border-slate-300 rounded-xl p-2">
                    {relatedFiltered.length === 0 ? (
                      <p className="text-xs text-slate-400 py-1 px-1">No results</p>
                    ) : relatedFiltered.map(b => {
                      const checked = selectedRelated.includes(String(b._id))
                      return (
                        <label key={b._id} className="flex items-center gap-2 cursor-pointer py-0.5">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={e => setDraft(p => {
                              const ids = p.relatedBriefIds ?? []
                              return {
                                ...p,
                                relatedBriefIds: e.target.checked
                                  ? [...ids, String(b._id)]
                                  : ids.filter(id => id !== String(b._id)),
                              }
                            })}
                            className="rounded"
                          />
                          <span className="text-sm text-slate-700 flex-1">{b.title}</span>
                          <span className="text-[10px] text-slate-400 shrink-0">{b.category}</span>
                          {b.status === 'stub' && (
                            <span className="text-[10px] text-slate-400">stub</span>
                          )}
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
            )}
          </div>
        )
      })()}

      {/* ── Section F: Keywords ───────────────────────────────────────── */}
      <div className="relative bg-surface rounded-2xl border border-slate-300 overflow-hidden mb-4">
        {(generating === 'keywords' || genKeywordsSingle || autoGenerating || regeneratingAll) && <GeneratingOverlay />}
        <div
          onClick={() => toggleSection('keywords')}
          className="w-full flex items-center justify-between px-5 py-4 border-b border-slate-300 text-left cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-slate-800">Keywords</h3>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${draft.keywords.length >= keywordsPerBrief ? 'bg-emerald-100 text-emerald-700' : 'bg-surface-raised text-text-muted'}`}>
              {draft.keywords.length} / {keywordsPerBrief}
            </span>
            {badKeywords.length > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                {badKeywords.length} not in text
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {draft.keywords.length < keywordsPerBrief && (
              <button
                onClick={e => { e.stopPropagation(); generateSingleKeyword() }}
                disabled={generating === 'keywords' || generating === 'description' || genKeywordsSingle || regeneratingAll}
                className="text-xs px-3 py-1.5 rounded-lg border border-brand-300 bg-brand-50 text-brand-700 font-semibold hover:bg-brand-100 transition-colors disabled:opacity-40"
              >
                {genKeywordsSingle ? '↺ Generating…' : `↺ Generate Missing (${keywordsPerBrief - draft.keywords.length})`}
              </button>
            )}
            <span className="text-slate-400 text-xs">{openSections.keywords ? '▲' : '▼'}</span>
          </div>
        </div>
        {openSections.keywords && (
          <div className="px-5 py-4 space-y-3">
            {draft.keywords.map((kw, idx) => (
              <div key={idx} className={`p-3 rounded-xl border ${!descLower.includes(kw.keyword?.toLowerCase()) && kw.keyword ? 'border-amber-200 bg-amber-50' : 'border-slate-300 bg-surface-raised'}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs font-semibold text-slate-500">Keyword {idx + 1}</label>
                    {kw.linkedBriefId && (
                      <span
                        title={kw.linkedBriefTitle || 'Linked brief'}
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-brand-100 text-brand-700 border border-brand-200 cursor-help"
                      >→ Brief</span>
                    )}
                  </div>
                  <button
                    onClick={() => setDraft(p => ({ ...p, keywords: p.keywords.filter((_, i) => i !== idx) }))}
                    className="text-xs text-red-400 hover:text-red-600"
                  >
                    Remove
                  </button>
                </div>
                <input
                  type="text"
                  value={kw.keyword}
                  onChange={e => setDraft(p => {
                    const kws = [...p.keywords]; kws[idx] = { ...kws[idx], keyword: e.target.value }; return { ...p, keywords: kws }
                  })}
                  placeholder="Keyword"
                  className="w-full border border-slate-400 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-600/40 bg-surface text-text mb-1.5"
                />
                <textarea
                  rows={2}
                  value={kw.generatedDescription ?? ''}
                  onChange={e => setDraft(p => {
                    const kws = [...p.keywords]; kws[idx] = { ...kws[idx], generatedDescription: e.target.value }; return { ...p, keywords: kws }
                  })}
                  placeholder="Description"
                  className="w-full border border-slate-400 rounded-lg px-3 py-1.5 text-sm resize-none outline-none focus:ring-2 focus:ring-brand-600/40 bg-surface text-text"
                />
              </div>
            ))}
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setDraft(p => ({ ...p, keywords: [...p.keywords, { keyword: '', generatedDescription: '' }] }))}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-400 text-slate-600 font-semibold hover:bg-surface-raised transition-colors"
              >
                + Add Keyword
              </button>
              <button
                onClick={generateKeywords}
                disabled={generating === 'keywords' || generating === 'description' || genKeywordsSingle || regeneratingAll}
                className="text-xs px-3 py-1.5 rounded-lg border border-brand-300 bg-brand-50 text-brand-700 font-semibold hover:bg-brand-100 transition-colors disabled:opacity-40"
              >
                {generating === 'keywords' ? '↺ Regenerating…' : '↺ Regenerate All Keywords'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Section G: Quiz Questions ─────────────────────────────────── */}
      <div className="relative bg-surface rounded-2xl border border-slate-300 overflow-hidden mb-4">
        {(generating === 'questions' || genQuestionsSingle || autoGenerating || regeneratingAll) && <GeneratingOverlay />}
        <div
          onClick={() => toggleSection('questions')}
          className="w-full flex items-center justify-between px-5 py-4 border-b border-slate-300 text-left cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-slate-800">Quiz Questions</h3>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${easyQuestions.length >= questionsPerDifficulty && mediumQuestions.length >= questionsPerDifficulty ? 'bg-emerald-100 text-emerald-700' : 'bg-surface-raised text-text-muted'}`}>
              {easyQuestions.length + mediumQuestions.length} / 14
            </span>
          </div>
          <div className="flex items-center gap-3">
            {(() => {
              const totalMissing = Math.max(0, questionsPerDifficulty - easyQuestions.length) + Math.max(0, questionsPerDifficulty - mediumQuestions.length)
              return totalMissing > 0 && (
                <button
                  onClick={e => { e.stopPropagation(); generateMissingQuestionsBoth() }}
                  disabled={generating === 'questions' || generating === 'description' || genQuestionsSingle || autoGenerating || regeneratingAll}
                  className="text-xs px-3 py-1.5 rounded-lg border border-brand-300 bg-brand-50 text-brand-700 font-semibold hover:bg-brand-100 transition-colors disabled:opacity-40"
                >
                  {genQuestionsSingle ? '↺ Generating…' : `↺ Generate Missing (${totalMissing})`}
                </button>
              )
            })()}
            <span className="text-slate-400 text-xs">{openSections.questions ? '▲' : '▼'}</span>
          </div>
        </div>
        {openSections.questions && (
          <div className="px-5 py-4">
            {/* Tab switcher */}
            <div className="flex gap-1 bg-surface-raised rounded-xl p-1 mb-4">
              {['easy', 'medium'].map(t => (
                <button
                  key={t}
                  onClick={() => setQTab(t)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all capitalize ${qTab === t ? 'bg-surface shadow text-slate-800' : 'text-slate-500'}`}
                >
                  {t} ({t === 'easy' ? easyQuestions.length : mediumQuestions.length})
                </button>
              ))}
            </div>

            {/* Questions list */}
            <div className="space-y-4">
              {currentQuestions.map((q, qIdx) => (
                <div key={qIdx} className="border border-slate-300 rounded-xl p-4 bg-surface-raised">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-500">Q{qIdx + 1}</span>
                    <button
                      onClick={() => setCurrentQuestions(p => p.filter((_, i) => i !== qIdx))}
                      className="text-xs text-red-400 hover:text-red-600"
                    >
                      Remove
                    </button>
                  </div>
                  <input
                    type="text"
                    value={q.question}
                    onChange={e => updateQuestion(qIdx, 'question', e.target.value)}
                    placeholder="Question text"
                    className="w-full border border-slate-400 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-600/40 bg-surface text-text mb-3"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    {(q.answers ?? []).map((ans, aIdx) => (
                      <label key={aIdx} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={`q-${qIdx}-correct`}
                          checked={q.correctAnswerIndex === aIdx}
                          onChange={() => updateQuestion(qIdx, 'correctAnswerIndex', aIdx)}
                          className="shrink-0"
                        />
                        <input
                          type="text"
                          value={ans.title}
                          onChange={e => updateAnswer(qIdx, aIdx, e.target.value)}
                          placeholder={`Answer ${aIdx + 1}`}
                          className="flex-1 border border-slate-400 rounded-lg px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-brand-600/40 bg-surface text-text"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-2 flex-wrap mt-4">
              <button
                onClick={generateQuestions}
                disabled={generating === 'questions' || generating === 'description' || genQuestionsSingle || autoGenerating || regeneratingAll}
                className="text-xs px-3 py-1.5 rounded-lg border border-brand-300 bg-brand-50 text-brand-700 font-semibold hover:bg-brand-100 transition-colors disabled:opacity-40"
              >
                {generating === 'questions' || autoGenerating ? '↺ Generating…' : '↺ Generate Questions'}
              </button>
              {currentQuestions.length < questionsPerDifficulty && (
                <button
                  onClick={addBlankQuestion}
                  disabled={generating === 'questions' || genQuestionsSingle || autoGenerating || regeneratingAll}
                  className="text-xs px-3 py-1.5 rounded-lg border border-slate-400 text-slate-600 font-semibold hover:bg-surface-raised transition-colors disabled:opacity-40"
                >
                  + Add Question
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Returns the gameData field names that must be non-null before a mnemonic can be generated.
function getMnemonicRequiredFields(category, statKey) {
  const map = {
    Aircrafts:  { topSpeedKph: ['topSpeedKph'], yearIntroduced: ['yearIntroduced'], status: ['yearIntroduced'] },
    Ranks:      { rankHierarchyOrder: ['rankHierarchyOrder'] },
    Training:   { pipelinePosition: ['trainingWeekStart', 'trainingWeekEnd'], trainingDuration: ['weeksOfTraining'] },
  }
  const yearBased = ['Missions', 'Tech', 'Treaties', 'Bases', 'Squadrons', 'Threats']
  if (yearBased.includes(category)) {
    if (statKey === 'startYear' || statKey === 'period' || statKey === 'status') return ['startYear']
  }
  return map[category]?.[statKey] ?? []
}

function GenerateAllMnemonicsButton({ draft, setDraft, briefId, API }) {
  const { apiFetch } = useAuth()
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState(null)

  const generate = async () => {
    setBusy(true)
    setErr(null)
    try {
      const res  = await apiFetch(`${API}/api/admin/ai/generate-mnemonic`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: draft.title, category: draft.category, gameData: draft.gameData ?? {}, briefId: briefId || null }),
      })
      const data = await res.json()
      if (data.status === 'success') {
        setDraft(p => ({ ...p, mnemonics: { ...p.mnemonics, ...data.data.mnemonics } }))
      } else {
        setErr(data.message ?? 'Failed')
      }
    } catch {
      setErr('Failed')
    } finally {
      setBusy(false)
    }
  }

  const category  = draft.category ?? ''
  const gameData  = draft.gameData ?? {}
  const allKeys   = ['startYear', 'period', 'status', 'topSpeedKph', 'yearIntroduced',
                     'pipelinePosition', 'trainingDuration', 'rankHierarchyOrder']
  const requiredFields = [...new Set(allKeys.flatMap(k => getMnemonicRequiredFields(category, k)))]
  const missingRequired = requiredFields.some(f => gameData[f] == null || gameData[f] === '')

  return (
    <>
      <button
        onClick={generate}
        disabled={busy || missingRequired}
        title={missingRequired ? 'Fill in required stats first' : undefined}
        className="text-xs px-3 py-2 rounded-xl border border-brand-300 bg-brand-50 text-brand-700 font-semibold hover:bg-brand-100 disabled:opacity-40 transition-colors"
      >
        {busy ? '↺ Generating mnemonics…' : '↺ Generate All Mnemonics'}
      </button>
      {err && <p className="text-xs text-red-500">{err}</p>}
    </>
  )
}

// ── MnemonicField — paired mnemonic textarea + generate button ────────────
function MnemonicField({ mnemonicKey, draft, setDraft, briefId, API }) {
  const { apiFetch } = useAuth()
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState(null)

  const generate = async () => {
    setBusy(true)
    setErr(null)
    try {
      const res  = await apiFetch(`${API}/api/admin/ai/generate-mnemonic`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: draft.title, category: draft.category, gameData: draft.gameData ?? {}, statKey: mnemonicKey, briefId: briefId || null }),
      })
      const data = await res.json()
      if (data.status === 'success') {
        setDraft(p => ({ ...p, mnemonics: { ...p.mnemonics, ...data.data.mnemonics } }))
      } else {
        setErr(data.message ?? 'Failed')
      }
    } catch {
      setErr('Failed')
    } finally {
      setBusy(false)
    }
  }

  const requiredFields  = getMnemonicRequiredFields(draft.category ?? '', mnemonicKey)
  const gameData        = draft.gameData ?? {}
  const missingRequired = requiredFields.some(f => gameData[f] == null || gameData[f] === '')

  return (
    <div className="flex gap-2 items-start mt-1 mb-2">
      <textarea
        value={draft.mnemonics?.[mnemonicKey] ?? ''}
        onChange={e => setDraft(p => ({ ...p, mnemonics: { ...p.mnemonics, [mnemonicKey]: e.target.value } }))}
        rows={2}
        placeholder="💡 Memory aid…"
        className="flex-1 border border-slate-400 bg-surface-raised rounded-xl px-3 py-2 text-xs text-text outline-none focus:ring-2 focus:ring-brand-600/40 resize-none"
      />
      <button
        onClick={generate}
        disabled={busy || missingRequired}
        title={missingRequired ? 'Fill in required stats first' : 'Generate mnemonic'}
        className="text-xs px-2.5 py-1.5 rounded-lg border border-brand-200 bg-brand-50 text-brand-600 font-semibold hover:bg-brand-100 disabled:opacity-40 transition-colors shrink-0 mt-0.5"
      >
        {busy ? '…' : '↺'}
      </button>
      {err && <p className="text-xs text-red-500 mt-1 col-span-2">{err}</p>}
    </div>
  )
}

function GameDataField({ label, field, draft, setDraft, nullable = false }) {
  const val = draft.gameData?.[field]
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-500 mb-1">{label}</label>
      <input
        type="number"
        value={val ?? ''}
        onChange={e => {
          const raw = e.target.value
          const num = raw === '' ? (nullable ? null : undefined) : parseInt(raw, 10)
          setDraft(p => ({ ...p, gameData: { ...p.gameData, [field]: raw === '' ? null : num } }))
        }}
        placeholder={nullable ? 'blank = null' : ''}
        className="w-full border border-slate-400 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-600/40 bg-surface-raised text-text"
      />
    </div>
  )
}

function GenerateStatsButton({ draft, setDraft, briefId, API }) {
  const { apiFetch } = useAuth()
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState(null)

  const generate = async () => {
    setBusy(true)
    setErr(null)
    try {
      const res  = await apiFetch(`${API}/api/admin/ai/generate-battle-order-data`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:       draft.title,
          description: draft.descriptionSections.map(s => s.body ?? '').join('\n\n'),
          category:    draft.category,
          briefId:     briefId || null,
        }),
      })
      const data = await res.json()
      if (data.status === 'success') {
        setDraft(p => ({ ...p, gameData: { ...p.gameData, ...data.data.gameData } }))
      } else {
        setErr(data.message ?? 'Generation failed')
      }
    } catch {
      setErr('Generation failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        onClick={generate}
        disabled={busy}
        className="text-xs px-3 py-2 rounded-xl border border-brand-300 bg-brand-50 text-brand-700 font-semibold hover:bg-brand-100 disabled:opacity-40 transition-colors"
      >
        {busy ? '↺ Generating…' : '↺ Generate Stats'}
      </button>
      {err && <p className="text-xs text-red-500">{err}</p>}
    </>
  )
}

function AircraftDataSection({ draft, setDraft, briefId, API }) {
  const { apiFetch } = useAuth()
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState(null)

  const generate = async () => {
    setBusy(true)
    setErr(null)
    try {
      const res  = await apiFetch(`${API}/api/admin/ai/generate-battle-order-data`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:       draft.title,
          description: draft.descriptionSections.map(s => s.body ?? '').join('\n\n'),
          category:    'Aircrafts',
          briefId:     briefId || null,
        }),
      })
      const data = await res.json()
      if (data.status === 'success') {
        setDraft(p => ({ ...p, gameData: { ...p.gameData, ...data.data.gameData } }))
      } else {
        setErr(data.message ?? 'Generation failed')
      }
    } catch {
      setErr('Generation failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <GameDataField label="Top Speed (km/h)" field="topSpeedKph" draft={draft} setDraft={setDraft} />
      <MnemonicField mnemonicKey="topSpeedKph" draft={draft} setDraft={setDraft} briefId={briefId} API={API} />

      <GameDataField label="Year Introduced" field="yearIntroduced" draft={draft} setDraft={setDraft} />
      <MnemonicField mnemonicKey="yearIntroduced" draft={draft} setDraft={setDraft} briefId={briefId} API={API} />

      <GameDataField label="Year Retired (blank = still in service)" field="yearRetired" draft={draft} setDraft={setDraft} nullable />
      <MnemonicField mnemonicKey="status" draft={draft} setDraft={setDraft} briefId={briefId} API={API} />

      <div className="pt-1 flex flex-wrap gap-2 items-center">
        <button
          onClick={generate}
          disabled={busy}
          className="text-xs px-3 py-2 rounded-xl border border-brand-300 bg-brand-50 text-brand-700 font-semibold hover:bg-brand-100 disabled:opacity-40 transition-colors"
        >
          {busy ? '↺ Generating…' : '↺ Generate Stats'}
        </button>
        <GenerateAllMnemonicsButton draft={draft} setDraft={setDraft} briefId={briefId} API={API} />
        {err && <p className="text-xs text-red-500">{err}</p>}
      </div>
    </>
  )
}

function TrainingDataSection({ draft, setDraft, briefId, API }) {
  const { apiFetch } = useAuth()
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState(null)

  const generate = async () => {
    setBusy(true)
    setErr(null)
    try {
      const res  = await apiFetch(`${API}/api/admin/ai/generate-battle-order-data`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:       draft.title,
          description: draft.descriptionSections.map(s => s.body ?? '').join('\n\n'),
          category:    'Training',
          briefId:     briefId || null,
        }),
      })
      const data = await res.json()
      if (data.status === 'success') {
        setDraft(p => ({ ...p, gameData: { ...p.gameData, ...data.data.gameData } }))
      } else {
        setErr(data.message ?? 'Generation failed')
      }
    } catch {
      setErr('Generation failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <GameDataField label="Pipeline Week Start (0 if unknown)" field="trainingWeekStart" draft={draft} setDraft={setDraft} />
      <GameDataField label="Pipeline Week End (0 if unknown)"   field="trainingWeekEnd"   draft={draft} setDraft={setDraft} />
      <MnemonicField mnemonicKey="pipelinePosition" draft={draft} setDraft={setDraft} briefId={briefId} API={API} />

      <GameDataField label="Training Duration (weeks, 0 if unknown)" field="weeksOfTraining" draft={draft} setDraft={setDraft} />
      <MnemonicField mnemonicKey="trainingDuration" draft={draft} setDraft={setDraft} briefId={briefId} API={API} />

      <div className="pt-1 flex flex-wrap gap-2 items-center">
        <button
          onClick={generate}
          disabled={busy}
          className="text-xs px-3 py-2 rounded-xl border border-brand-300 bg-brand-50 text-brand-700 font-semibold hover:bg-brand-100 disabled:opacity-40 transition-colors"
        >
          {busy ? '↺ Generating…' : '↺ Generate Stats'}
        </button>
        <GenerateAllMnemonicsButton draft={draft} setDraft={setDraft} briefId={briefId} API={API} />
        {err && <p className="text-xs text-red-500">{err}</p>}
      </div>
    </>
  )
}

function RankDataField({ draft, setDraft, briefId, API }) {
  const { apiFetch } = useAuth()
  const [busy,        setBusy]        = useState(false)
  const [err,         setErr]         = useState(null)
  const [recompactBusy, setRecompactBusy] = useState(false)
  const [recompactMsg,  setRecompactMsg]  = useState(null)

  const lookup = async () => {
    if (!briefId) return
    setBusy(true)
    setErr(null)
    try {
      const res  = await apiFetch(`${API}/api/admin/ai/generate-rank-data/${briefId}`, {
        method: 'POST', credentials: 'include',
      })
      const data = await res.json()
      if (data.status === 'success') {
        setDraft(p => ({ ...p, gameData: { ...p.gameData, rankHierarchyOrder: data.data.rankHierarchyOrder } }))
      } else {
        setErr(data.message ?? 'Lookup failed')
      }
    } catch {
      setErr('Lookup failed')
    } finally {
      setBusy(false)
    }
  }

  const recompact = async () => {
    setRecompactBusy(true)
    setRecompactMsg(null)
    try {
      const res = await apiFetch(`${API}/api/admin/intel-leads/recompact-rank-order`, {
        method: 'POST', credentials: 'include',
      })
      const data = await res.json()
      if (data.status === 'success') {
        const { leadsCompacted, briefsUpdated } = data.data ?? {}
        setRecompactMsg(`Recompacted ${leadsCompacted ?? 0} lead(s), ${briefsUpdated ?? 0} brief(s) updated.`)
      } else {
        setRecompactMsg(data.message ?? 'Recompact failed')
      }
    } catch {
      setRecompactMsg('Recompact failed')
    } finally {
      setRecompactBusy(false)
    }
  }

  const rankNumber = draft.gameData?.rankHierarchyOrder != null
    ? 20 - draft.gameData.rankHierarchyOrder
    : null

  return (
    <div>
      {rankNumber != null && rankNumber >= 1 && rankNumber <= 19 && (
        <div className="flex justify-center py-4 bg-slate-900 rounded-xl mb-3">
          <RankBadge rankNumber={rankNumber} size={80} color="#5baaff" />
        </div>
      )}
      <label className="block text-xs font-semibold text-slate-500 mb-1">Seniority Order (1 = most senior)</label>
      <div className="flex gap-2">
        <input
          type="number"
          value={draft.gameData?.rankHierarchyOrder ?? ''}
          onChange={e => {
            const raw = e.target.value
            setDraft(p => ({ ...p, gameData: { ...p.gameData, rankHierarchyOrder: raw === '' ? null : parseInt(raw, 10) } }))
          }}
          className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-200"
        />
        {briefId && (
          <button
            onClick={lookup}
            disabled={busy}
            className="text-xs px-3 py-2 rounded-xl border border-brand-300 bg-brand-50 text-brand-700 font-semibold whitespace-nowrap hover:bg-brand-100 disabled:opacity-40"
          >
            {busy ? '…' : 'Lookup Rank →'}
          </button>
        )}
      </div>
      {err && <p className="text-xs text-red-500 mt-1">{err}</p>}
      <div className="flex items-center gap-2 mt-2">
        <button
          type="button"
          onClick={recompact}
          disabled={recompactBusy}
          className="text-xs px-3 py-1.5 rounded-xl border border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
          title="Re-number every Ranks lead 1..N (idempotent self-heal)"
        >
          {recompactBusy ? 'Recompacting…' : 'Recompact rank order'}
        </button>
        {recompactMsg && <span className="text-xs text-slate-500">{recompactMsg}</span>}
      </div>
      <MnemonicField mnemonicKey="rankHierarchyOrder" draft={draft} setDraft={setDraft} briefId={briefId} API={API} />
      <GenerateAllMnemonicsButton draft={draft} setDraft={setDraft} briefId={briefId} API={API} />
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// LOGS TAB
// ─────────────────────────────────────────────────────────────────────────────

const ACTION_TYPE_LABELS = {
  ban_user:                  { label: 'Ban User',              color: 'bg-red-900/40 text-red-300'       },
  unban_user:                { label: 'Unban User',            color: 'bg-green-900/40 text-green-300'   },
  delete_user:               { label: 'Delete User',           color: 'bg-red-900/40 text-red-300'       },
  remove_admin:              { label: 'Remove Admin',          color: 'bg-orange-900/40 text-orange-300' },
  reset_user_stats:          { label: 'Reset Stats',           color: 'bg-amber-900/40 text-amber-300'   },
  make_admin:                { label: 'Make Admin',            color: 'bg-purple-900/40 text-purple-300' },
  change_quiz_questions:     { label: 'Quiz Questions',        color: 'bg-blue-900/40 text-blue-300'     },
  change_airstars:           { label: 'Airstars',              color: 'bg-amber-900/40 text-amber-300'   },
  change_trial_duration:     { label: 'Trial Duration',        color: 'bg-slate-700 text-slate-300'      },
  change_silver_categories:  { label: 'Silver Categories',     color: 'bg-slate-700 text-slate-300'      },
  change_ammo_defaults:      { label: 'Ammo Defaults',         color: 'bg-slate-700 text-slate-300'      },
  create_brief:              { label: 'Create Brief',          color: 'bg-emerald-900/40 text-emerald-300' },
  edit_brief:                { label: 'Edit Brief',            color: 'bg-sky-900/40 text-sky-300'       },
  delete_brief:              { label: 'Delete Brief',          color: 'bg-red-900/40 text-red-300'       },
  regenerate_brief_cascade:  { label: 'Regenerate Brief',      color: 'bg-violet-900/40 text-violet-300' },
  award_test_coins:          { label: 'Award Airstars',        color: 'bg-amber-900/40 text-amber-300'   },
  change_subscription:       { label: 'Change Subscription',   color: 'bg-indigo-900/40 text-indigo-300' },
}

const ALL_ACTION_TYPES = Object.keys(ACTION_TYPE_LABELS)

function LabelBadge({ label, color, uppercase = false }) {
  return (
    <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${uppercase ? 'uppercase tracking-wide' : ''} ${color}`}>
      {label}
    </span>
  )
}

function ActionBadge({ type }) {
  const meta = ACTION_TYPE_LABELS[type] ?? { label: type, color: 'bg-slate-700 text-slate-300' }
  return <LabelBadge label={meta.label} color={meta.color} />
}

function LogsTab({ API }) {
  const { apiFetch } = useAuth()
  const [actions,    setActions]    = useState([])
  const [loading,    setLoading]    = useState(true)
  const [page,       setPage]       = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total,      setTotal]      = useState(0)
  const [typeFilter, setTypeFilter] = useState('')

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ page, limit: 20 })
    if (typeFilter) params.set('type', typeFilter)
    apiFetch(`${API}/api/admin/actions?${params}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        setActions(d.data?.actions ?? [])
        setTotal(d.data?.total ?? 0)
        setTotalPages(d.data?.totalPages ?? 1)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [API, page, typeFilter])

  const handleTypeChange = (e) => {
    setTypeFilter(e.target.value)
    setPage(1)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3">
        <h2 className="text-base font-bold text-slate-900">Admin Action Logs</h2>
        <select
          value={typeFilter}
          onChange={handleTypeChange}
          className="text-xs border border-slate-700 rounded-lg px-2 py-1.5 text-slate-300 bg-surface focus:outline-none focus:ring-1 focus:ring-brand-400"
        >
          <option value="">All actions</option>
          {ALL_ACTION_TYPES.map(t => (
            <option key={t} value={t}>{ACTION_TYPE_LABELS[t].label}</option>
          ))}
        </select>
      </div>

      <div className="bg-surface rounded-2xl border border-slate-700 overflow-hidden mb-4">
        {loading && <p className="py-8 text-center text-slate-400 text-sm animate-pulse">Loading…</p>}
        {!loading && actions.length === 0 && (
          <p className="py-8 text-center text-slate-400 text-sm">No logs found</p>
        )}
        {!loading && actions.map((a, i) => {
          const admin  = a.userId
          const target = a.targetUserId
          return (
            <div
              key={a._id}
              className={`px-4 py-3 ${i !== 0 ? 'border-t border-slate-700/50' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <ActionBadge type={a.actionType} />
                    {target && (
                      <span className="text-[10px] text-slate-400">
                        → Agent {target.agentNumber ?? target.email ?? '?'}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-300 truncate">{a.reason}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    Agent {admin?.agentNumber ?? admin?.email ?? '?'}
                  </p>
                </div>
                <span className="text-[10px] text-slate-400 whitespace-nowrap shrink-0">
                  {new Date(a.time).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 font-semibold disabled:opacity-40 hover:bg-surface-raised transition-colors"
          >
            ← Prev
          </button>
          <span className="text-xs text-slate-400">Page {page} of {totalPages} ({total} total)</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 font-semibold disabled:opacity-40 hover:bg-surface-raised transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL LOGS TAB
// ─────────────────────────────────────────────────────────────────────────────

const EMAIL_TYPE_LABELS = {
  welcome:        { label: 'Welcome',        color: 'bg-blue-900/40 text-blue-300' },
  confirmation:   { label: 'Confirmation',   color: 'bg-purple-900/40 text-purple-300' },
  password_reset: { label: 'Password Reset', color: 'bg-amber-900/40 text-amber-300' },
  report_reply:   { label: 'Report Reply',   color: 'bg-teal-900/40 text-teal-300' },
  test:           { label: 'Test',           color: 'bg-slate-700 text-slate-300' },
}

function EmailTypeBadge({ type }) {
  const info = EMAIL_TYPE_LABELS[type] ?? { label: type, color: 'bg-slate-700 text-slate-300' }
  return <LabelBadge label={info.label} color={info.color} uppercase />
}

function EmailLogsTab({ API, initialStatusFilter }) {
  const { apiFetch } = useAuth()
  const [logs,       setLogs]       = useState([])
  const [loading,    setLoading]    = useState(true)
  const [page,       setPage]       = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total,      setTotal]      = useState(0)
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState(initialStatusFilter ?? '')
  const [search,     setSearch]     = useState('')
  const [searchInput, setSearchInput] = useState('')

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ page, limit: 50 })
    if (typeFilter)   params.set('type',   typeFilter)
    if (statusFilter) params.set('status', statusFilter)
    if (search)       params.set('search', search)
    apiFetch(`${API}/api/admin/email-logs?${params}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        setLogs(d.data?.logs ?? [])
        setTotal(d.data?.total ?? 0)
        setTotalPages(d.data?.totalPages ?? 1)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [API, page, typeFilter, statusFilter, search])

  const handleSearch = (e) => {
    e.preventDefault()
    setSearch(searchInput.trim())
    setPage(1)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <h2 className="text-base font-bold text-slate-900">Email Logs</h2>
        <div className="flex gap-2 flex-wrap">
          <select
            value={typeFilter}
            onChange={e => { setTypeFilter(e.target.value); setPage(1) }}
            className="text-xs border border-slate-700 rounded-lg px-2 py-1.5 text-slate-300 bg-surface focus:outline-none focus:ring-1 focus:ring-brand-400"
          >
            <option value="">All types</option>
            {Object.entries(EMAIL_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
            className="text-xs border border-slate-700 rounded-lg px-2 py-1.5 text-slate-300 bg-surface focus:outline-none focus:ring-1 focus:ring-brand-400"
          >
            <option value="">All statuses</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="Search by email…"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          className="flex-1 text-xs border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 bg-surface placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-brand-400"
        />
        <button
          type="submit"
          className="text-xs px-3 py-1.5 rounded-lg bg-brand-600 text-white font-semibold hover:bg-brand-700 transition-colors"
        >
          Search
        </button>
        {search && (
          <button
            type="button"
            onClick={() => { setSearch(''); setSearchInput(''); setPage(1) }}
            className="text-xs px-2 py-1.5 rounded-lg border border-slate-700 text-slate-400 hover:bg-surface-raised transition-colors"
          >
            Clear
          </button>
        )}
      </form>

      <div className="bg-surface rounded-2xl border border-slate-700 overflow-hidden mb-4">
        {loading && <p className="py-8 text-center text-slate-400 text-sm animate-pulse">Loading…</p>}
        {!loading && logs.length === 0 && (
          <p className="py-8 text-center text-slate-400 text-sm">No email logs found</p>
        )}
        {!loading && logs.map((log, i) => (
          <div
            key={log._id}
            className={`px-4 py-3 ${i !== 0 ? 'border-t border-slate-700/50' : ''} ${log.status === 'failed' ? 'bg-red-900/10' : ''}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <EmailTypeBadge type={log.type} />
                  <span className={`inline-block text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${log.status === 'sent' ? 'bg-green-900/40 text-green-300' : 'bg-red-900/40 text-red-300'}`}>
                    {log.status}
                  </span>
                </div>
                <p className="text-xs text-slate-200 font-medium truncate">{log.recipientEmail}</p>
                {log.subject && (
                  <p className="text-[11px] text-slate-400 truncate">{log.subject}</p>
                )}
                {log.status === 'failed' && log.error && (
                  <p className="text-[11px] text-red-400 mt-0.5 truncate">{log.error}</p>
                )}
                {log.metadata && Object.keys(log.metadata).length > 0 && (
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {Object.entries(log.metadata).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                  </p>
                )}
              </div>
              <span className="text-[10px] text-slate-400 whitespace-nowrap shrink-0">
                {new Date(log.sentAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 font-semibold disabled:opacity-40 hover:bg-surface-raised transition-colors"
          >
            ← Prev
          </button>
          <span className="text-xs text-slate-400">Page {page} of {totalPages} ({total} total)</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 font-semibold disabled:opacity-40 hover:bg-surface-raised transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// INTEL TAB (Reports + Action Logs + Email Logs)
// ─────────────────────────────────────────────────────────────────────────────

const INTEL_SUBTABS = [
  { id: 'reports',     label: 'Reports'      },
  { id: 'action-log',  label: 'Action Logs'  },
  { id: 'email-log',   label: 'Email Logs'   },
  { id: 'system-logs', label: 'System Logs'  },
]

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM LOGS TAB
// ─────────────────────────────────────────────────────────────────────────────

function SystemLogsTab({ API, onResolved }) {
  const { apiFetch } = useAuth()
  const [logs,       setLogs]       = useState([])
  const [loading,    setLoading]    = useState(true)
  const [page,       setPage]       = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total,      setTotal]      = useState(0)
  const [showAll,    setShowAll]    = useState(false)
  const [resolving,  setResolving]  = useState(null)
  const [retrying,   setRetrying]   = useState(null)
  const [retryMsg,   setRetryMsg]   = useState(null)  // { id, text, ok }

  const load = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({ page, limit: 20 })
    if (!showAll) params.set('resolved', 'false')
    apiFetch(`${API}/api/admin/system-logs?${params}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        setLogs(d.data?.logs ?? [])
        setTotal(d.data?.total ?? 0)
        setTotalPages(d.data?.totalPages ?? 1)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [API, page, showAll])

  useEffect(() => { load() }, [load])

  const resolve = async (id) => {
    setResolving(id)
    try {
      await apiFetch(`${API}/api/admin/system-logs/${id}/resolve`, { method: 'PATCH', credentials: 'include' })
      load()
      onResolved?.()
    } catch (_) {}
    setResolving(null)
  }

  const retry = async (id) => {
    setRetrying(id)
    setRetryMsg(null)
    try {
      const r = await apiFetch(`${API}/api/admin/system-logs/${id}/retry`, { method: 'POST', credentials: 'include' })
      const d = await r.json()
      if (!r.ok) {
        setRetryMsg({ id, text: d.message || 'Retry failed', ok: false })
      } else if (d.data?.resolved) {
        setRetryMsg({ id, text: 'Re-ranked successfully', ok: true })
        load()
        onResolved?.()
      } else {
        setRetryMsg({ id, text: `Partial: ${d.data?.stillUnranked ?? '?'} lead(s) still unranked`, ok: false })
      }
    } catch (e) {
      setRetryMsg({ id, text: e.message || 'Retry failed', ok: false })
    }
    setRetrying(null)
  }

  const TYPE_LABELS = {
    priority_ranking_failure:    { label: 'Priority Ranking Failed',  color: 'bg-red-900/40 text-red-300'    },
    brief_generation_failure:    { label: 'Generation Failed',        color: 'bg-orange-900/40 text-orange-300' },
    image_fetch_failure:         { label: 'Image Fetch Failed',       color: 'bg-amber-900/40 text-amber-300' },
    bulk_generation_warnings:    { label: 'Generation Warnings',      color: 'bg-yellow-900/40 text-yellow-300' },
    duplicate_leads_detected:    { label: 'Duplicate Leads Detected', color: 'bg-purple-900/40 text-purple-300' },
    quiz_finish_failure:         { label: 'Quiz Finish Recovered',    color: 'bg-pink-900/40 text-pink-300' },
    quiz_result_persist_failure: { label: 'Quiz Result Save Failed',  color: 'bg-pink-900/40 text-pink-300' },
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3">
        <h2 className="text-base font-bold text-slate-900">System Logs</h2>
        <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showAll}
            onChange={e => { setShowAll(e.target.checked); setPage(1) }}
            className="rounded"
          />
          Show resolved
        </label>
      </div>

      <div className="bg-surface rounded-2xl border border-slate-700 overflow-hidden mb-4">
        {loading && <p className="py-8 text-center text-slate-400 text-sm animate-pulse">Loading…</p>}
        {!loading && logs.length === 0 && (
          <p className="py-8 text-center text-slate-400 text-sm">
            {showAll ? 'No system logs' : 'No unresolved system logs'}
          </p>
        )}
        {!loading && logs.map((log, i) => {
          const typeInfo = TYPE_LABELS[log.type] ?? { label: log.type, color: 'bg-slate-700 text-slate-300' }
          return (
            <div key={log._id} className={`px-4 py-3 ${i !== 0 ? 'border-t border-slate-700/50' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <LabelBadge label={typeInfo.label} color={typeInfo.color} uppercase />
                    <LabelBadge label={log.category} color="bg-slate-700 text-slate-300" />
                    {log.resolved && <LabelBadge label="Resolved" color="bg-green-900/40 text-green-300" />}
                  </div>

                  {/* Brief context */}
                  {log.briefTitle && (
                    <p className="text-xs text-slate-300 mb-1">
                      Brief: <span className="font-semibold">{log.briefTitle}</span>
                      {log.briefCategory && <span className="text-slate-500"> [{log.briefCategory}]</span>}
                    </p>
                  )}

                  {/* priority_ranking_failure */}
                  {log.sourceBriefTitle && (
                    <p className="text-xs text-slate-400 mb-1">
                      Source brief: <span className="font-semibold">{log.sourceBriefTitle}</span>
                    </p>
                  )}
                  {log.newStubs?.length > 0 && (
                    <p className="text-xs text-slate-400 mb-1">
                      New stubs: {log.newStubs.map(s => `"${s.title}"`).join(', ')}
                    </p>
                  )}
                  {log.attempts > 0 && log.type === 'priority_ranking_failure' && (
                    <p className="text-[10px] text-slate-500 mb-1">{log.attempts} attempt(s) made</p>
                  )}

                  {/* brief_generation_failure */}
                  {log.stage && (
                    <p className="text-xs text-slate-400 mb-1">
                      Stage: <span className="font-semibold">{log.stage.replace(/_/g, ' ')}</span>
                    </p>
                  )}

                  {/* image_fetch_failure */}
                  {log.searchTerms?.length > 0 && (
                    <p className="text-xs text-slate-400 mb-1">
                      Search terms tried: {log.searchTerms.map(t => `"${t}"`).join(', ')}
                    </p>
                  )}

                  {/* bulk_generation_warnings */}
                  {log.warnings?.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {log.warnings.map((w, wi) => (
                        <li key={wi} className="text-[10px] text-yellow-400 font-mono break-words">• {w}</li>
                      ))}
                    </ul>
                  )}

                  {/* common error detail */}
                  {log.failureReason && log.type !== 'bulk_generation_warnings' && (
                    <p className="text-[10px] text-red-400 font-mono mt-1 break-words">{log.failureReason}</p>
                  )}
                </div>

                <div className="flex flex-col items-end gap-2 shrink-0">
                  <span className="text-[10px] text-slate-400 whitespace-nowrap">
                    {new Date(log.time).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {!log.resolved && log.type === 'priority_ranking_failure' && (
                    <button
                      onClick={() => retry(log._id)}
                      disabled={retrying === log._id}
                      className="text-[10px] px-2 py-1 rounded-lg border border-brand-600 text-brand-600 font-semibold hover:bg-surface-raised transition-colors disabled:opacity-40"
                    >
                      {retrying === log._id ? 'Retrying…' : 'Retry Rerank'}
                    </button>
                  )}
                  {!log.resolved && (
                    <button
                      onClick={() => resolve(log._id)}
                      disabled={resolving === log._id}
                      className="text-[10px] px-2 py-1 rounded-lg border border-slate-600 text-slate-300 font-semibold hover:bg-surface-raised transition-colors disabled:opacity-40"
                    >
                      {resolving === log._id ? '…' : 'Resolve'}
                    </button>
                  )}
                  {retryMsg?.id === log._id && (
                    <span className={`text-[10px] font-mono ${retryMsg.ok ? 'text-green-400' : 'text-amber-400'}`}>
                      {retryMsg.text}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 font-semibold disabled:opacity-40 hover:bg-surface-raised transition-colors"
          >
            ← Prev
          </button>
          <span className="text-xs text-slate-400">Page {page} of {totalPages} ({total} total)</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 font-semibold disabled:opacity-40 hover:bg-surface-raised transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}

function IntelTab({ API, unsolvedCount, unresolvedSystemLogs, initialSub, initialEmailStatus, onOpenBrief }) {
  const [sub, setSub] = useState(initialSub ?? 'reports')
  const { refresh } = useUnsolvedReports()
  return (
    <div>
      <div className="flex gap-1 bg-surface-raised rounded-xl p-1 mb-5">
        {INTEL_SUBTABS.map(s => (
          <button
            key={s.id}
            onClick={() => setSub(s.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap
              ${sub === s.id
                ? 'bg-surface text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
              }`}
          >
            {s.label}
            {s.id === 'reports'     && unsolvedCount        > 0 && <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
            {s.id === 'system-logs' && unresolvedSystemLogs > 0 && <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
          </button>
        ))}
      </div>
      {sub === 'reports'     && <ProblemsTab    API={API} onOpenBrief={onOpenBrief} />}
      {sub === 'action-log'  && <LogsTab        API={API} />}
      {sub === 'email-log'   && <EmailLogsTab   API={API} initialStatusFilter={initialEmailStatus} />}
      {sub === 'system-logs' && <SystemLogsTab  API={API} onResolved={refresh} />}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'stats',    label: 'Stats',    icon: '📊' },
  { id: 'settings', label: 'Settings', icon: '⚙️'  },
  { id: 'users',    label: 'Users',    icon: '👥'  },
  { id: 'content',  label: 'Content',  icon: '✏️'  },
  { id: 'briefs',   label: 'Briefs',   icon: '📄'  },
  { id: 'intel',    label: 'Intel',    icon: '🗂️'  },
]

export default function Admin() {
  const { user, setUser, loading, API, apiFetch } = useAuth()
  const { unsolvedCount, unresolvedSystemLogs, refresh: refreshUnsolvedCount } = useUnsolvedReports()
  const navigate = useNavigate()
  const location = useLocation()
  const [tab, setTab] = useState(() => (location.state?.openLeads || location.state?.editBriefId) ? 'briefs' : 'stats')
  const [leadsInitialSearch, setLeadsInitialSearch] = useState(() => location.state?.leadsSearch ?? '')
  const [openLeadsOnMount,   setOpenLeadsOnMount]   = useState(() => !!location.state?.openLeads)
  const [editBriefIdOnMount, setEditBriefIdOnMount] = useState(() => location.state?.editBriefId ?? null)
  const [intelInitial,       setIntelInitial]       = useState({ sub: null, emailStatus: null })

  const openEmailLog = (status) => {
    setIntelInitial({ sub: 'email-log', emailStatus: status })
    setTab('intel')
  }

  const openBriefFromReport = (briefId) => {
    setEditBriefIdOnMount(briefId)
    setTab('briefs')
  }

  useEffect(() => {
    if (location.state?.editBriefId || location.state?.openLeads) {
      navigate(location.pathname, { replace: true, state: {} })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { refreshUnsolvedCount() }, [])

  useEffect(() => {
    if (!loading && (!user || !user.isAdmin)) navigate('/home', { replace: true })
  }, [loading, user, navigate])

  if (loading || !user?.isAdmin) return null

  return (
    <div className="min-h-screen bg-slate-50">
      <SEO title="Admin" description="SkyWatch admin dashboard." noIndex={true} />
      <div className="max-w-2xl mx-auto px-4 py-6">

        {/* Header */}
        <div className="mb-5">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Restricted Access</p>
          <h1 className="text-2xl font-extrabold text-slate-900">Admin Panel</h1>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-surface rounded-2xl border border-slate-200 p-1 mb-6 overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap
                ${tab === t.id
                  ? 'bg-brand-600 text-white shadow'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                }`}
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
              {t.id === 'intel' && (unsolvedCount > 0 || unresolvedSystemLogs > 0) && (
                <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {tab === 'stats'    && <StatsTab    API={API} onViewEmailLog={openEmailLog} />}
            {tab === 'settings' && <SettingsTab API={API} />}
            {tab === 'users'    && <UsersTab    API={API} />}
            {tab === 'content'  && <ContentTab  API={API} />}
            {tab === 'briefs'   && <BriefsTab   API={API} initialSearch={leadsInitialSearch} openLeads={openLeadsOnMount} editBriefIdOnMount={editBriefIdOnMount} onBootstrapConsumed={() => { setLeadsInitialSearch(''); setOpenLeadsOnMount(false); setEditBriefIdOnMount(null) }} />}
            {tab === 'intel'    && <IntelTab    API={API} unsolvedCount={unsolvedCount} unresolvedSystemLogs={unresolvedSystemLogs} initialSub={intelInitial.sub} initialEmailStatus={intelInitial.emailStatus} onOpenBrief={openBriefFromReport} />}
          </motion.div>
        </AnimatePresence>

      </div>
    </div>
  )
}
