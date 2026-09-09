import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { useAppSettings } from '../context/AppSettingsContext'
import { getLevelInfo } from '../utils/levelUtils'
import { CBAT_LEADERBOARD_CONFIG, cbatTitleWithDifficulty } from '../data/cbatGames'
import UserCbatProgressModal from '../components/admin/UserCbatProgressModal'
import AptitudeReportCard from '../components/AptitudeReportCard'
import ProfileBadge from '../components/ProfileBadge'
import CbatPassedBadge from '../components/CbatPassedBadge'
import SEO from '../components/SEO'

// One agent, read-only, for an admin who has just met a name in Community.
//
// The user card in a channel answers "who is this" with a display name and an
// agent number, which is nowhere near enough to judge a post. This page is the
// rest of the answer: how far in they are, what they have collected, and how
// much CBAT they have actually sat. It deliberately changes NOTHING — every
// moderation control (ban, tier, award, delete) stays on Admin ▸ Users, where
// it is guarded by a written reason. A profile you can read without arming
// anything is a profile you open freely.
//
// Admin-only, and it says so twice: the ADMIN VIEW pill here, and the ADMIN
// mark on the button in Community that opens it. Nothing about this page is
// reachable by, or visible to, the agent it describes.

// Locked badges are shown, not hidden. "12 of 30" only means something if you
// can see the 18 — and the shape of what someone has NOT collected is the more
// useful read (all trainers and no fast jets says something).
function BadgeTile({ badge, earned, wearing }) {
  return (
    <div
      title={earned ? badge.title : `${badge.title} (not collected)`}
      className={`relative rounded-xl border p-2 flex flex-col items-center gap-1 text-center transition-colors
        ${earned
          ? 'bg-brand-100/40 border-brand-300/50'
          : 'bg-surface-raised/30 border-slate-100'}
        ${wearing ? 'ring-2 ring-brand-600' : ''}`}
    >
      <div className="w-full aspect-square flex items-center justify-center">
        <img
          src={badge.cutoutUrl}
          alt=""
          draggable={false}
          className={`max-w-full max-h-full object-contain ${earned ? '' : 'opacity-25 grayscale'}`}
        />
      </div>
      <p className={`text-[10px] leading-tight font-semibold line-clamp-2 ${earned ? 'text-slate-700' : 'text-slate-400'}`}>
        {badge.title}
      </p>
      {wearing && (
        <span className="absolute top-1 right-1 text-[8px] font-extrabold uppercase tracking-wide bg-brand-600 text-white px-1 py-px rounded">
          Worn
        </span>
      )}
    </div>
  )
}

const MEDAL_FACE = { 1: '\u{1F947}', 2: '\u{1F948}', 3: '\u{1F949}' }
const MEDAL_WORD = { 1: 'Gold', 2: 'Silver', 3: 'Bronze' }

