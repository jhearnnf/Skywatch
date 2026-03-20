import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { invalidateSoundSettings } from '../../utils/sound'
import { TUTORIAL_STEPS } from '../../context/AppTutorialContext'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const fmtNum = (n) => (n ?? 0).toLocaleString()

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
  'News', 'Aircrafts', 'Bases', 'Ranks', 'Squadrons', 'Training',
  'Threats', 'Allies', 'Missions', 'AOR', 'Tech', 'Terminology', 'Treaties',
]

function leadSectionToCategory(section) {
  if (!section) return ALL_CATEGORIES[0]
  const match = section.match(/SECTION\s+(\d+)/i)
  const num = match ? parseInt(match[1], 10) : 0
  const map = {
    1: 'Ranks', 2: 'Squadrons', 3: 'Aircrafts', 4: 'Aircrafts',
    5: 'Bases', 6: 'Bases', 7: 'Training', 8: 'Threats', 9: 'Allies',
    10: 'Missions', 11: 'Tech', 12: 'Terminology', 13: 'Treaties', 14: 'AOR',
  }
  return map[num] ?? ALL_CATEGORIES[0]
}

function leadSubsectionToSubcategory(subsection) {
  const map = {
    'FAST JET': 'Fast Jet',
    'INTELLIGENCE, SURVEILLANCE & RECONNAISSANCE (ISR)': 'ISR & Surveillance',
    'MARITIME PATROL': 'Maritime Patrol',
    'TRANSPORT & TANKER': 'Transport & Tanker',
    'ROTARY WING': 'Rotary Wing',
    'TRAINING (FIXED WING)': 'Training Aircraft',
    'GROUND-BASED AIR DEFENCE (RAF REGIMENT)': 'Ground-Based Air Defence',
    'WWII ERA': 'Historic — WWII',
    'PRE-WWII / INTERWAR': 'Historic — WWII',
    'COLD WAR ERA': 'Historic — Cold War',
    'PANAVIA TORNADO FAMILY': 'Historic — Cold War',
    'BAE HARRIER FAMILY': 'Historic — Cold War',
    'POST-COLD WAR / RECENT RETIREMENTS': 'Historic — Post-Cold War',
    'MAIN OPERATING BASES': 'UK Active',
    'SUPPORT, INTELLIGENCE & SPECIALIST SITES': 'UK Active',
    'FORMER / RECENTLY CLOSED UK BASES': 'UK Former',
    'PERMANENT OVERSEAS BASES': 'Overseas Permanent',
    'DEPLOYED / FORWARD OPERATING LOCATIONS': 'Overseas Deployed / FOL',
    'COMMISSIONED OFFICER RANKS': 'Commissioned Officer',
    'NON-COMMISSIONED RANKS': 'Non-Commissioned',
    'SPECIALIST ROLES & DESIGNATIONS': 'Specialist Role',
    'ACTIVE FRONT-LINE SQUADRONS': 'Active Front-Line',
    'TRAINING SQUADRONS': 'Training',
    'ROYAL AUXILIARY AIR FORCE (RAuxAF) SQUADRONS': 'Royal Auxiliary Air Force',
    'HISTORIC / FAMOUS SQUADRONS': 'Historic',
    'INITIAL TRAINING': 'Initial Training',
    'FLYING TRAINING PIPELINE': 'Flying Training',
    'GROUND TRAINING & PROFESSIONAL MILITARY EDUCATION': 'Ground Training & PME',
    'AIR COMBAT & TACTICAL TRAINING': 'Tactical & Combat Training',
    'STATE ACTOR AIR THREATS': 'State Actor Air',
    'SURFACE-TO-AIR MISSILE (SAM) THREATS': 'Surface-to-Air Missiles',
    'ASYMMETRIC / NON-STATE THREATS': 'Asymmetric & Non-State',
    'MISSILE & STAND-OFF THREATS': 'Missiles & Stand-Off',
    'ELECTRONIC & CYBER THREATS': 'Electronic & Cyber',
    'NATO ALLIES (KEY)': 'NATO',
    'FIVE EYES PARTNERS': 'Five Eyes',
    'AUKUS PARTNERS': 'AUKUS',
    'BILATERAL & FRAMEWORK PARTNERS': 'Bilateral & Framework Partners',
    'WORLD WAR I': 'World War I',
    'WORLD WAR II': 'World War II',
    'POST-WAR / COLD WAR': 'Post-War & Cold War',
    'POST-COLD WAR': 'Post-Cold War',
    'WAR ON TERROR / 21ST CENTURY': 'War on Terror',
    'NATO STANDING OPERATIONS': 'NATO Standing Operations',
    'HUMANITARIAN / DISASTER RELIEF': 'Humanitarian & NEO',
    'WEAPONS SYSTEMS': 'Weapons Systems',
    'SENSORS & AVIONICS': 'Sensors & Avionics',
    'ELECTRONIC WARFARE': 'Electronic Warfare',
    'FUTURE TECHNOLOGY & PROGRAMMES': 'Future Programmes',
    'COMMAND & CONTROL / COMMS': 'Command, Control & Comms',
    'OPERATIONAL CONCEPTS': 'Operational Concepts',
    'FLYING & TACTICAL TERMINOLOGY': 'Flying & Tactical',
    'AIR TRAFFIC & NAVIGATION': 'Air Traffic & Navigation',
    'INTELLIGENCE & PLANNING': 'Intelligence & Planning',
    'MAINTENANCE & SUPPORT': 'Maintenance & Support',
    'FOUNDING & CORE ALLIANCES': 'Founding & Core Alliances',
    'BILATERAL DEFENCE AGREEMENTS': 'Bilateral Defence Agreements',
    'ARMS CONTROL & NON-PROLIFERATION': 'Arms Control & Non-Proliferation',
    'OPERATIONAL & STATUS AGREEMENTS': 'Operational & Status Agreements',
    'UK / HOME AIR DEFENCE': 'UK Home Air Defence',
    'NATO AOR STRUCTURE': 'NATO AOR',
    'CENTCOM / MIDDLE EAST AOR': 'Middle East & CENTCOM',
    'ATLANTIC / GIUK GAP': 'Atlantic & GIUK Gap',
    'AFRICA AOR': 'Africa',
    'INDO-PACIFIC AOR': 'Indo-Pacific',
    'FALKLAND ISLANDS AOR': 'South Atlantic & Falklands',
  }
  return map[subsection] || ''
}

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
  const [reason, setReason] = useState('')
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