// A podium place, spelled out. Chat shows these as a tight overlapping stack on
// an avatar because it has about twelve pixels to work with; this page has a
// whole card, so each medal gets its own row and says which board it was won on.
// Same places either way: both are read off the padded board a player sees.
function MedalRow({ medal }) {
  const TONE = {
    1: 'bg-amber-200/50 border-amber-300/50',
    2: 'bg-slate-100 border-slate-200',
    3: 'bg-amber-100/30 border-amber-200/40',
  }
  return (
    <div className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 ${TONE[medal.rank] ?? TONE[3]}`}>
      <span className="text-xl leading-none" aria-hidden="true">{MEDAL_FACE[medal.rank] ?? '\u{1F396}\uFE0F'}</span>
      <div className="min-w-0">
        <p className="text-xs font-extrabold text-slate-800 leading-tight">
          {MEDAL_WORD[medal.rank] ?? 'Podium'}
        </p>
        <p className="text-[11px] text-slate-500 truncate">{medal.gameLabel}</p>
      </div>
    </div>
  )
}

// Board position as a chip on a CBAT record row. Top three get the medal face
// they hold; everyone else gets a plain "#7". Outside the top 20 there is no
// position to show, so nothing is drawn rather than a misleading "21+".
function BoardRankChip({ rank }) {
  if (!rank) return null
  if (rank <= 3) {
    return (
      <span
        title={`${MEDAL_WORD[rank]} on this board right now`}
        className="text-sm leading-none"
      >
        {MEDAL_FACE[rank]}
      </span>
    )
  }
  return (
    <span
      title="Their place on this all-time board right now"
      className="text-[10px] font-bold text-slate-500 bg-slate-100 rounded px-1.5 py-px"
    >
      #{rank}
    </span>
  )
}

function StatTile({ label, value, onClick, hint }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      {...(onClick ? { type: 'button', onClick } : {})}
      title={hint}
      className={`bg-surface border border-slate-200 rounded-xl px-3 py-2.5 text-center
        ${onClick ? 'hover:border-brand-300 transition-colors cursor-pointer' : ''}`}
    >
      <p className="text-base font-extrabold text-slate-800">{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-slate-400 mt-0.5">{label}</p>
    </Tag>
  )
}

function Flag({ children, tone = 'slate' }) {
  const TONES = {
    slate:   'bg-slate-100 text-slate-600',
    brand:   'bg-brand-100/60 text-brand-700',
    emerald: 'bg-emerald-200/60 text-emerald-800',
    amber:   'bg-amber-200/60 text-amber-800',
    red:     'bg-red-100 text-red-600',
  }
  return (
    <span className={`text-[9px] font-bold px-1.5 py-px rounded uppercase tracking-wide ${TONES[tone]}`}>
      {children}
    </span>
  )
}

const fmtDate = (iso) => (iso
  ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—')

const fmtDateTime = (iso) => (iso
  ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : 'Never')

export default function AdminAgentProfile() {
  const { id } = useParams()
  const { user, API, apiFetch } = useAuth()
  const { levels } = useAppSettings()
  const navigate = useNavigate()
  const location = useLocation()

  // Where "Back" goes. Community sends the thread it was opened from, so an
  // admin who tapped a name mid-conversation lands back in that conversation
  // rather than in the admin panel they were never in.
  const backTo    = location.state?.backTo    ?? '/admin'
  const backLabel = location.state?.backLabel ?? 'Back to Admin'
  const backState = location.state?.backState ?? (backTo === '/admin' ? { tab: 'users' } : undefined)

  const [data,     setData]     = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')
  const [showAllBadges, setShowAllBadges] = useState(false)
  const [progressOpen,  setProgressOpen]  = useState(false)

  useEffect(() => {
    if (!user) { navigate('/login'); return }
    if (!user.isAdmin) { navigate('/'); return }
  }, [user, navigate])

  useEffect(() => {
    if (!user?.isAdmin) return
    let cancelled = false
    setLoading(true); setError('')
    apiFetch(`${API}/api/admin/users/${id}/profile`, { credentials: 'include' })
      .then(async res => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.message || 'Could not load that agent')
        return body
      })
      .then(body => { if (!cancelled) { setData(body.data ?? null); setLoading(false) } })
      .catch(err => { if (!cancelled) { setError(err.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [API, apiFetch, id, user?.isAdmin])

  const agent = data?.user ?? null
  const stats = data?.stats ?? {}
  const label = agent?.displayName || agent?.email || `Agent #${agent?.agentNumber ?? '———'}`

  const levelInfo = useMemo(
    () => getLevelInfo(agent?.cycleAirstars ?? 0, levels),
    [agent?.cycleAirstars, levels],
  )

  const medals = data?.medals ?? []
  const earned = data?.badges?.earned ?? []
  const locked = data?.badges?.locked ?? []
  const collectable = earned.length + locked.length
  // Collapsed to the collection by default. A long tail of locked aircraft is
  // the least interesting thing here, and on a phone it pushes the CBAT record
  // three screens down.
  const shownBadges = showAllBadges ? [...earned, ...locked] : earned
  const earnedIds = new Set(earned.map(b => String(b.briefId)))

  // The history pages already have an admin mode; they just need to be told
  // where to come back to, or they send the admin to /admin instead of here.
  const historyState = {
    adminUserId: id,
    adminUserName: label,
    backTo: `/admin/agent/${id}`,
    backLabel: 'Back to Profile',
    backState: location.state,
  }

  const rankLine = agent?.rank?.rankName
    ? `${agent.rank.rankName} (${agent.rank.rankAbbreviation})`
    : 'Unranked'

  return (
    <div className="max-w-lg mx-auto pb-8">
      <SEO title="Agent Profile" description="Admin view of one agent." noIndex={true} />

      <div className="mb-4">
        <button
          onClick={() => navigate(backTo, backState ? { state: backState } : undefined)}
          className="text-sm text-slate-500 hover:text-slate-700 transition-colors mb-3 flex items-center gap-1"
        >
          ← {backLabel}
        </button>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold bg-brand-600 text-white px-2 py-0.5 rounded-full uppercase tracking-wider">
            Admin View
          </span>
          <span className="text-[10px] text-slate-400">Read only. Nothing here is visible to the agent.</span>
        </div>
      </div>

      {loading && <p className="text-sm text-slate-400 py-8 text-center">Loading agent…</p>}
      {error && !loading && (
        <div className="bg-surface border border-red-200 rounded-2xl p-5 text-center">
          <p className="text-sm text-red-600 font-semibold">{error}</p>
        </div>
      )}

      {!loading && !error && agent && (
        <>
          {/* Identity — same card the agent sees on their own Profile, so an
              admin reading it is reading what the agent reads. */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl p-5 mb-4 card-shadow border border-brand-300/40"
            style={{ background: 'linear-gradient(135deg, #0f2850 0%, #081930 100%)' }}
          >
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-brand-200/60 border-2 border-brand-400/50 flex items-center justify-center shrink-0">
                <ProfileBadge user={agent} size={agent.selectedBadge?.cutoutUrl ? 48 : 38} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 max-w-full">
                  <p className="min-w-0 font-extrabold text-lg text-slate-800 leading-tight truncate">
                    {agent.displayName || `Agent #${agent.agentNumber ?? '———'}`}
                  </p>
                  {agent.cbatPassed && <CbatPassedBadge />}
                </div>
                <p className="text-slate-600 text-sm">{rankLine}</p>
                <p className="text-slate-500 text-xs mt-0.5 intel-mono">#{agent.agentNumber ?? '———'}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-slate-500 intel-mono">Streak</p>
                <p className="text-2xl font-extrabold text-brand-700">{agent.loginStreak ?? 0}</p>
                <p className="text-lg flame-blue">🔥</p>
              </div>
            </div>

            {levelInfo && (
              <div className="mt-4">
                <div className="flex justify-between text-xs text-slate-600 mb-1 intel-mono">
                  <span>Level {levelInfo.level}</span>
                  <span>{levelInfo.coinsInLevel} / {levelInfo.coinsNeeded} Airstars</span>
                </div>
                <div className="h-2 bg-brand-200/50 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-brand-600 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${levelInfo.progress}%` }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                  />
                </div>
              </div>
            )}
          </motion.div>

          {/* Account facts an admin needs and the agent never sees on a card. */}
          <div className="bg-surface border border-slate-200 rounded-2xl p-4 mb-4 card-shadow">
            <div className="flex flex-wrap gap-1.5 mb-3">
              {agent.isAdmin   && <Flag tone="brand">Admin</Flag>}
              {agent.isBot     && <Flag tone="brand">Bot</Flag>}
              {agent.isTester  && <Flag tone="amber">Tester</Flag>}
              {agent.isBanned  && <Flag tone="red">Banned</Flag>}
              {agent.chatBannedAt && <Flag tone="red">Chat banned</Flag>}
              <Flag tone={agent.subscriptionTier === 'free' ? 'slate' : 'emerald'}>
                {agent.subscriptionTier}
              </Flag>
              <Flag>{agent.difficultySetting}</Flag>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div className="col-span-2 min-w-0">
                <dt className="text-slate-400">Email</dt>
                <dd className="font-semibold text-slate-700 truncate">{agent.email ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Joined</dt>
                <dd className="font-semibold text-slate-700">{fmtDate(agent.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Last online</dt>
                <dd className="font-semibold text-slate-700">{fmtDateTime(agent.lastSeen)}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-slate-400">Last CBAT session</dt>
                <dd className="font-semibold text-slate-700">{fmtDateTime(stats.lastCbatAt)}</dd>
              </div>
            </dl>
          </div>

          {/* Stats. The three that have a history page behind them are buttons,
              and say so — the same route Admin ▸ Users takes. */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            <StatTile label="Airstars" value={(agent.totalAirstars ?? 0).toLocaleString()} />
            <StatTile
              label="Briefs read"
              value={stats.briefsRead ?? 0}
              hint="Opens their brief history"
              onClick={() => navigate('/intel-brief-history', { state: historyState })}
            />
            <StatTile
              label="CBAT finished"
              value={`${stats.cbatFinished ?? 0}/${stats.cbatStarted ?? 0}`}
              hint="Finished out of started. Opens their CBAT history"
              onClick={() => navigate('/cbat-game-history', { state: historyState })}
            />
            <StatTile
              label="Other games"
              value={(stats.quizzesPlayed ?? 0) + (stats.booPlayed ?? 0) + (stats.wtaPlayed ?? 0)
                + (stats.wherePlayed ?? 0) + (stats.flashcardsPlayed ?? 0)}
              hint="Quiz, Order of Battle, Where's That Aircraft and flashcards"
              onClick={() => navigate('/game-history', { state: historyState })}
            />
          </div>

          <div className="flex flex-wrap gap-2 mb-5">
            <button
              type="button"
              onClick={() => navigate('/cbat-game-history', { state: historyState })}
              className="flex-1 min-w-[140px] px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors"
            >
              CBAT game history
            </button>
            <button
              type="button"
              onClick={() => setProgressOpen(true)}
              disabled={!(data?.cbatGames?.length)}
              className="flex-1 min-w-[140px] px-4 py-2.5 text-brand-600 hover:text-brand-700 border border-slate-200 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent font-bold rounded-xl text-sm transition-colors"
            >
              Score progress
            </button>
            <button
              type="button"
              onClick={() => navigate('/admin', { state: { tab: 'users' } })}
              className="flex-1 min-w-[140px] px-4 py-2.5 text-slate-600 hover:text-slate-700 border border-slate-200 hover:bg-slate-100 font-bold rounded-xl text-sm transition-colors"
            >
              Manage in Admin
            </button>
          </div>

          {/* Medals. Above the aircraft badges because a podium place is the
              rarer thing and the one that can be lost: a badge is kept forever
              once the brief is read, whereas these move the moment someone is
              overtaken. */}
          <div className="bg-surface border border-slate-200 rounded-2xl p-4 mb-4 card-shadow">
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Leaderboard medals</p>
              {medals.length > 0 && (
                <p className="text-xs font-bold text-slate-700">{medals.length}</p>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mb-3">
              Top three on an all time board right now. These are the same medals shown on their
              avatar in Community, and they are lost the moment someone overtakes them.
            </p>
            {medals.length === 0 ? (
              <p className="text-sm text-slate-400 py-3 text-center">
                Not in the top three on any all time board right now.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {medals.map(m => <MedalRow key={`${m.gameKey}-${m.rank}`} medal={m} />)}
              </div>
            )}
          </div>

          {/* Trophy cabinet */}
          <div className="bg-surface border border-slate-200 rounded-2xl p-4 mb-4 card-shadow">
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Aircraft badges</p>
              <p className="text-xs font-bold text-slate-700">
                {earned.length} <span className="text-slate-400 font-semibold">of {collectable}</span>
              </p>
            </div>
            <p className="text-[11px] text-slate-400 mb-3">
              One per Aircraft brief they have finished reading. The worn badge replaces their rank
              badge everywhere their avatar appears.
            </p>

            {collectable === 0 ? (
              <p className="text-sm text-slate-400 py-3 text-center">No aircraft badges exist yet.</p>
            ) : earned.length === 0 && !showAllBadges ? (
              <p className="text-sm text-slate-400 py-3 text-center">
                No badges collected yet.
              </p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {shownBadges.map(b => (
                  <BadgeTile
                    key={String(b.briefId)}
                    badge={b}
                    earned={earnedIds.has(String(b.briefId))}
                    wearing={String(agent.selectedBadge?.briefId ?? '') === String(b.briefId)}
                  />
                ))}
              </div>
            )}

            {locked.length > 0 && (
              <button
                type="button"
                onClick={() => setShowAllBadges(v => !v)}
                className="mt-3 text-xs font-bold text-brand-600 hover:text-brand-700"
              >
                {showAllBadges ? 'Hide the ones they have not collected' : `Show the ${locked.length} not collected`}
              </button>
            )}
            {data?.badges?.pendingCount > 0 && (
              <p className="text-[11px] text-slate-400 mt-2">
                {data.badges.pendingCount} Aircraft brief{data.badges.pendingCount === 1 ? '' : 's'} they
                have read {data.badges.pendingCount === 1 ? 'has' : 'have'} no cutout yet, so there is no
                badge to award for {data.badges.pendingCount === 1 ? 'it' : 'them'}.
              </p>
            )}
          </div>

          {/* Aptitude Report. The record below says how much CBAT they have sat; this says what it
              would be worth, which is the question an admin reading a support thread actually has.
              It is the same card the agent sees on /cbat, fetched for them and pointing at the
              report page's admin view of them, so what an admin reads here and what the agent
              reads on their own hub cannot drift apart. The wording switches to the third person:
              every line on the player's own card names a game for them to go and play, and an
              admin cannot play it for them. */}
          <div className="mb-4">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Aptitude report</p>
            <p className="text-[11px] text-slate-400 mb-2">
              What their practice would score against the role they are aiming for. Opens the full
              report as them.
            </p>
            <AptitudeReportCard userId={id} />
          </div>

          {/* CBAT record — the personal best on every game they have finished. */}
          <div className="bg-surface border border-slate-200 rounded-2xl p-4 card-shadow">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">CBAT record</p>
            <p className="text-[11px] text-slate-400 mb-3">
              Their best score on every test they have finished, most played first. The chip beside
              a name is where that score currently sits on the all time board, blank if it is
              outside the top 20.
            </p>
            {!data?.cbatGames?.length ? (
              <p className="text-sm text-slate-400 py-3 text-center">They have never finished a CBAT test.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.cbatGames.map(g => {
                  const cfg = CBAT_LEADERBOARD_CONFIG[g.gameKey] ?? {}
                  const format = cfg.formatScore ?? ((s) => `${s}`)
                  return (
                    <li key={g.gameKey} className="flex items-center gap-3 py-2">
                      <span className="text-base shrink-0" aria-hidden="true">{cfg.emoji ?? '🎯'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-slate-700 truncate flex items-center gap-1.5">
                          <span className="truncate">
                            {cfg.title ? cbatTitleWithDifficulty(g.gameKey, cfg.title) : g.label}
                          </span>
                          <BoardRankChip rank={g.boardRank} />
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {g.attempts} finished · last {fmtDate(g.lastPlayedAt)}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-extrabold text-slate-800">
                          {g.best == null ? '—' : format(g.best)}
                        </p>
                        <p className="text-[10px] text-slate-400">best</p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </>
      )}

      {progressOpen && agent && (
        <UserCbatProgressModal
          user={{ _id: agent._id, displayName: agent.displayName, email: agent.email }}
          API={API}
          apiFetch={apiFetch}
          onClose={() => setProgressOpen(false)}
        />
      )}
    </div>
  )
}