function StatCard({ label, value, sub, color = 'slate' }) {
  const colors = {
    slate:  'bg-slate-50  border-slate-200  text-slate-700',
    brand:  'bg-brand-50  border-brand-200  text-brand-700',
    amber:  'bg-amber-50  border-amber-200  text-amber-700',
    emerald:'bg-emerald-50 border-emerald-200 text-emerald-700',
    red:    'bg-red-50    border-red-200    text-red-700',
  }
  return (
    <div className={`rounded-2xl border p-4 ${colors[color] ?? colors.slate}`}>
      <p className="text-2xl font-extrabold mb-0.5">{value ?? '—'}</p>
      <p className="text-xs font-semibold uppercase tracking-wider opacity-70">{label}</p>
      {sub && <p className="text-[10px] opacity-50 mt-0.5">{sub}</p>}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// STATS TAB
// ─────────────────────────────────────────────────────────────────────────────

function StatsTab({ API }) {
  const [stats, setStats] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`${API}/api/admin/stats`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d.status === 'success') setStats(d.data); else setError('Failed to load stats') })
      .catch(() => setError('Failed to load stats'))
  }, [API])

  if (error) return <p className="text-sm text-red-500 py-8 text-center">{error}</p>
  if (!stats) return <div className="py-8 text-center text-slate-400 text-sm animate-pulse">Loading stats…</div>

  const { users, games, briefs, tutorials, server } = stats

  const pct = (n, d) => d > 0 ? `${Math.round((n / d) * 100)}%` : '—'

  return (
    <div className="space-y-8">
      {/* Users */}
      <section>
        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-3">Users</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total Users"      value={fmtNum(users.totalUsers)}       color="brand" />
          <StatCard label="Free"             value={fmtNum(users.freeUsers)}         color="slate" />
          <StatCard label="Trial"            value={fmtNum(users.trialUsers)}        color="amber" />
          <StatCard label="Subscribed"       value={fmtNum(users.subscribedUsers)}   color="emerald" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <StatCard label="Easy Mode"        value={fmtNum(users.easyPlayers)}       color="slate" />
          <StatCard label="Medium Mode"      value={fmtNum(users.mediumPlayers)}     color="slate" />
          <StatCard label="Total Logins"     value={fmtNum(users.totalLogins)}       color="slate" />
          <StatCard label="Combined Streaks" value={fmtNum(users.combinedStreaks)}   color="slate" />
        </div>
      </section>

      {/* Quiz */}
      <section>
        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-3">Quiz</h3>
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
      </section>

      {/* Battle of Order */}
      <section>
        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-3">Battle of Order</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Games"     value={fmtNum(games.boo?.total)}                                    color="brand" />
          <StatCard label="Won"       value={pct(games.boo?.won, games.boo?.total)}                       color="emerald" />
          <StatCard label="Defeated"  value={pct(games.boo?.defeated, games.boo?.total)}                  color="amber" />
          <StatCard label="Abandoned" value={pct(games.boo?.abandoned, games.boo?.total)}                 color="red" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          <StatCard label="Time Played" value={fmtSeconds(games.boo?.totalSeconds)} color="slate" />
        </div>
      </section>

      {/* Aircoins + Briefs + Tutorials */}
      <section>
        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-3">Economy & Content</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Aircoins in System" value={fmtNum(games.totalAircoinsEarned)}       color="amber" />
          <StatCard label="Briefs Read"        value={fmtNum(briefs.totalBrifsRead)}           color="brand" />
          <StatCard label="Briefs Opened"      value={fmtNum(briefs.totalBrifsOpened)}         color="slate" />
          <StatCard label="Time Reading"       value={fmtSeconds(briefs.totalReadSeconds ?? 0)} color="brand" />
          <StatCard label="Tutorials Viewed"   value={fmtNum(tutorials.viewed)}                color="slate" />
          <StatCard label="Tutorials Skipped"  value={fmtNum(tutorials.skipped)}               color="slate" />
          <StatCard label="Uptime Since Deploy" value={fmtUptime(server?.serverUptimeSeconds ?? 0)} color="emerald" />
        </div>
      </section>
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
      { key: 'volumeIntelBriefOpened',    enabledKey: 'soundEnabledIntelBriefOpened',    label: 'Brief Opened',   sound: 'intel_brief_opened'    },
      { key: 'volumeFirstBriefComplete',  enabledKey: 'soundEnabledFirstBriefComplete',  label: 'Brief Complete (Guest)', sound: 'first_brief_complete' },
    ],
  },
  {
    title: 'Rewards',
    sounds: [
      { key: 'volumeAircoin',       enabledKey: 'soundEnabledAircoin',       label: 'Aircoins Earned', sound: 'aircoin'        },
      { key: 'volumeLevelUp',       enabledKey: 'soundEnabledLevelUp',       label: 'Level Up',        sound: 'level_up'       },
      { key: 'volumeRankPromotion', enabledKey: 'soundEnabledRankPromotion', label: 'Rank Promotion',  sound: 'rank_promotion' },
    ],
  },
  {
    title: 'Quiz',
    sounds: [
      { key: 'volumeQuizCompleteWin',  enabledKey: 'soundEnabledQuizCompleteWin',  label: 'Quiz Won',  sound: 'quiz_complete_win'  },
      { key: 'volumeQuizCompleteLose', enabledKey: 'soundEnabledQuizCompleteLose', label: 'Quiz Fail', sound: 'quiz_complete_lose' },
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
]

const ALL_SOUND_KEYS = SOUND_GROUPS.flatMap(g => g.sounds.flatMap(s => [s.key, s.enabledKey]))

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
    <div className="flex items-center justify-between py-3 border-b border-slate-100 last:border-0">
      <div>
        <p className="text-sm font-semibold text-slate-700">{label}</p>
        {hint && <p className="text-xs text-slate-400">{hint}</p>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors ${checked ? 'bg-brand-500' : 'bg-slate-200'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-surface rounded-full shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  )
}

const OUT_OF_AMMO_VARIANTS = ['out_of_ammo_1', 'out_of_ammo_2', 'out_of_ammo_3']

function SoundRowV2({ label, sound, value, onChange, enabled, onToggle }) {
  const preview = () => {
    invalidateSoundSettings()
    try {
      const file = sound === 'out_of_ammo'
        ? OUT_OF_AMMO_VARIANTS[Math.floor(Math.random() * OUT_OF_AMMO_VARIANTS.length)]
        : sound
      const audio = new Audio(`/sounds/${file}.mp3`)
      audio.volume = Math.min(1, (value ?? 100) / 100)
      audio.play().catch(() => {})
    } catch {}
  }

  return (
    <div className={`flex items-center gap-3 py-2.5 border-b border-slate-100 last:border-0 ${!enabled ? 'opacity-50' : ''}`}>
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
  )
}

function Section({ title, children, onSave, saving }) {
  return (
    <div className="bg-surface rounded-2xl border border-slate-200 overflow-hidden mb-4">
      <div className="px-5 py-4 border-b border-slate-100">
        <h3 className="font-bold text-slate-800">{title}</h3>
      </div>
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
                : 'bg-surface text-slate-600 border-slate-200 hover:border-brand-300'
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

function SettingsTab({ API }) {
  const { awardAircoins } = useAuth()
  const [settings, setSettings] = useState(null)
  const [draft,    setDraft]    = useState({})
  const [modal,    setModal]    = useState(null)   // { label, fields }
  const [toast,    setToast]    = useState('')
  const [testAmount, setTestAmount] = useState('')
  const [coinBusy,   setCoinBusy]   = useState(false)

  const load = useCallback(() => {
    fetch(`${API}/api/admin/settings`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { const s = d.data?.settings; if (s) { setSettings(s); setDraft(s) } })
  }, [API])

  useEffect(() => { load() }, [load])

  const save = (label, fields) => {
    setModal({ label, fields })
  }

  const confirmSave = async (reason) => {
    const updates = {}
    modal.fields.forEach(f => { updates[f] = draft[f] })
    await fetch(`${API}/api/admin/settings`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...updates, reason }),
    })
    setModal(null)
    invalidateSoundSettings()
    setToast(`✓ ${modal.label} saved`)
    load()
  }

  const awardTest = async () => {
    const amt = parseInt(testAmount, 10)
    if (!amt || amt <= 0) return
    setCoinBusy(true)
    try {
      const res  = await fetch(`${API}/api/admin/award-coins`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt }),
      })
      const data = await res.json()
      if (data.status === 'success') {
        awardAircoins(data.awarded, 'Test Coins', { cycleAfter: data.cycleAircoins, totalAfter: data.totalAircoins, rankPromotion: data.rankPromotion ?? null })
        setToast(`✓ Awarded ${data.awarded} test coins`)
        setTestAmount('')
      }
    } finally { setCoinBusy(false) }
  }

  const set = (key, val) => setDraft(p => ({ ...p, [key]: val }))
  const toggleCat = (key, cat) => setDraft(p => {
    const cats = p[key] ?? []
    return { ...p, [key]: cats.includes(cat) ? cats.filter(c => c !== cat) : [...cats, cat] }
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

      {/* ── Subscription ─────────────────────────────────────── */}
      <Section title="Subscription" onSave={() => save('Update Subscription Settings', ['trialDurationDays', 'freeCategories', 'silverCategories', 'guestCategories'])}>
        <NumInput label="Trial duration (days)" value={draft.trialDurationDays} min={1} max={365} onChange={v => set('trialDurationDays', v)} />

        <div className="pt-3">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">
            Not signed in (Guest) categories
            <span className="ml-2 bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full text-[10px] normal-case">Briefs outside these categories are locked for guests</span>
          </p>
          <CategoryGrid selected={draft.guestCategories} onChange={cat => toggleCat('guestCategories', cat)} />
        </div>

        <div className="pt-4">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">
            Free tier categories
            <span className="ml-2 bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full text-[10px] normal-case">Gold = all categories always</span>
          </p>
          <CategoryGrid selected={draft.freeCategories} onChange={cat => toggleCat('freeCategories', cat)} />
        </div>

        <div className="pt-4">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Silver tier categories</p>
          <CategoryGrid selected={draft.silverCategories} onChange={cat => toggleCat('silverCategories', cat)} />
        </div>
      </Section>

      {/* ── Aircoins ─────────────────────────────────────────── */}
      <Section title="Aircoins" onSave={() => save('Update Aircoin Options', [
        'aircoinsPerWinEasy', 'aircoinsPerWinMedium', 'aircoinsPerBriefRead',
        'aircoinsFirstLogin', 'aircoinsStreakBonus', 'aircoins100Percent',
        'aircoinsOrderOfBattleEasy', 'aircoinsOrderOfBattleMedium',
      ])}>
        <NumInput label="Per correct answer — Easy quiz"   value={draft.aircoinsPerWinEasy}          onChange={v => set('aircoinsPerWinEasy', v)} />
        <NumInput label="Per correct answer — Medium quiz" value={draft.aircoinsPerWinMedium}        onChange={v => set('aircoinsPerWinMedium', v)} />
        <NumInput label="100% score bonus"                 value={draft.aircoins100Percent}          onChange={v => set('aircoins100Percent', v)} />
        <NumInput label="Per brief read (first time)"      value={draft.aircoinsPerBriefRead}        onChange={v => set('aircoinsPerBriefRead', v)} />
        <NumInput label="First daily login"                value={draft.aircoinsFirstLogin}          onChange={v => set('aircoinsFirstLogin', v)} />
        <NumInput label="Streak login bonus"               value={draft.aircoinsStreakBonus}         onChange={v => set('aircoinsStreakBonus', v)} />
        <NumInput label="Battle of Order — Easy win"       value={draft.aircoinsOrderOfBattleEasy}   onChange={v => set('aircoinsOrderOfBattleEasy', v)} />
        <NumInput label="Battle of Order — Medium win"     value={draft.aircoinsOrderOfBattleMedium} onChange={v => set('aircoinsOrderOfBattleMedium', v)} />
      </Section>

      {/* ── Game ────────────────────────────────────────────── */}
      <Section title="Game Options" onSave={() => save('Update Game Options', [
        'easyAnswerCount', 'mediumAnswerCount',
        'passThresholdEasy', 'passThresholdMedium',
      ])}>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest pt-1 pb-2">Quiz Answer Count</p>
        <NumInput label="Answers shown — Easy"   value={draft.easyAnswerCount}   min={2} max={10} onChange={v => set('easyAnswerCount', v)} />
        <NumInput label="Answers shown — Medium" value={draft.mediumAnswerCount} min={2} max={10} onChange={v => set('mediumAnswerCount', v)} />

        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest pt-4 pb-1">Pass Threshold</p>
        <PctSlider label="Easy"   value={draft.passThresholdEasy}   onChange={v => set('passThresholdEasy', v)} />
        <PctSlider label="Medium" value={draft.passThresholdMedium} onChange={v => set('passThresholdMedium', v)} />
      </Section>

      {/* ── Feature Flags ───────────────────────────────────── */}
      <Section title="Feature Flags" onSave={() => save('Update Feature Flags', ['useLiveLeaderboard'])}>
        <Toggle
          label="Live Leaderboard"
          hint="When off, mock placeholder data is shown on the Profile page"
          checked={draft.useLiveLeaderboard ?? false}
          onChange={v => set('useLiveLeaderboard', v)}
        />
      </Section>

      {/* ── Sound Effects ───────────────────────────────────── */}
      <Section title="Sound Effects" onSave={() => save('Update Sound Settings', ALL_SOUND_KEYS)}>
        {SOUND_GROUPS.map(group => (
          <div key={group.title} className="mb-4">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest pt-1 pb-1">{group.title}</p>
            {group.sounds.map(({ key, enabledKey, label, sound }) => (
              <SoundRowV2
                key={key}
                label={label}
                sound={sound}
                value={draft[key] ?? 100}
                onChange={v => set(key, v)}
                enabled={draft[enabledKey] !== false}
                onToggle={() => set(enabledKey, draft[enabledKey] === false ? true : false)}
              />
            ))}
          </div>
        ))}
      </Section>

      {/* ── Award Test Coins ────────────────────────────────── */}
      <Section title="Award Test Coins">
        <p className="text-xs text-slate-400 mb-3">Awards aircoins to your admin account, logged as "Test Coins".</p>
        <div className="flex items-center gap-3">
          <input
            type="number" min={1} placeholder="Amount…"
            value={testAmount}
            onChange={e => setTestAmount(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && awardTest()}
            className="w-32 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-200"
          />
          <button
            onClick={awardTest}
            disabled={coinBusy || !testAmount || parseInt(testAmount, 10) <= 0}
            className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-40"
          >
            {coinBusy ? 'Awarding…' : '⬡ Award'}
          </button>
        </div>
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
    <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-slate-100">
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
  const { refreshUser } = useAuth()
  const [users,   setUsers]   = useState([])
  const [q,       setQ]       = useState('')
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState(false) // is in search mode
  const [modal,   setModal]   = useState(null)
  const [toast,   setToast]   = useState('')
  const [resetId, setResetId] = useState(null)

  const loadAll = useCallback(async () => {
    setLoading(true); setSearch(false)
    const res  = await fetch(`${API}/api/admin/users`, { credentials: 'include' })
    const data = await res.json()
    setUsers(data.data?.users ?? [])
    setLoading(false)
  }, [API])

  useEffect(() => { loadAll() }, [loadAll])

  const runSearch = async () => {
    if (!q.trim()) { loadAll(); return }
    setLoading(true); setSearch(true)
    const res  = await fetch(`${API}/api/admin/users/search?q=${encodeURIComponent(q.trim())}`, { credentials: 'include' })
    const data = await res.json()
    setUsers(data.data?.users ?? [])
    setLoading(false)
  }

  const action = (label, endpoint, method = 'POST', extra = {}) => setModal({ label, endpoint, method, extra })

  const confirmAction = async (reason) => {
    const res  = await fetch(`${API}${modal.endpoint}`, {
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

      <div className="space-y-3">
        {users.map(u => (
          <div key={u._id} className="bg-surface rounded-2xl border border-slate-200 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <div>
                <p className="font-bold text-slate-800 text-sm">
                  Agent {u.agentNumber}
                  {u.isAdmin && <span className="ml-2 text-[10px] bg-brand-100 text-brand-700 px-1.5 py-0.5 rounded-full font-bold">ADMIN</span>}
                  {u.isBanned && <span className="ml-2 text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-bold">BANNED</span>}
                </p>
                <p className="text-xs text-slate-400">{u.email}</p>
              </div>
              <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${TIER_COLORS[u.subscriptionTier] ?? TIER_COLORS.free}`}>
                {u.subscriptionTier === 'trial' && u.isTrialActive ? 'Trial (Silver)' : (u.subscriptionTier ?? 'free')}
              </span>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 sm:grid-cols-6 divide-x divide-slate-100 border-b border-slate-100">
              {[
                ['Coins', (u.totalAircoins ?? 0).toLocaleString()],
                ['Streak', u.loginStreak ?? 0],
                ['Logins', u.logins?.length ?? 0],
                ['Briefs Read', u.profileStats?.brifsRead ?? 0],
                ['Difficulty', u.difficultySetting ?? 'easy'],
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
              {u.isAdmin && (
                <button onClick={() => action(`Remove admin — Agent ${u.agentNumber}`, `/api/admin/users/${u._id}/remove-admin`)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold transition-colors">
                  Remove Admin
                </button>
              )}
              <button onClick={() => action(`${u.isBanned ? 'Unban' : 'Ban'} — Agent ${u.agentNumber}`, u.isBanned ? `/api/admin/users/${u._id}/unban` : `/api/admin/users/${u._id}/ban`)}
                className={`text-xs px-3 py-1.5 rounded-lg border font-semibold transition-colors
                  ${u.isBanned
                    ? 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                    : 'border-red-200 text-red-600 hover:bg-red-50'
                  }`}>
                {u.isBanned ? 'Unban' : 'Ban'}
              </button>
              <button onClick={() => action(`Delete account — Agent ${u.agentNumber}`, `/api/admin/users/${u._id}`, 'DELETE')}
                className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 font-semibold transition-colors">
                Delete
              </button>
            </div>

            {/* Subscription tier */}
            <SubscriptionTierRow u={u} action={action} />

            {/* Reset (testing) */}
            <div className="px-4 py-2.5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Reset for testing</p>
              <div className="flex flex-wrap gap-2">
                {[
                  {
                    label:   'Aircoins',
                    fields:  ['aircoins'],
                    isReset: (u.totalAircoins ?? 0) === 0,
                  },
                  {
                    label:   'Game History',
                    fields:  ['gameHistory'],
                    isReset: (u.profileStats?.quizzesPlayed ?? 0) === 0 && (u.profileStats?.booPlayed ?? 0) === 0,
                  },
                  {
                    label:   'Briefs Read',
                    fields:  ['intelBriefsRead'],
                    isReset: (u.profileStats?.brifsRead ?? 0) === 0,
                  },
                  {
                    label:   'Tutorials',
                    fields:  ['tutorials'],
                    isReset: !['welcome', 'intel_brief', 'user', 'load_up'].some(
                      k => u.tutorials?.[k] === 'viewed' || u.tutorials?.[k] === 'skipped'
                    ),
                  },
                ].map(({ label, fields, isReset }) => (
                  <button
                    key={label}
                    onClick={() => action(
                      `Reset ${label} — Agent ${u.agentNumber}`,
                      `/api/admin/users/${u._id}/reset-stats`,
                      'POST',
                      { fields },
                    )}
                    className={`text-xs px-3 py-1.5 rounded-lg border font-semibold transition-colors ${
                      isReset
                        ? 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                        : 'border-amber-200 text-amber-700 hover:bg-amber-50'
                    }`}
                  >
                    ↺ {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PROBLEMS TAB
// ─────────────────────────────────────────────────────────────────────────────

function ProblemsTab({ API }) {
  const [problems, setProblems] = useState([])
  const [filter,   setFilter]   = useState('unsolved')
  const [search,   setSearch]   = useState('')
  const [loading,  setLoading]  = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [updates,  setUpdates]  = useState({})
  const [busy,     setBusy]     = useState(null)
  const [toast,    setToast]    = useState('')
  const [tick,     setTick]     = useState(0)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filter !== 'all') params.set('solved', filter === 'solved' ? 'true' : 'false')
    fetch(`${API}/api/admin/problems?${params}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setProblems(d.data?.problems ?? []))
      .finally(() => setLoading(false))
  }, [API, filter, tick])

  const visible = search.trim()
    ? problems.filter(p => p.description.toLowerCase().includes(search.toLowerCase()) || p.pageReported?.toLowerCase().includes(search.toLowerCase()))
    : problems

  const postUpdate = async (id, description, solved) => {
    if (!description?.trim()) return
    setBusy(id)
    await fetch(`${API}/api/admin/problems/${id}/update`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description, ...(solved !== undefined ? { solved } : {}) }),
    })
    setUpdates(p => ({ ...p, [id]: '' }))
    setBusy(null)
    setToast(solved !== undefined ? (solved ? '✓ Marked solved' : '✓ Reopened') : '✓ Updated')
    setTick(t => t + 1)
  }

  return (
    <div>
      <AnimatePresence>{toast && <Toast msg={toast} onClear={() => setToast('')} />}</AnimatePresence>

      {/* Controls */}
      <div className="flex flex-wrap gap-2 mb-5">
        {['unsolved', 'solved', 'all'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors capitalize
              ${filter === f ? 'bg-brand-600 text-white' : 'bg-surface border border-slate-200 text-slate-600 hover:border-brand-300'}`}>
            {f}
          </button>
        ))}
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Filter reports…"
          className="flex-1 min-w-40 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-200"
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
          <div key={p._id} className={`bg-surface rounded-2xl border overflow-hidden transition-colors ${p.solved ? 'border-emerald-200' : 'border-slate-200'}`}>
            <button
              className="w-full flex items-start justify-between gap-3 px-4 py-3 text-left"
              onClick={() => setExpanded(e => e === p._id ? null : p._id)}
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-400 mb-0.5">{p.pageReported || 'Unknown page'} · {new Date(p.time).toLocaleDateString('en-GB')}</p>
                <p className="text-sm font-semibold text-slate-800 line-clamp-2">{p.description}</p>
              </div>
              <span className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded-full ${p.solved ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                {p.solved ? 'Solved' : 'Open'}
              </span>
            </button>

            {expanded === p._id && (
              <div className="px-4 pb-4 border-t border-slate-100 pt-3 space-y-3">

                {/* Full original description */}
                <div className="bg-slate-50 rounded-xl p-3 text-xs text-slate-700">
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
                      <div key={i} className="bg-brand-50 border border-brand-100 rounded-xl p-3 text-xs text-slate-700">
                        <p className="whitespace-pre-wrap leading-relaxed mb-1">{u.description}</p>
                        <p className="text-slate-400">
                          {u.adminUserId?.agentNumber ? `Agent ${u.adminUserId.agentNumber}` : 'Admin'}
                          {' · '}{new Date(u.time).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
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
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none outline-none focus:ring-2 focus:ring-brand-200"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => postUpdate(p._id, updates[p._id])}
                    disabled={busy === p._id || !updates[p._id]?.trim()}
                    className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-40"
                  >
                    {busy === p._id ? 'Saving…' : 'Save Note'}
                  </button>
                  <button
                    onClick={() => postUpdate(p._id, updates[p._id]?.trim() || (p.solved ? 'Reopened' : 'Marked as solved'), !p.solved)}
                    disabled={busy === p._id}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors disabled:opacity-40
                      ${p.solved ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'}`}
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
  combatReadinessSubtitle: 'Choose your quiz difficulty.',
  combatReadinessEasyLabel:    'Recruit',   combatReadinessEasyTag:    'EASY',   combatReadinessEasyStars:    '★★★☆☆', combatReadinessEasyFlavor:    'Direct recall questions.',
  combatReadinessMediumLabel:  'Operative', combatReadinessMediumTag:  'MEDIUM', combatReadinessMediumStars:  '★★★★☆', combatReadinessMediumFlavor:  'Contextual, deeper questions.',
}

// Tutorial names in display order with friendly labels
const TUTORIAL_META = [
  { key: 'home',        label: 'Home Page' },
  { key: 'learn',       label: 'Learn Page' },
  { key: 'briefReader', label: 'Brief Reader' },
  { key: 'quiz',        label: 'Quiz' },
  { key: 'play',        label: 'Play Hub' },
  { key: 'profile',     label: 'Profile Page' },
  { key: 'rankings',    label: 'Progression Page' },
]

function ContentTab({ API }) {
  const [draft,       setDraft]       = useState({})
  const [tutDraft,    setTutDraft]    = useState({}) // tutorialContent edits: { 'home_0': { title, body } }
  const [modal,       setModal]       = useState(null)
  const [toast,       setToast]       = useState('')
  const [emailBusy,   setEmailBusy]   = useState(false)
  const [expandedTut, setExpandedTut] = useState(null)

  const load = useCallback(() => {
    fetch(`${API}/api/admin/settings`, { credentials: 'include' })
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
          // Pre-populate tutorial fields from TUTORIAL_STEPS defaults where not yet overridden
          const tut = { ...(s.tutorialContent ?? {}) }
          TUTORIAL_META.forEach(({ key: tutKey }) => {
            const steps = TUTORIAL_STEPS[tutKey] ?? []
            steps.forEach((step, i) => {
              const k = `${tutKey}_${i}`
              if (!tut[k]?.title && !tut[k]?.body) {
                tut[k] = { title: step.title ?? '', body: step.body ?? '' }
              }
            })
          })
          setTutDraft(tut)
        }
      })
  }, [API])

  useEffect(() => { load() }, [load])

  const save = (label, fields) => setModal({ label, fields })

  const confirmSave = async (reason) => {
    const updates = {}
    modal.fields.forEach(f => { updates[f] = draft[f] })
    await fetch(`${API}/api/admin/settings`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...updates, reason }),
    })
    setModal(null)
    setToast(`✓ ${modal.label} saved`)
    load()
  }

  const confirmSaveTutorials = async (reason) => {
    await fetch(`${API}/api/admin/settings`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tutorialContent: tutDraft, reason }),
    })
    setModal(null)
    setToast('✓ Tutorial text saved')
    load()
  }

  const sendTestEmail = async () => {
    setEmailBusy(true)
    try {
      const res  = await fetch(`${API}/api/admin/test-email`, { method: 'POST', credentials: 'include' })
      const data = await res.json()
      setToast(data.status === 'success' ? `✓ ${data.message}` : `✗ ${data.message}`)
    } catch {
      setToast('✗ Failed to send test email')
    } finally {
      setEmailBusy(false)
    }
  }

  const setTutField = (tutKey, stepIdx, field, value) => {
    const key = `${tutKey}_${stepIdx}`
    setTutDraft(p => ({
      ...p,
      [key]: { ...(p[key] ?? {}), [field]: value },
    }))
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
          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-200" />
      )}
    </div>
  )

  return (
    <div>
      <AnimatePresence>{toast && <Toast msg={toast} onClear={() => setToast('')} />}</AnimatePresence>
      {modal && <ConfirmModal title={modal.label} onConfirm={modal.isTutorial ? confirmSaveTutorials : confirmSave} onCancel={() => setModal(null)} />}

      {/* ── Welcome Email ─────────────────────────────────────────── */}
      <Section title="Welcome Email" onSave={() => save('Update Welcome Email', ['welcomeEmailSubject', 'welcomeEmailHeading', 'welcomeEmailBody', 'welcomeEmailCta', 'welcomeEmailFooter'])}>
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
      <Section title="Difficulty Select Screen" onSave={() => save('Update Combat Readiness Screen', [
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
      <div className="bg-surface rounded-2xl border border-slate-200 overflow-hidden mb-4">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-bold text-slate-800">Tutorials</h3>
          <p className="text-xs text-slate-400">Leave a field blank to use the default text</p>
        </div>
        <div className="px-5 py-3">
          {TUTORIAL_META.map(({ key: tutKey, label: tutLabel }) => {
            const steps    = TUTORIAL_STEPS[tutKey] ?? []
            const isOpen   = expandedTut === tutKey
            return (
              <div key={tutKey} className="border-b border-slate-100 last:border-0">
                <button
                  onClick={() => setExpandedTut(isOpen ? null : tutKey)}
                  className="w-full flex items-center justify-between py-3 text-left"
                >
                  <span className="text-sm font-semibold text-slate-700">{tutLabel}</span>
                  <span className="text-slate-400 text-xs">{isOpen ? '▲ collapse' : `${steps.length} steps ▼`}</span>
                </button>
                {isOpen && (
                  <div className="pb-4 space-y-5">
                    {steps.map((defaultStep, idx) => {
                      const overrideKey = `${tutKey}_${idx}`
                      const override    = tutDraft[overrideKey] ?? {}
                      return (
                        <div key={idx} className="bg-slate-50 rounded-xl p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xl">{defaultStep.emoji}</span>
                            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Step {idx + 1}</span>
                          </div>
                          <div className="space-y-2">
                            <div>
                              <label className="block text-[11px] font-semibold text-slate-500 mb-0.5">
                                Title <span className="text-slate-300 font-normal">(default: "{defaultStep.title}")</span>
                              </label>
                              <input
                                type="text"
                                placeholder={defaultStep.title}
                                value={override.title ?? ''}
                                onChange={e => setTutField(tutKey, idx, 'title', e.target.value)}
                                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-200 bg-surface-raised text-slate-800 placeholder:text-slate-500"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-semibold text-slate-500 mb-0.5">Body</label>
                              <textarea
                                rows={3}
                                placeholder={defaultStep.body}
                                value={override.body ?? ''}
                                onChange={e => setTutField(tutKey, idx, 'body', e.target.value)}
                                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm resize-none outline-none focus:ring-2 focus:ring-brand-200 bg-surface-raised text-slate-800 placeholder:text-slate-500"
                              />
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="px-5 pb-4">
          <button
            onClick={() => setModal({ label: 'Update Tutorial Text', isTutorial: true })}
            className="mt-1 px-5 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-xl transition-colors"
          >
            Save Tutorials
          </button>
        </div>
      </div>
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
  const [busy, setBusy] = useState(false)
  const setTier = async (tier) => {
    if (tier === user.subscriptionTier || busy) return
    setBusy(true)
    const res  = await fetch(`${API}/api/admin/self/subscription`, {
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
              ${user.subscriptionTier === tier
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
// BRIEFS TAB
// ─────────────────────────────────────────────────────────────────────────────

const BRIEF_CATEGORIES = [
  'News', 'Aircrafts', 'Bases', 'Ranks', 'Squadrons', 'Training', 'Roles',
  'Threats', 'Allies', 'Missions', 'AOR', 'Tech', 'Terminology', 'Treaties',
]

const BRIEF_SUBCATEGORIES = {
  News: [],
  Aircrafts: ['Fast Jet','ISR & Surveillance','Maritime Patrol','Transport & Tanker','Rotary Wing','Training Aircraft','Ground-Based Air Defence','Historic — WWII','Historic — Cold War','Historic — Post-Cold War'],
  Bases: ['UK Active','UK Former','Overseas Permanent','Overseas Deployed / FOL'],
  Ranks: ['Commissioned Officer','Non-Commissioned','Specialist Role'],
  Squadrons: ['Active Front-Line','Training','Royal Auxiliary Air Force','Historic'],
  Training: ['Initial Training','Flying Training','Ground Training & PME','Tactical & Combat Training'],
  Roles: ['Fast Jet Pilot','Multi-Engine Pilot','Rotary Wing Pilot','Weapons Systems Operator','Intelligence Officer','Engineer Officer','Air Traffic Control Officer','RAF Regiment','Logistics & Supply','Medical & Nursing','Cyber & Information','Fighter Controller'],
  Threats: ['State Actor Air','Surface-to-Air Missiles','Asymmetric & Non-State','Missiles & Stand-Off','Electronic & Cyber'],
  Allies: ['NATO','Five Eyes','AUKUS','Bilateral & Framework Partners'],
  Missions: ['World War I','World War II','Post-War & Cold War','Post-Cold War','War on Terror','NATO Standing Operations','Humanitarian & NEO'],
  AOR: ['UK Home Air Defence','NATO AOR','Middle East & CENTCOM','Atlantic & GIUK Gap','Africa','Indo-Pacific','South Atlantic & Falklands'],
  Tech: ['Weapons Systems','Sensors & Avionics','Electronic Warfare','Future Programmes','Command, Control & Comms'],
  Terminology: ['Operational Concepts','Flying & Tactical','Air Traffic & Navigation','Intelligence & Planning','Maintenance & Support'],
  Treaties: ['Founding & Core Alliances','Bilateral Defence Agreements','Arms Control & Non-Proliferation','Operational & Status Agreements'],
}

const EMPTY_DRAFT = {
  title: '', subtitle: '', category: 'News', subcategory: '', historic: false,
  descriptionSections: ['', '', ''],
  keywords: [],
  sources: [],
  gameData: {},
}

const BOO_CATEGORIES = ['Aircrafts', 'Ranks', 'Training', 'Missions', 'Tech', 'Treaties']

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

function LeadRow({ lead, picked, busy, onGenerate }) {
  return (
    <div className={`flex items-start justify-between gap-3 py-2 px-3 rounded-xl mb-1 transition-colors ${picked?.text === lead.text ? 'bg-amber-50 border border-amber-200' : 'hover:bg-slate-50'}`}>
      <p className="text-sm text-slate-700 flex-1">{lead.text}</p>
      <button
        onClick={() => onGenerate(lead)}
        disabled={busy === lead.text}
        className="text-xs px-3 py-1 rounded-lg border border-brand-300 bg-brand-50 text-brand-700 font-semibold whitespace-nowrap hover:bg-brand-100 disabled:opacity-40"
      >
        {busy === lead.text ? '…' : 'Generate →'}
      </button>
    </div>
  )
}

function LeadsModal({ API, onClose, onGenerate }) {
  const [tab,             setTab]             = useState('leads') // 'leads' | 'news'
  const [leads,           setLeads]           = useState([])
  const [search,          setSearch]          = useState('')
  const [picked,          setPicked]          = useState(null)
  const [busy,            setBusy]            = useState(null)
  const [openSections,    setOpenSections]    = useState(new Set())
  const [openSubsections, setOpenSubsections] = useState(new Set())

  const toggleSection = (sec) => setOpenSections(prev => {
    const next = new Set(prev); next.has(sec) ? next.delete(sec) : next.add(sec); return next
  })
  const toggleSubsection = (key) => setOpenSubsections(prev => {
    const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next
  })
  // News headlines
  const [headlines,     setHeadlines]     = useState([])
  const [existingTitles,setExistingTitles]= useState([])
  const [newsBusy,      setNewsBusy]      = useState(false)
  const [dupConfirm,    setDupConfirm]    = useState(null) // headline string awaiting confirmation

  useEffect(() => {
    fetch(`${API}/api/admin/intel-leads`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d.status === 'success') setLeads(d.data.leads) })
      .catch(() => {})
    // Pre-load existing titles for duplicate detection
    fetch(`${API}/api/admin/briefs/titles`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d.status === 'success') setExistingTitles(d.data.titles.map(t => t.title)) })
      .catch(() => {})
  }, [API])

  const filtered = leads.filter(l =>
    !search || l.text.toLowerCase().includes(search.toLowerCase()) || l.section.toLowerCase().includes(search.toLowerCase())
  )

  const pickRandom = () => {
    if (!filtered.length) return
    const lead = filtered[Math.floor(Math.random() * filtered.length)]
    setPicked(lead)
    // Ensure the section and subsection containing this lead are open
    const sec = lead.section || 'General'
    const sub = lead.subsection || ''
    setOpenSections(prev => { const next = new Set(prev); next.add(sec); return next })
    if (sub) setOpenSubsections(prev => { const next = new Set(prev); next.add(`${sec}::${sub}`); return next })
  }

  const generate = async (topicOrHeadline, isHeadline = false) => {
    const lead = typeof topicOrHeadline === 'string' ? null : topicOrHeadline
    const key  = lead ? lead.text : topicOrHeadline
    setBusy(key)
    try {
      const body = isHeadline
        ? { headline: key }
        : { topic: key, category: leadSectionToCategory(lead?.section) }
      const res  = await fetch(`${API}/api/admin/ai/generate-brief`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.status === 'success') {
        onGenerate(data.data.brief, isHeadline ? null : lead)
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
      const res  = await fetch(`${API}/api/admin/ai/news-headlines`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timestamp: new Date().toISOString() }),
      })
      const data = await res.json()
      if (data.status === 'success') setHeadlines(data.data.headlines ?? [])
    } finally {
      setNewsBusy(false)
    }
  }

  const handleHeadlineClick = (headline) => {
    if (isSimilarTitle(headline, existingTitles)) {
      setDupConfirm(headline)
    } else {
      generate(headline, true)
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
          <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
            {[{ id: 'leads', label: '📋 Leads' }, { id: 'news', label: '📡 Live News' }].map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${tab === t.id ? 'bg-surface text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none ml-auto">✕</button>
        </div>

        {/* ── Leads tab ── */}
        {tab === 'leads' && (
          <>
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
                                            <LeadRow key={i} lead={lead} picked={picked} busy={busy} onGenerate={generate} />
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
                                <LeadRow key={i} lead={lead} picked={picked} busy={busy} onGenerate={generate} />
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
          </>
        )}

        {/* ── Live News tab ── */}
        {tab === 'news' && (
          <div className="overflow-y-auto flex-1 px-4 py-4">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-slate-500">Latest real RAF news headlines from the web.</p>
              <button
                onClick={fetchHeadlines}
                disabled={newsBusy}
                className="text-xs px-3 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {newsBusy ? '⏳ Fetching…' : '🔄 Fetch Headlines'}
              </button>
            </div>

            {headlines.length === 0 && !newsBusy && (
              <p className="text-sm text-slate-400 text-center py-8">Press "Fetch Headlines" to load the latest RAF news.</p>
            )}

            {newsBusy && (
              <div className="space-y-2">
                {[1,2,3].map(i => (
                  <div key={i} className="h-12 bg-slate-100 rounded-xl animate-pulse" />
                ))}
              </div>
            )}

            <div className="space-y-2">
              {headlines.map((headline, i) => {
                const isDup = isSimilarTitle(headline, existingTitles)
                return (
                  <div
                    key={i}
                    className={`flex items-start gap-3 px-3 py-2.5 rounded-xl border transition-all
                      ${isDup ? 'border-slate-200 bg-slate-50 opacity-60' : 'border-slate-200 bg-surface hover:border-brand-300 hover:bg-brand-50/30'}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold leading-snug ${isDup ? 'text-slate-400' : 'text-slate-800'}`}>
                        {headline}
                      </p>
                      {isDup && (
                        <p className="text-[10px] text-amber-600 font-semibold mt-0.5">⚠️ Possible duplicate brief</p>
                      )}
                    </div>
                    <button
                      onClick={() => handleHeadlineClick(headline)}
                      disabled={busy === headline}
                      className={`shrink-0 text-xs px-3 py-1.5 rounded-lg font-bold transition-colors whitespace-nowrap
                        ${isDup
                          ? 'border border-slate-300 text-slate-500 hover:bg-slate-100'
                          : 'border border-brand-300 bg-brand-50 text-brand-700 hover:bg-brand-100'
                        } disabled:opacity-40`}
                    >
                      {busy === headline ? '…' : isDup ? 'Create anyway' : 'Generate →'}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Duplicate confirmation overlay */}
        {dupConfirm && (
          <div className="absolute inset-0 bg-surface/95 rounded-2xl flex flex-col items-center justify-center p-6 text-center z-10">
            <p className="text-2xl mb-3">⚠️</p>
            <p className="font-bold text-slate-800 mb-2">Possible Duplicate</p>
            <p className="text-sm text-slate-500 mb-6 max-w-xs">
              A brief with a similar title already exists. Generate anyway?
            </p>
            <p className="text-xs font-semibold text-slate-700 bg-slate-100 rounded-xl px-3 py-2 mb-6 max-w-xs">
              "{dupConfirm}"
            </p>
            <div className="flex gap-3 w-full max-w-xs">
              <button onClick={() => setDupConfirm(null)} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold text-sm hover:bg-slate-50">
                Cancel
              </button>
              <button
                onClick={() => { setDupConfirm(null); generate(dupConfirm, true) }}
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

function BriefsTab({ API }) {
  const [view,          setView]          = useState('list')
  // List state
  const [briefs,        setBriefs]        = useState([])
  const [total,         setTotal]         = useState(0)
  const [loading,       setLoading]       = useState(false)
  const [page,          setPage]          = useState(1)
  const [search,        setSearch]        = useState('')
  const [category,      setCategory]      = useState('')
  const [toast,         setToast]         = useState('')
  const [showLeads,     setShowLeads]     = useState(false)
  // Editor state
  const [draft,         setDraft]         = useState({ ...EMPTY_DRAFT, descriptionSections: ['','',''] })
  const [easyQuestions, setEasyQuestions] = useState([])
  const [mediumQuestions,setMediumQuestions] = useState([])
  const [media,         setMedia]         = useState([])
  const [pendingImages, setPendingImages] = useState([])
  const [qTab,          setQTab]          = useState('easy')
  const [generating,    setGenerating]    = useState(null)
  const [autoGenerating,  setAutoGenerating]  = useState(false)
  const [regeneratingAll, setRegeneratingAll] = useState(false)
  const [saveStatus,    setSaveStatus]    = useState(null)
  const [briefId,       setBriefId]       = useState(null)
  const [pendingLead,   setPendingLead]   = useState(null)
  const [confirmDelete,     setConfirmDelete]     = useState(false)
  const [confirmRegen,      setConfirmRegen]      = useState(false)
  const [staleSourceWarning, setStaleSourceWarning] = useState(false)
  // Section open/close
  const [openSections,  setOpenSections]  = useState({ core: true, desc: true, keywords: false, questions: false, images: true, sources: false, gameData: false })

  const toggleSection = (key) => setOpenSections(p => ({ ...p, [key]: !p[key] }))

  // ── Load list ───────────────────────────────────────────────────────────────
  const loadList = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page, limit: 20 })
      if (search)   params.set('search', search)
      if (category) params.set('category', category)
      const res  = await fetch(`${API}/api/admin/briefs?${params}`, { credentials: 'include' })
      const data = await res.json()
      if (data.status === 'success') {
        setBriefs(data.data.briefs)
        setTotal(data.data.total)
      }
    } finally {
      setLoading(false)
    }
  }, [API, page, search, category])

  useEffect(() => {
    if (view === 'list') loadList()
  }, [view, loadList])

  // ── Open brief in editor ─────────────────────────────────────────────────
  const openBrief = async (b) => {
    const res  = await fetch(`${API}/api/admin/briefs/${b._id}`, { credentials: 'include' })
    const data = await res.json()
    if (data.status !== 'success') return
    const br = data.data.brief
    setDraft({
      title:               br.title ?? '',
      subtitle:            br.subtitle ?? '',
      category:            br.category ?? 'News',
      subcategory:         br.subcategory ?? '',
      historic:            br.historic ?? false,
      descriptionSections: br.descriptionSections?.length ? br.descriptionSections : ['','',''],
      keywords:            br.keywords ?? [],
      sources:             br.sources ?? [],
      gameData:            br.gameData ?? {},
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
    setView('editor')
  }

  const newBrief = () => {
    setDraft({ ...EMPTY_DRAFT, descriptionSections: ['','',''] })
    setEasyQuestions([])
    setMediumQuestions([])
    setMedia([])
    setPendingImages([])
    setBriefId(null)
    setQTab('easy')
    setSaveStatus(null)
    setStaleSourceWarning(false)
    setView('editor')
  }

  // ── Save brief ────────────────────────────────────────────────────────────
  const saveBrief = async () => {
    setSaveStatus('saving')
    try {
      const body = {
        ...draft,
        descriptionSections: draft.descriptionSections.filter(s => s.trim()),
        reason: briefId ? 'Admin edit' : 'Admin create',
      }
      const url    = briefId ? `${API}/api/admin/briefs/${briefId}` : `${API}/api/admin/briefs`
      const method = briefId ? 'PATCH' : 'POST'
      const res    = await fetch(url, {
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
        await fetch(`${API}/api/admin/briefs/${id}/questions`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ easyQuestions, mediumQuestions }),
        })
      }

      // Add any selected pending images
      const selected = pendingImages.filter(img => img.selected)
      for (const img of selected) {
        await fetch(`${API}/api/admin/briefs/${id}/media`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mediaType: 'picture', mediaUrl: img.url, cloudinaryPublicId: img.publicId }),
        })
      }

      // Reload full brief
      const reloadRes  = await fetch(`${API}/api/admin/briefs/${id}`, { credentials: 'include' })
      const reloadData = await reloadRes.json()
      if (reloadData.status === 'success') {
        const br = reloadData.data.brief
        setMedia(br.media ?? [])
        setPendingImages([])
      }

      // Mark lead complete if applicable
      if (pendingLead) {
        await fetch(`${API}/api/admin/intel-leads/mark-complete`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lead: pendingLead }),
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
    const res  = await fetch(`${API}/api/admin/briefs/${briefId}`, {
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
    const category    = lead ? leadSectionToCategory(lead.section) : 'News'
    const subcategory = lead ? leadSubsectionToSubcategory(lead.subsection) : ''
    const title       = briefData.title ?? ''
    const subtitle    = briefData.subtitle ?? ''
    const description = Array.isArray(briefData.descriptionSections)
      ? briefData.descriptionSections.join('\n\n')
      : ''

    setDraft({
      title,
      subtitle,
      category,
      subcategory,
      historic:            briefData.historic ?? false,
      descriptionSections: Array.isArray(briefData.descriptionSections) && briefData.descriptionSections.length
        ? briefData.descriptionSections
        : ['','',''],
      keywords:            Array.isArray(briefData.keywords) ? briefData.keywords : [],
      sources:             Array.isArray(briefData.sources) ? briefData.sources : [],
      gameData:            (briefData.gameData && typeof briefData.gameData === 'object') ? briefData.gameData : {},
    })
    setEasyQuestions([])
    setMediumQuestions([])
    setMedia([])
    setPendingImages([])
    setBriefId(null)
    setPendingLead(lead ? lead.text : null)
    setStaleSourceWarning(briefData.staleSourceWarning ?? false)
    setView('editor')

    // Auto-generate questions and images in parallel
    setAutoGenerating(true)
    try {
      const [qRes, imgRes] = await Promise.all([
        fetch(`${API}/api/admin/ai/generate-quiz`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, description }),
        }),
        fetch(`${API}/api/admin/ai/generate-image`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, subtitle }),
        }),
      ])
      const [qData, imgData] = await Promise.all([qRes.json(), imgRes.json()])
      if (qData.status === 'success') {
        setEasyQuestions(qData.data.easyQuestions ?? [])
        setMediumQuestions(qData.data.mediumQuestions ?? [])
      }
      if (imgData.status === 'success') {
        setPendingImages((imgData.data.images ?? []).map(img => ({ ...img, selected: true })))
      }
    } finally {
      setAutoGenerating(false)
    }
  }

  // ── AI: Generate keywords ─────────────────────────────────────────────────
  const generateKeywords = async () => {
    setGenerating('keywords')
    try {
      const description = draft.descriptionSections.join(' ')
      const res  = await fetch(`${API}/api/admin/ai/generate-keywords`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, existingKeywords: [], needed: 10 }),
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
      const res  = await fetch(`${API}/api/admin/ai/generate-quiz`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: draft.title, description: draft.descriptionSections.join('\n\n') }),
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

  // ── Save questions only ────────────────────────────────────────────────────
  const saveQuestions = async () => {
    if (!briefId) return
    setGenerating('questions')
    try {
      await fetch(`${API}/api/admin/briefs/${briefId}/questions`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ easyQuestions, mediumQuestions }),
      })
      setToast('Questions saved')
    } finally {
      setGenerating(null)
    }
  }

  // ── AI: Generate images ───────────────────────────────────────────────────
  const generateImages = async () => {
    setGenerating('images')
    try {
      const res  = await fetch(`${API}/api/admin/ai/generate-image`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: draft.title, subtitle: draft.subtitle }),
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
    try {
      // Cascade: wipe all user stats / coins tied to this brief
      const cascadeRes  = await fetch(`${API}/api/admin/briefs/${briefId}/confirm-regeneration`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      const cascadeData = await cascadeRes.json()
      if (cascadeData.status !== 'success') throw new Error(cascadeData.message ?? 'Cascade failed')

      // AI regeneration
      const regenRes  = await fetch(`${API}/api/admin/ai/regenerate-brief/${briefId}`, {
        method: 'POST', credentials: 'include',
      })
      const regenData = await regenRes.json()
      if (regenData.status !== 'success') throw new Error(regenData.message ?? 'Regeneration failed')

      const { descriptionSections, keywords, easyQuestions, mediumQuestions, gameData } = regenData.data
      setDraft(p => ({ ...p, descriptionSections, keywords, ...(gameData ? { gameData } : {}) }))
      setEasyQuestions(easyQuestions ?? [])
      setMediumQuestions(mediumQuestions ?? [])
      setToast('Regenerated — review and save when ready')
    } catch (err) {
      setToast(`Regenerate failed: ${err.message}`)
    } finally {
      setRegeneratingAll(false)
    }
  }

  // ── Generate description sections only (no cascade, no keywords/questions) ─
  const generateDescription = async () => {
    if (!briefId) return
    setGenerating('description')
    try {
      const res  = await fetch(`${API}/api/admin/ai/regenerate-description/${briefId}`, {
        method: 'POST', credentials: 'include',
      })
      const data = await res.json()
      if (data.status !== 'success') throw new Error(data.message ?? 'Generation failed')
      setDraft(p => ({ ...p, descriptionSections: data.data.descriptionSections }))
      setToast('Description generated — review and save when ready')
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
      await fetch(`${API}/api/admin/briefs/${briefId}/media`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaType: 'picture', mediaUrl: img.url, cloudinaryPublicId: img.publicId }),
      })
    }
    // Reload media
    const res  = await fetch(`${API}/api/admin/briefs/${briefId}`, { credentials: 'include' })
    const data = await res.json()
    if (data.status === 'success') setMedia(data.data.brief.media ?? [])
    setPendingImages([])
    setToast('Images added')
  }

  // ── Remove media item ─────────────────────────────────────────────────────
  const removeMedia = async (mediaId) => {
    await fetch(`${API}/api/admin/briefs/${briefId}/media/${mediaId}`, {
      method: 'DELETE', credentials: 'include',
    })
    setMedia(p => p.filter(m => String(m._id) !== String(mediaId)))
  }

  // ── Status badge helper ───────────────────────────────────────────────────
  function BriefStatusPills({ brief }) {
    const hasKeywords = (brief.keywords?.length ?? 0) >= 10
    const hasEasy     = (brief.quizQuestionsEasy?.length ?? 0) >= 10
    const hasMedium   = (brief.quizQuestionsMedium?.length ?? 0) >= 10
    const hasQuiz     = hasEasy && hasMedium
    const hasMedia    = (brief.media?.length ?? 0) > 0
    return (
      <span className="flex gap-1 items-center">
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${hasKeywords ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>K</span>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${hasQuiz ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>Q</span>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${hasMedia ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>M</span>
      </span>
    )
  }

  // ── Word count for description ────────────────────────────────────────────
  const wordCount = draft.descriptionSections.join(' ').split(/\s+/).filter(Boolean).length

  // ── Keyword verbatim warning ─────────────────────────────────────────────
  const descLower = draft.descriptionSections.join(' ').toLowerCase()
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
            onClose={() => setShowLeads(false)}
            onGenerate={handleLeadGenerate}
          />
        )}

        {/* Top bar */}
        <div className="flex flex-wrap gap-2 mb-4">
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search briefs…"
            className="flex-1 min-w-[160px] border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-200"
          />
          <select
            value={category}
            onChange={e => { setCategory(e.target.value); setPage(1) }}
            className="border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-200"
          >
            <option value="">All Categories</option>
            {BRIEF_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
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
        </div>

        {/* Brief list */}
        <div className="bg-surface rounded-2xl border border-slate-200 overflow-hidden mb-4">
          {loading && <p className="py-8 text-center text-slate-400 text-sm animate-pulse">Loading…</p>}
          {!loading && briefs.length === 0 && <p className="py-8 text-center text-slate-400 text-sm">No briefs found</p>}
          {briefs.map((b, i) => (
            <button
              key={b._id}
              onClick={() => openBrief(b)}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors ${i !== 0 ? 'border-t border-slate-100' : ''}`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{b.title}</p>
                <p className="text-xs text-slate-400 truncate">{b.subtitle}</p>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 whitespace-nowrap">{b.category}</span>
              <BriefStatusPills brief={b} />
              <span className="text-slate-300 text-sm">›</span>
            </button>
          ))}
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
          body="This will delete all read history, quiz game stats, Battle of Order stats, Who's That Aircraft stats, Flashcard stats, and all Aircoins awarded for this brief — for every user. This cannot be undone."
          confirmLabel="Confirm & Regenerate"
          danger
          onConfirm={handleConfirmRegen}
          onCancel={() => setConfirmRegen(false)}
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
          {briefId && <p className="text-[10px] text-slate-400 font-mono truncate">{briefId}</p>}
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

      {/* ── Section A: Core Fields ─────────────────────────────────────── */}
      <div className="bg-surface rounded-2xl border border-slate-200 overflow-hidden mb-4">
        <button
          onClick={() => toggleSection('core')}
          className="w-full flex items-center justify-between px-5 py-4 border-b border-slate-100 text-left"
        >
          <h3 className="font-bold text-slate-800">Core Fields</h3>
          <span className="text-slate-400 text-xs">{openSections.core ? '▲' : '▼'}</span>
        </button>
        {openSections.core && (
          <div className="px-5 py-4 space-y-3">
            {/* Category */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Category</label>
              <select
                value={draft.category}
                onChange={e => setDraft(p => ({ ...p, category: e.target.value, subcategory: '' }))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-200"
              >
                {BRIEF_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {/* Subcategory */}
            {(BRIEF_SUBCATEGORIES[draft.category] ?? []).length > 0 && (
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Subcategory</label>
                <select
                  value={draft.subcategory}
                  onChange={e => setDraft(p => ({ ...p, subcategory: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-200"
                >
                  <option value="">— none —</option>
                  {(BRIEF_SUBCATEGORIES[draft.category] ?? []).map(s => <option key={s} value={s}>{s}</option>)}
                </select>
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
            {/* Title */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Title</label>
              <input
                type="text"
                value={draft.title}
                onChange={e => setDraft(p => ({ ...p, title: e.target.value }))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-200"
              />
            </div>
            {/* Subtitle */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Subtitle</label>
              <input
                type="text"
                value={draft.subtitle}
                onChange={e => setDraft(p => ({ ...p, subtitle: e.target.value }))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-200"
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Section B: Description ─────────────────────────────────────── */}
      <div className="bg-surface rounded-2xl border border-slate-200 overflow-hidden mb-4">
        <button
          onClick={() => toggleSection('desc')}
          className="w-full flex items-center justify-between px-5 py-4 border-b border-slate-100 text-left"
        >
          <h3 className="font-bold text-slate-800">Description Sections</h3>
          <span className="text-slate-400 text-xs">{openSections.desc ? '▲' : '▼'}</span>
        </button>
        {openSections.desc && (
          <div className="px-5 py-4 space-y-3">
            {draft.descriptionSections.map((sec, idx) => (
              <div key={idx}>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-500">Section {idx + 1}</label>
                  <button
                    onClick={() => setDraft(p => ({ ...p, descriptionSections: p.descriptionSections.filter((_, i) => i !== idx) }))}
                    disabled={draft.descriptionSections.length <= 1}
                    className="text-xs text-red-400 hover:text-red-600 disabled:opacity-30"
                  >
                    Remove
                  </button>
                </div>
                <textarea
                  rows={4}
                  value={sec}
                  onChange={e => setDraft(p => {
                    const s = [...p.descriptionSections]; s[idx] = e.target.value; return { ...p, descriptionSections: s }
                  })}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none outline-none focus:ring-2 focus:ring-brand-200"
                />
              </div>
            ))}
            <div className="flex items-center justify-between pt-1 gap-2 flex-wrap">
              <button
                onClick={() => setDraft(p => ({ ...p, descriptionSections: [...p.descriptionSections, ''] }))}
                disabled={draft.descriptionSections.length >= 4}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 font-semibold disabled:opacity-40 hover:bg-slate-50 transition-colors"
              >
                + Add Section
              </button>
              {briefId && (
                <button
                  onClick={generateDescription}
                  disabled={generating === 'description' || regeneratingAll}
                  className="text-xs px-3 py-1.5 rounded-lg border border-sky-200 bg-sky-50 text-sky-700 font-semibold hover:bg-sky-100 transition-colors disabled:opacity-40"
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

      {/* ── Section C: Images ─────────────────────────────────────────── */}
      <div className="bg-surface rounded-2xl border border-slate-200 overflow-hidden mb-4">
        <button
          onClick={() => toggleSection('images')}
          className="w-full flex items-center justify-between px-5 py-4 border-b border-slate-100 text-left"
        >
          <h3 className="font-bold text-slate-800">Images</h3>
          <span className="text-slate-400 text-xs">{openSections.images ? '▲' : '▼'}</span>
        </button>
        {openSections.images && (
          <div className="px-5 py-4">
            {/* Existing media */}
            {media.length > 0 && (
              <div className="grid grid-cols-2 gap-3 mb-4">
                {media.map(m => (
                  <div key={m._id} className="relative group">
                    <img src={m.mediaUrl.startsWith('/') ? `${API}${m.mediaUrl}` : m.mediaUrl} alt="" className="w-full h-32 object-cover rounded-xl border border-slate-200" />
                    <button
                      onClick={() => removeMedia(m._id)}
                      className="absolute top-1 right-1 bg-red-500 text-white text-xs rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ✕
                    </button>
                    <p className="text-[10px] text-slate-400 truncate mt-1 px-0.5">
                      {m.cloudinaryPublicId ?? m.mediaUrl.split('/').pop().replace(/\.[^.]+$/, '')}
                    </p>
                  </div>
                ))}
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
                      <img src={img.url} alt="" className={`w-full h-32 object-cover rounded-xl border-2 transition-all ${img.selected ? 'border-brand-500' : 'border-slate-200 opacity-50'}`} />
                      <input
                        type="checkbox"
                        checked={img.selected}
                        onChange={e => setPendingImages(p => p.map((x, j) => j === i ? { ...x, selected: e.target.checked } : x))}
                        className="absolute top-2 left-2"
                      />
                      <p className="text-[10px] text-slate-400 truncate mt-1 px-0.5">{img.wikiPage || img.term}</p>
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
          </div>
        )}
      </div>

      {/* ── Section D: Game Data (BOO categories only) ─────────────────── */}
      {BOO_CATEGORIES.includes(draft.category) && (
        <div className="bg-surface rounded-2xl border border-slate-200 overflow-hidden mb-4">
          <button
            onClick={() => toggleSection('gameData')}
            className="w-full flex items-center justify-between px-5 py-4 border-b border-slate-100 text-left"
          >
            <h3 className="font-bold text-slate-800">⚔️ Game Data</h3>
            <span className="text-slate-400 text-xs">{openSections.gameData ? '▲' : '▼'}</span>
          </button>
          {openSections.gameData && (
            <div className="px-5 py-4 space-y-3">
              {draft.category === 'Aircrafts' && (
                <AircraftDataSection draft={draft} setDraft={setDraft} briefId={briefId} API={API} />
              )}
              {draft.category === 'Ranks' && (
                <RankDataField draft={draft} setDraft={setDraft} briefId={briefId} API={API} />
              )}
              {draft.category === 'Training' && (<>
                <GameDataField label="Training Week Start" field="trainingWeekStart" draft={draft} setDraft={setDraft} />
                <GameDataField label="Training Week End" field="trainingWeekEnd" draft={draft} setDraft={setDraft} />
              </>)}
              {['Missions', 'Tech', 'Treaties'].includes(draft.category) && (<>
                <GameDataField label="Start Year" field="startYear" draft={draft} setDraft={setDraft} />
                <GameDataField label="End Year (blank = ongoing)" field="endYear" draft={draft} setDraft={setDraft} nullable />
              </>)}
            </div>
          )}
        </div>
      )}

      {/* ── Section E: Sources ────────────────────────────────────────── */}
      <div className="bg-surface rounded-2xl border border-slate-200 overflow-hidden mb-4">
        <button
          onClick={() => toggleSection('sources')}
          className="w-full flex items-center justify-between px-5 py-4 border-b border-slate-100 text-left"
        >
          <h3 className="font-bold text-slate-800">Sources</h3>
          <span className="text-slate-400 text-xs">{openSections.sources ? '▲' : '▼'}</span>
        </button>
        {openSections.sources && (
          <div className="px-5 py-4 space-y-3">
            {draft.sources.map((src, idx) => (
              <div key={idx} className="border border-slate-100 rounded-xl p-3 bg-slate-50 space-y-2">
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
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-200"
                />
                <input
                  type="text"
                  value={src.siteName ?? ''}
                  onChange={e => setDraft(p => { const s = [...p.sources]; s[idx] = { ...s[idx], siteName: e.target.value }; return { ...p, sources: s } })}
                  placeholder="Site Name"
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-200"
                />
                <input
                  type="text"
                  value={src.articleDate ?? ''}
                  onChange={e => setDraft(p => { const s = [...p.sources]; s[idx] = { ...s[idx], articleDate: e.target.value }; return { ...p, sources: s } })}
                  placeholder="Date (YYYY-MM-DD)"
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-200"
                />
              </div>
            ))}
            <button
              onClick={() => setDraft(p => ({ ...p, sources: [...p.sources, { url: '', siteName: '', articleDate: '' }] }))}
              className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50 transition-colors"
            >
              + Add Source
            </button>
          </div>
        )}
      </div>

      {/* ── Section F: Keywords ───────────────────────────────────────── */}
      <div className="bg-surface rounded-2xl border border-slate-200 overflow-hidden mb-4">
        <button
          onClick={() => toggleSection('keywords')}
          className="w-full flex items-center justify-between px-5 py-4 border-b border-slate-100 text-left"
        >
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-slate-800">Keywords</h3>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${draft.keywords.length >= 10 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
              {draft.keywords.length} / 10
            </span>
            {badKeywords.length > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                {badKeywords.length} not in text
              </span>
            )}
          </div>
          <span className="text-slate-400 text-xs">{openSections.keywords ? '▲' : '▼'}</span>
        </button>
        {openSections.keywords && (
          <div className="px-5 py-4 space-y-3">
            {draft.keywords.map((kw, idx) => (
              <div key={idx} className={`p-3 rounded-xl border ${!descLower.includes(kw.keyword?.toLowerCase()) && kw.keyword ? 'border-amber-200 bg-amber-50' : 'border-slate-100 bg-slate-50'}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-500">Keyword {idx + 1}</label>
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
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-200 mb-1.5"
                />
                <textarea
                  rows={2}
                  value={kw.generatedDescription ?? ''}
                  onChange={e => setDraft(p => {
                    const kws = [...p.keywords]; kws[idx] = { ...kws[idx], generatedDescription: e.target.value }; return { ...p, keywords: kws }
                  })}
                  placeholder="Description"
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm resize-none outline-none focus:ring-2 focus:ring-brand-200"
                />
              </div>
            ))}
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setDraft(p => ({ ...p, keywords: [...p.keywords, { keyword: '', generatedDescription: '' }] }))}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50 transition-colors"
              >
                + Add Keyword
              </button>
              <button
                onClick={generateKeywords}
                disabled={generating === 'keywords' || regeneratingAll}
                className="text-xs px-3 py-1.5 rounded-lg border border-brand-300 bg-brand-50 text-brand-700 font-semibold hover:bg-brand-100 transition-colors disabled:opacity-40"
              >
                {generating === 'keywords' ? '↺ Generating…' : '↺ Generate Keywords'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Section G: Quiz Questions ─────────────────────────────────── */}
      <div className="bg-surface rounded-2xl border border-slate-200 overflow-hidden mb-4">
        <button
          onClick={() => toggleSection('questions')}
          className="w-full flex items-center justify-between px-5 py-4 border-b border-slate-100 text-left"
        >
          <h3 className="font-bold text-slate-800">Quiz Questions</h3>
          <span className="text-slate-400 text-xs">{openSections.questions ? '▲' : '▼'}</span>
        </button>
        {openSections.questions && (
          <div className="px-5 py-4">
            {/* Tab switcher */}
            <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-4">
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
                <div key={qIdx} className="border border-slate-200 rounded-xl p-4">
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
                    className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-200 mb-3"
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
                          className="flex-1 border border-slate-200 rounded-lg px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-brand-200"
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
                disabled={generating === 'questions' || autoGenerating || regeneratingAll}
                className="text-xs px-3 py-1.5 rounded-lg border border-brand-300 bg-brand-50 text-brand-700 font-semibold hover:bg-brand-100 transition-colors disabled:opacity-40"
              >
                {generating === 'questions' || autoGenerating ? '↺ Generating…' : '↺ Generate Questions'}
              </button>
              {briefId && (easyQuestions.length > 0 || mediumQuestions.length > 0) && (
                <button
                  onClick={saveQuestions}
                  disabled={generating === 'questions'}
                  className="text-xs px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 font-semibold hover:bg-emerald-100 transition-colors disabled:opacity-40"
                >
                  Save Questions
                </button>
              )}
            </div>
          </div>
        )}
      </div>
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
        className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-200"
      />
    </div>
  )
}

function AircraftDataSection({ draft, setDraft, briefId, API }) {
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState(null)

  const generate = async () => {
    setBusy(true)
    setErr(null)
    try {
      const res  = await fetch(`${API}/api/admin/ai/generate-battle-order-data`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:       draft.title,
          description: draft.descriptionSections.join('\n\n'),
          category:    'Aircrafts',
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
      <GameDataField label="Year Introduced" field="yearIntroduced" draft={draft} setDraft={setDraft} />
      <GameDataField label="Year Retired (blank = still in service)" field="yearRetired" draft={draft} setDraft={setDraft} nullable />
      <div className="pt-1">
        <button
          onClick={generate}
          disabled={busy}
          className="text-xs px-3 py-2 rounded-xl border border-brand-300 bg-brand-50 text-brand-700 font-semibold hover:bg-brand-100 disabled:opacity-40 transition-colors"
        >
          {busy ? '↺ Generating…' : '↺ Generate Stats'}
        </button>
        {err && <p className="text-xs text-red-500 mt-1">{err}</p>}
      </div>
    </>
  )
}

function RankDataField({ draft, setDraft, briefId, API }) {
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState(null)

  const lookup = async () => {
    if (!briefId) return
    setBusy(true)
    setErr(null)
    try {
      const res  = await fetch(`${API}/api/admin/ai/generate-rank-data/${briefId}`, {
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

  return (
    <div>
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
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGS TAB
// ─────────────────────────────────────────────────────────────────────────────

const ACTION_TYPE_LABELS = {
  ban_user:                  { label: 'Ban User',              color: 'bg-red-100 text-red-700'       },
  unban_user:                { label: 'Unban User',            color: 'bg-green-100 text-green-700'   },
  delete_user:               { label: 'Delete User',           color: 'bg-red-100 text-red-700'       },
  remove_admin:              { label: 'Remove Admin',          color: 'bg-orange-100 text-orange-700' },
  reset_user_stats:          { label: 'Reset Stats',           color: 'bg-amber-100 text-amber-700'   },
  make_admin:                { label: 'Make Admin',            color: 'bg-purple-100 text-purple-700' },
  change_quiz_questions:     { label: 'Quiz Questions',        color: 'bg-blue-100 text-blue-700'     },
  change_aircoins:           { label: 'Aircoins',              color: 'bg-amber-100 text-amber-700'   },
  change_trial_duration:     { label: 'Trial Duration',        color: 'bg-slate-100 text-slate-600'   },
  change_silver_categories:  { label: 'Silver Categories',     color: 'bg-slate-100 text-slate-600'   },
  change_ammo_defaults:      { label: 'Ammo Defaults',         color: 'bg-slate-100 text-slate-600'   },
  create_brief:              { label: 'Create Brief',          color: 'bg-emerald-100 text-emerald-700' },
  edit_brief:                { label: 'Edit Brief',            color: 'bg-sky-100 text-sky-700'       },
  delete_brief:              { label: 'Delete Brief',          color: 'bg-red-100 text-red-700'       },
  regenerate_brief_cascade:  { label: 'Regenerate Brief',      color: 'bg-violet-100 text-violet-700' },
  award_test_coins:          { label: 'Award Coins',           color: 'bg-amber-100 text-amber-700'   },
  change_subscription:       { label: 'Change Subscription',   color: 'bg-indigo-100 text-indigo-700' },
}

const ALL_ACTION_TYPES = Object.keys(ACTION_TYPE_LABELS)

function ActionBadge({ type }) {
  const meta = ACTION_TYPE_LABELS[type] ?? { label: type, color: 'bg-slate-100 text-slate-500' }
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${meta.color}`}>
      {meta.label}
    </span>
  )
}

function LogsTab({ API }) {
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
    fetch(`${API}/api/admin/actions?${params}`, { credentials: 'include' })
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
        <h2 className="text-base font-bold text-slate-800">Admin Action Logs</h2>
        <select
          value={typeFilter}
          onChange={handleTypeChange}
          className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-600 bg-white focus:outline-none focus:ring-1 focus:ring-brand-400"
        >
          <option value="">All actions</option>
          {ALL_ACTION_TYPES.map(t => (
            <option key={t} value={t}>{ACTION_TYPE_LABELS[t].label}</option>
          ))}
        </select>
      </div>

      <div className="bg-surface rounded-2xl border border-slate-200 overflow-hidden mb-4">
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
              className={`px-4 py-3 ${i !== 0 ? 'border-t border-slate-100' : ''}`}
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
                  <p className="text-xs text-slate-600 truncate">{a.reason}</p>
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

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'stats',    label: 'Stats',    icon: '📊' },
  { id: 'settings', label: 'Settings', icon: '⚙️'  },
  { id: 'users',    label: 'Users',    icon: '👥'  },
  { id: 'problems', label: 'Reports',  icon: '🚩'  },
  { id: 'content',  label: 'Content',  icon: '✏️'  },
  { id: 'briefs',   label: 'Briefs',   icon: '📄'  },
  { id: 'logs',     label: 'Logs',     icon: '📋'  },
]

export default function Admin() {
  const { user, setUser, loading, API } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState('stats')
  const [unsolvedCount, setUnsolvedCount] = useState(null)

  useEffect(() => {
    if (!loading && (!user || !user.isAdmin)) navigate('/home', { replace: true })
  }, [loading, user, navigate])

  // Fetch unsolved count for tab badge; refresh whenever leaving the problems tab
  useEffect(() => {
    if (!user?.isAdmin) return
    fetch(`${API}/api/admin/problems/count`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setUnsolvedCount(d.data?.unsolvedCount ?? 0))
      .catch(() => {})
  }, [API, user, tab])

  if (loading || !user?.isAdmin) return null

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-2xl mx-auto px-4 py-6">

        {/* Header */}
        <div className="mb-5">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Restricted Access</p>
          <h1 className="text-2xl font-extrabold text-slate-900">Admin Panel</h1>
        </div>

        {/* Subscription emulator */}
        <SubEmulator user={user} API={API} onTierChange={setUser} />

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
              {t.id === 'problems' && unsolvedCount > 0 && (
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
            {tab === 'stats'    && <StatsTab    API={API} />}
            {tab === 'settings' && <SettingsTab API={API} />}
            {tab === 'users'    && <UsersTab    API={API} />}
            {tab === 'problems' && <ProblemsTab API={API} />}
            {tab === 'content'  && <ContentTab  API={API} />}
            {tab === 'briefs'   && <BriefsTab   API={API} />}
            {tab === 'logs'     && <LogsTab     API={API} />}
          </motion.div>
        </AnimatePresence>

      </div>
    </div>
  )
}
