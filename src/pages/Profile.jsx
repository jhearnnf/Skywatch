import { useState, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { useAppTutorial } from '../context/AppTutorialContext'
import TutorialModal from '../components/tutorial/TutorialModal'
import { MOCK_LEADERBOARD } from '../data/mockData'
import { getMasterVolume, setMasterVolume } from '../utils/sound'
import { refreshCbatMusicVolume } from '../utils/cbat/menuMusic'
import { refreshCommunityMusicVolume } from '../utils/communityMusic'
import { displayTier, isFreeUser } from '../utils/subscription'
import { getLevelInfo } from '../utils/levelUtils'
import { useAppSettings } from '../context/AppSettingsContext'
import ProfileBadge from '../components/ProfileBadge'
import CbatPassedBadge from '../components/CbatPassedBadge'
import SupporterBadge from '../components/SupporterBadge'
import SocialLinks from '../components/SocialLinks'
import AptitudeReportCard from '../components/AptitudeReportCard'
import CbatDateCard from '../components/CbatDateCard'
import SEO from '../components/SEO'
import { useSlimMode } from '../hooks/useSlimMode'
import { SLIM_APP } from '../utils/appMode'
import DeleteAccountModal from '../components/DeleteAccountModal'
import { getClientInfo } from '../utils/appVersion'
import { PLAY_STORE_URL, fetchLiveWebVersion, forceUpdateWebApp, isNativeUpdateAvailable, isWebUpdateAvailable } from '../utils/appUpdate'
import BlockedAgents from './chat/components/BlockedAgents'
import AppUpdateCover from '../components/AppUpdateCover'
import AdminToolPanel from '../components/AdminToolPanel'

const UPDATE_COVER_DISMISSED_KEY = 'skywatch:updateCoverDismissed'

/* Share / Support sit directly under the monochrome social SVGs, so they are
   drawn the same way rather than with emoji. The OS colour-emoji font renders
   at its own weight and baseline, which is what made the old 📤 / 💙 pair look
   pasted on next to the TikTok and X marks. */
function ShareIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 2.6l4.2 4.2-1.4 1.4-1.8-1.8V15h-2V6.4L9.2 8.2 7.8 6.8 12 2.6z"/>
      <path d="M4 13h2v5h12v-5h2v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6z"/>
    </svg>
  )
}

function HeartIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
    </svg>
  )
}

function StatCard({ label, value, icon, onClick, badge, badgeLabel = 'abandoned', loading }) {
  const Tag = onClick && !loading ? 'button' : 'div'
  return (
    <Tag
      onClick={loading ? undefined : onClick}
      aria-busy={loading || undefined}
      className={`relative flex flex-col items-center gap-1 bg-surface rounded-2xl p-3 border border-slate-200 card-shadow text-center
        ${onClick && !loading ? 'hover:border-brand-300 hover:bg-brand-50 transition-all cursor-pointer' : ''}`}
    >
      {loading ? (
        <>
          {/* Radar sweep shimmer across the card */}
          <span className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none">
            <span className="absolute -inset-y-2 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-brand-600/20 to-transparent stat-skeleton-sweep" />
          </span>
          <span className={`text-xl opacity-50 animate-pulse${icon === '⭐' ? ' star-silver' : ''}`}>{icon}</span>
          <span className="text-lg font-extrabold text-transparent bg-slate-700/30 rounded animate-pulse">0000</span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-transparent bg-slate-700/20 rounded animate-pulse">loading</span>
        </>
      ) : (
        <>
          {badge != null && badge > 0 && (
            <span className="absolute top-1.5 right-1.5 text-[9px] font-semibold text-slate-400 bg-slate-100 rounded-full px-1.5 py-0.5 leading-none pointer-events-none">
              {badge} {badgeLabel}
            </span>
          )}
          <span className={`text-xl${icon === '⭐' ? ' star-silver' : ''}`}>{icon}</span>
          <span className="text-lg font-extrabold text-slate-900">{value}</span>
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{label}</span>
        </>
      )}
    </Tag>
  )
}

const TUTORIAL_LABELS = [
  { key: 'home',            label: '🏠 Home',                       emoji: '🏠' },
  { key: 'learn-priority',  label: '📚 Learn',                      emoji: '📚' },
  { key: 'briefReader',     label: '📋 Brief Reader',               emoji: '📋' },
  { key: 'quiz',            label: '🎯 Intel Recall',               emoji: '🎯' },
  { key: 'play',            label: '🎮 Play Hub',                   emoji: '🎮' },
  { key: 'wheres_aircraft', label: "✈️ Where's That Aircraft",     emoji: '✈️' },
  { key: 'profile',         label: '👤 Profile',                    emoji: '👤' },
  { key: 'rankings',        label: '🏆 Progression',                emoji: '🏆' },
]

export default function Profile() {
  const { user, setUser, API, apiFetch, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const slim = useSlimMode()
  const { start, replay, resetAll } = useAppTutorial()

  const { levels: liveLevels, settings: appSettings, refreshSettings } = useAppSettings()
  const [stats,       setStats]       = useState({ brifsRead: 0, gamesPlayed: 0, abandonedGames: 0, winPercent: 0, flashcardsCollected: 0 })
  const [statsLoading, setStatsLoading] = useState(!!user)
  const [leaderboard, setLeaderboard] = useState(MOCK_LEADERBOARD)
  const [showDelete,  setShowDelete]  = useState(false)
  // Build stamp shown in the page footer. getClientInfo() resolves synchronously
  // on web (build-time stamp) and via a bridge round-trip on Android (the real
  // store versionName/versionCode), so both platforms show their true release.
  const [clientInfo,  setClientInfo]  = useState(null)
  // Newest native release the server has seen, used only to decide whether the
  // "Update app" link is worth showing. Stays null on web, which has no version
  // to compare against — it force-refreshes instead.
  const [latestRelease, setLatestRelease] = useState(null)
  const [updateBusy,  setUpdateBusy]  = useState(false)

  useEffect(() => {
    let alive = true
    getClientInfo().then((info) => { if (alive && info) setClientInfo(info) })
    return () => { alive = false }
  }, [])

  const [diffBusy,    setDiffBusy]    = useState(false)
  const [showcaseBusy, setShowcaseBusy] = useState(false)
  const [supporterBusy, setSupporterBusy] = useState(false)
  const [communityNotifsBusy, setCommunityNotifsBusy] = useState(false)
  const [nameEditing, setNameEditing] = useState(false)
  const [nameDraft,   setNameDraft]   = useState('')
  const [nameBusy,    setNameBusy]    = useState(false)
  const [nameError,   setNameError]   = useState('')
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  const [masterVol,   setMasterVol]   = useState(() => isIOS ? 100 : getMasterVolume())
  const [tab,         setTab]         = useState('overview') // 'overview' | 'leaderboard' | 'settings' | 'tutorials'
  const [namePulse,   setNamePulse]   = useState(false)
  const [resetDone,   setResetDone]   = useState(false)

  // Only ask on native. On web the answer is unusable (a commit sha has no
  // ordering) so the request would be pure waste on every profile visit.
  useEffect(() => {
    if (clientInfo?.platform !== 'android' && clientInfo?.platform !== 'ios') return
    let alive = true
    apiFetch(`${API}/api/users/latest-release`)
      .then(r => r.json())
      .then(d => { if (alive) setLatestRelease(d?.data?.latest ?? null) })
      .catch(() => { /* offline or endpoint down — just don't offer the link */ })
    return () => { alive = false }
  }, [clientInfo?.platform, API, apiFetch])

  // Web: the deploy that is live right now, from /version.json. Compared with
  // the bundle's own stamp to catch a service worker holding an old deploy.
  const [liveWeb, setLiveWeb] = useState(null)
  useEffect(() => {
    if (clientInfo?.platform !== 'web') return
    let alive = true
    fetchLiveWebVersion().then(v => { if (alive) setLiveWeb(v) })
    return () => { alive = false }
  }, [clientInfo?.platform])

  const isWeb = clientInfo?.platform === 'web'
  const updateAvailable = isWeb
    ? isWebUpdateAvailable(clientInfo, liveWeb)
    : isNativeUpdateAvailable(clientInfo, latestRelease)
  // Newest release for this platform, whichever source it came from.
  const newestRelease = isWeb ? liveWeb : latestRelease?.[clientInfo?.platform]
  // Admin-only ?previewUpdate=web|android shows that platform's update cover on
  // any device, so both can be checked without an out-of-date build to hand.
  // Only while the switch below is on: off means the cover does nothing,
  // preview included (the Preview links pulse the switch instead).
  const previewParam = new URLSearchParams(location.search).get('previewUpdate')
  const previewPlatform = user?.isAdmin && (previewParam === 'web' || previewParam === 'android')
    ? previewParam : null
  const wantsUpdatePreview = previewPlatform !== null

  // "Not now" on the cover lasts for this app session and for this release
  // only: the build it was dismissed for is remembered, so a newer release
  // puts the cover back. The footer keeps the update control meanwhile.
  const newestBuild = newestRelease?.build ?? null
  const [dismissedBuild, setDismissedBuild] = useState(() => {
    try { return sessionStorage.getItem(UPDATE_COVER_DISMISSED_KEY) } catch { return null }
  })
  const coverDismissed = newestBuild !== null && String(newestBuild) === dismissedBuild
  // Admin switch (AppSettings.updateCoverEnabled), off until the new release is
  // live on both the web and Google Play. Off means only the footer control.
  const updateCoverOn = appSettings?.updateCoverEnabled === true
  const previewUpdateCover = wantsUpdatePreview && updateCoverOn
  const [coverTogglePulse, setCoverTogglePulse] = useState(false)
  const pulseCoverToggle = () => {
    setCoverTogglePulse(false)
    // Next frame, so a second tap mid-pulse restarts the animation.
    requestAnimationFrame(() => setCoverTogglePulse(true))
    setTimeout(() => setCoverTogglePulse(false), 1300)
  }
  const [coverToggleBusy, setCoverToggleBusy] = useState(false)
  const [coverToggleError, setCoverToggleError] = useState('')
  const toggleUpdateCover = async () => {
    if (coverToggleBusy) return
    setCoverToggleBusy(true); setCoverToggleError('')
    try {
      const res = await apiFetch(`${API}/api/admin/settings`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updateCoverEnabled: !updateCoverOn,
          reason: `${updateCoverOn ? 'Disable' : 'Enable'} the update screen for all users`,
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || 'Could not save')
      await refreshSettings?.()
    } catch (err) {
      setCoverToggleError(err.message || 'Could not save')
    } finally {
      setCoverToggleBusy(false)
    }
  }
  const dismissUpdateCover = () => {
    if (previewUpdateCover) { navigate('/profile'); return }
    const build = String(newestBuild)
    try { sessionStorage.setItem(UPDATE_COVER_DISMISSED_KEY, build) } catch { /* storage blocked */ }
    setDismissedBuild(build)
  }

  // No finally/reset: forceUpdateWebApp ends by replacing the document, so the
  // busy state is torn down with the page. Resetting it would only matter if
  // the reload silently failed, and leaving the button disabled is the right
  // outcome there anyway — a second press would do no more than the first.
  const runForceUpdate = () => {
    setUpdateBusy(true)
    forceUpdateWebApp().catch(() => setUpdateBusy(false))
  }

  // Tapping the agent name in the header jumps to Settings and briefly pulses
  // the Display Name card so the "Change" control is easy to find.
  const goToNameSettings = () => {
    setTab('settings')
    setNamePulse(true)
    setTimeout(() => setNamePulse(false), 1300)
  }

  // Tutorial on first visit
  useEffect(() => {
    const t = setTimeout(() => start('profile'), 600)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    apiFetch(`${API}/api/users/settings`).then(r => r.json())
      .then(settingsData => {
        const useLive = settingsData?.data?.useLiveLeaderboard ?? false
        if (useLive) {
          return apiFetch(`${API}/api/users/leaderboard`)
            .then(r => r.json())
            .then(lbData => setLeaderboard(lbData?.data?.agents ?? []))
        } else if (user?.agentNumber) {
          // Inject current user into mock leaderboard at correct position
          const mock = MOCK_LEADERBOARD.filter(a => a.agentNumber !== user.agentNumber)
          mock.push({ agentNumber: user.agentNumber, totalAirstars: user.totalAirstars ?? 0 })
          mock.sort((a, b) => b.totalAirstars - a.totalAirstars)
          setLeaderboard(mock)
        }
      })
      .catch(() => {})
  }, [API, user?.agentNumber, user?.totalAirstars])

  useEffect(() => {
    if (!user) { setStats({ brifsRead: 0, gamesPlayed: 0, abandonedGames: 0, winPercent: 0 }); setStatsLoading(false); return }
    setStatsLoading(true)
    apiFetch(`${API}/api/users/stats`)
      .then(r => r.json())
      .then(data => {
        if (data?.data) setStats({
          brifsRead:           data.data.brifsRead           ?? 0,
          gamesPlayed:         data.data.gamesPlayed         ?? 0,
          abandonedGames:      data.data.abandonedGames      ?? 0,
          winPercent:          data.data.winPercent          ?? 0,
          flashcardsCollected: data.data.flashcardsCollected ?? 0,
        })
      })
      .catch(() => {})
      .finally(() => setStatsLoading(false))
  }, [API, user])

  const COOLDOWN_DAYS = 30
  const COOLDOWN_MS   = COOLDOWN_DAYS * 24 * 60 * 60 * 1000
  const nameChangedAt  = user?.displayNameChangedAt ? new Date(user.displayNameChangedAt).getTime() : null
  const nameCooldownMs = nameChangedAt ? Math.max(0, COOLDOWN_MS - (Date.now() - nameChangedAt)) : 0
  const nameCooldownDays = Math.ceil(nameCooldownMs / (24 * 60 * 60 * 1000))
  const nameOnCooldown   = nameCooldownMs > 0

  const startNameEdit = () => {
    setNameDraft(user?.displayName ?? '')
    setNameError('')
    setNameEditing(true)
  }
  const cancelNameEdit = () => {
    setNameEditing(false)
    setNameError('')
    setNameDraft('')
  }
  const saveDisplayName = async (clear = false) => {
    if (nameBusy || nameOnCooldown) return
    setNameBusy(true)
    setNameError('')
    try {
      const body = clear ? { displayName: null } : { displayName: nameDraft.trim() }
      const res = await apiFetch(`${API}/api/users/me/display-name`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setNameError(data?.message || 'Could not update display name')
        return
      }
      if (data?.data?.user) setUser(data.data.user)
      setNameEditing(false)
      setNameDraft('')
    } catch {
      setNameError('Network error — please try again')
    } finally {
      setNameBusy(false)
    }
  }

  const changeDifficulty = async (d) => {
    if (diffBusy || d === user?.difficultySetting) return
    setDiffBusy(true)
    try {
      const res  = await apiFetch(`${API}/api/users/me/difficulty`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ difficulty: d }),
      })
      const data = await res.json()
      if (data?.data?.user) setUser(data.data.user)
    } catch { /* non-fatal */ }
    finally { setDiffBusy(false) }
  }

  // Opt in or out of score sharing: the landing page's progress wall AND the
  // scores on their player profile. Stored server-side as one objection
  // (hideFromShowcase), so `visible` is its inverse — see
  // backend/utils/cbatShowcase.js and GET /api/users/:id/profile.
  const showcaseVisible = !(user?.hideFromShowcase ?? false)
  const changeShowcase = async (visible) => {
    if (showcaseBusy || visible === showcaseVisible) return
    setShowcaseBusy(true)
    try {
      const res = await apiFetch(`${API}/api/users/me/showcase`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visible }),
      })
      const data = await res.json()
      if (data?.data?.user) setUser(data.data.user)
    } catch { /* non-fatal */ }
    finally { setShowcaseBusy(false) }
  }

  // Wear or hide the Supporter mark. Its own switch, not part of Score Sharing:
  // that one promises the name and badge still show, and giving is an identity
  // fact rather than a score. Stored as the objection (hideSupporterBadge), so
  // `visible` is its inverse and every existing donor wears it by default.
  const supporterVisible = Boolean(user?.supporter)
  const changeSupporter = async (visible) => {
    if (supporterBusy || visible === supporterVisible) return
    setSupporterBusy(true)
    try {
      const res = await apiFetch(`${API}/api/users/me/supporter-badge`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visible }),
      })
      const data = await res.json()
      if (data?.data?.user) setUser(data.data.user)
    } catch { /* non-fatal */ }
    finally { setSupporterBusy(false) }
  }

  // Community notification dot. Stored as "enabled" server-side, so an absent
  // field reads as on and needs no backfill.
  const communityNotifs = user?.communityNotificationsEnabled !== false
  const changeCommunityNotifs = async (enabled) => {
    if (communityNotifsBusy || enabled === communityNotifs) return
    setCommunityNotifsBusy(true)
    try {
      const res = await apiFetch(`${API}/api/users/me/community-notifications`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      const data = await res.json()
      if (data?.data?.user) setUser(data.data.user)
    } catch { /* non-fatal */ }
    finally { setCommunityNotifsBusy(false) }
  }

  const cycleCoins = user?.cycleAirstars ?? 0   // drives XP bar (resets per rank cycle)
  const totalCoins = user?.totalAirstars ?? 0   // lifetime total — shown in stats grid
  const levelInfo  = getLevelInfo(cycleCoins, liveLevels)
  const rankDisplay = user?.rank && typeof user.rank === 'object' && user.rank.rankName
    ? `${user.rank.rankName} (${user.rank.rankAbbreviation})`
    : 'Unranked'

  // Profile's admin tools, in the floating panel. Rendered over the update
  // cover too, so the switch can be turned off straight from a preview.
  const adminTools = user?.isAdmin ? (
    <AdminToolPanel title="Profile">
      <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Update screen</p>
      <div className="flex flex-col items-start">
        {[['web', 'Preview update for web'], ['android', 'Preview update for Android']].map(([platform, label]) => (
          <Link
            key={platform}
            to={`/profile?previewUpdate=${platform}`}
            onClick={(e) => { if (!updateCoverOn) { e.preventDefault(); pulseCoverToggle() } }}
            className="text-xs font-semibold text-brand-600 hover:text-brand-700 py-1"
          >
            {label}
          </Link>
        ))}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={updateCoverOn}
        aria-label="Show update screen to all users"
        onClick={toggleUpdateCover}
        disabled={coverToggleBusy}
        className={`w-full inline-flex items-center gap-2 py-1.5 px-2 -mx-2 disabled:opacity-50 group${coverTogglePulse ? ' flashcard-ring-active' : ''}`}
      >
        <span
          aria-hidden="true"
          className={`relative shrink-0 w-8 h-4 rounded-full transition-colors ${updateCoverOn ? 'bg-brand-600' : 'bg-slate-300'}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full transition-transform
              ${updateCoverOn ? 'translate-x-4 bg-white' : 'bg-slate-500'}`}
          />
        </span>
        <span className="text-xs font-semibold text-slate-600 group-hover:text-slate-800 text-left">
          For all users: {updateCoverOn ? 'On' : 'Off'}
        </span>
      </button>
      <p className="text-[11px] text-slate-500">
        Turn on once the new version is live on the web and on Google Play.
      </p>
      {coverToggleError && (
        <p className="text-[11px] text-rose-600 font-semibold">{coverToggleError}</p>
      )}
    </AdminToolPanel>
  ) : null

  // An out-of-date store build gets the whole Profile area replaced by the
  // update prompt, not just the small link in the footer.
  if ((updateAvailable && updateCoverOn && !coverDismissed) || previewUpdateCover) {
    return (
      <>
      <SEO title="Profile" description="View your SkyWatch learning stats, level, and streak." />
      <AppUpdateCover
        platform={previewUpdateCover ? previewPlatform : clientInfo?.platform}
        onWebUpdate={runForceUpdate}
        webUpdateBusy={updateBusy}
        {...(previewUpdateCover && previewPlatform !== clientInfo?.platform
          // Previewing the other platform: this device's versions would be the
          // wrong kind of number, so leave the version line out.
          ? {}
          : {
              currentVersion: clientInfo?.version,
              latestVersion:  newestRelease?.version,
              currentBuild:   clientInfo?.build,
              latestBuild:    newestRelease?.build,
            })}
        preview={previewUpdateCover}
        onDismiss={dismissUpdateCover}
      />
      {adminTools}
      </>
    )
  }

  return (
    <>
    <SEO title="Profile" description="View your SkyWatch learning stats, level, and streak." />
    <TutorialModal />
    <div className="max-w-lg mx-auto">

      {/* User card */}
      {user ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl p-5 mb-5 card-shadow border border-brand-300/40"
          style={{ background: 'linear-gradient(135deg, #0f2850 0%, #081930 100%)' }}
        >
          <div className="flex items-center gap-4">
            {/* Avatar — tap to change badge */}
            <button
              type="button"
              onClick={() => navigate('/profile/badge')}
              aria-label="Change profile badge"
              className="w-14 h-14 rounded-2xl bg-brand-200/60 border-2 border-brand-400/50 flex items-center justify-center shrink-0 hover:border-brand-600/80 transition-colors"
            >
              <ProfileBadge user={user} size={user?.selectedBadge?.cutoutUrl ? 48 : 38} />
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 max-w-full">
                <button
                  type="button"
                  onClick={goToNameSettings}
                  title="Change your display name"
                  className="block min-w-0 font-extrabold text-lg text-slate-800 leading-tight truncate text-left hover:text-brand-700 transition-colors"
                >
                  {user.displayName || `Agent #${user.agentNumber ?? '———'}`}
                </button>
                {user?.cbatPassed && <CbatPassedBadge />}
                {user?.supporter && <SupporterBadge />}
              </div>
              {!slim && <p className="text-slate-600 text-sm">{rankDisplay}</p>}
              {user.displayName && (
                <p className="text-slate-500 text-xs mt-0.5 intel-mono">#{user.agentNumber ?? '———'}</p>
              )}
              {/* The page other players open from a leaderboard or chat: best
                  scores and medals. Linked here so you can see exactly what
                  they see, instead of a copy of it embedded under a tab. */}
              <Link to={`/agent/${user._id}`} className="inline-block mt-1.5 text-xs font-bold text-brand-600 hover:text-brand-700 transition-colors">
                View public profile →
              </Link>
            </div>
            {!slim && (
              <div className="text-right shrink-0">
                <p className="text-xs text-slate-500 intel-mono">Streak</p>
                <p className="text-2xl font-extrabold text-brand-700">{user.loginStreak ?? 0}</p>
                <p className="text-lg flame-blue">🔥</p>
              </div>
            )}
          </div>

          {/* XP bar */}
          {!slim && levelInfo && (
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
      ) : (
        <div className="bg-surface rounded-2xl border border-slate-200 p-6 mb-5 text-center card-shadow">
          <div className="text-4xl mb-3">🔒</div>
          <p className="font-bold text-slate-800 mb-1">Sign in to view your profile</p>
          <p className="text-sm text-slate-500 mb-4">Track progress, earn Airstars, and climb the ranks.</p>
          <Link to="/login" className="inline-flex px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors">
            Sign In
          </Link>
        </div>
      )}

      {/* Test date + private same-date group. Above the tabs on purpose: it
          is the one thing on this page we want a new account to do, and a
          tab is where it went unnoticed before. Hides itself once done. */}
      {user && <CbatDateCard />}

      {/* Tabs. Three for most people: Overview is what you have done and where
          you are heading, Settings is every switch, Help is help. Ranks (the
          Airstars board) only exists outside slim mode. The public profile is
          a link in the header now, not a tab: it is a real page others see. */}
      <div className="flex gap-2 mb-4">
        {[
          { key: 'overview',    label: 'Overview' },
          { key: 'leaderboard', label: 'Ranks' },
          { key: 'settings',    label: 'Settings' },
          { key: 'tutorials',   label: 'Help' },
        ].filter(t => !(slim && t.key === 'leaderboard')).map(t => (
          <button
            key={t.key}
            data-tutorial-target={t.key === 'settings' ? 'profile-tab-settings' : undefined}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all
              ${tab === t.key ? 'bg-brand-600 text-white' : 'bg-surface border border-slate-200 text-slate-500 hover:border-brand-300'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview tab: what you have done (tiles) and where you are heading
          (Aptitude Report). Share / Support live at the foot with the social
          icons: they are about the site, not about you, and not help. */}
      {tab === 'overview' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <div className={`grid ${slim ? 'grid-cols-1' : 'grid-cols-2'} gap-3 ${!user ? 'opacity-40 pointer-events-none select-none blur-sm' : ''}`}>
            {!slim && <StatCard loading={user && statsLoading} label="Briefs Read"  value={stats.brifsRead}           icon="📋" onClick={user ? () => navigate('/intel-brief-history') : undefined} badge={stats.flashcardsCollected} badgeLabel="flashcards" />}
            <StatCard loading={user && statsLoading} label="Games Played" value={stats.gamesPlayed} icon="🎯" badge={stats.abandonedGames} onClick={user && !slim ? () => navigate('/game-history') : undefined} />
            {!slim && <StatCard loading={user && statsLoading} label="Avg Score"    value={`${stats.winPercent}%`}    icon="✓"  onClick={user ? () => navigate('/game-history') : undefined} />}
            {!slim && <StatCard loading={user && statsLoading} label="Airstars"     value={totalCoins.toLocaleString()} icon="⭐" onClick={user ? () => navigate('/airstar-history') : undefined} />}
          </div>
          {/* Aptitude Report — the one stat here that's about where the user is HEADING rather
              than what they've done. Below the tiles because it's a bigger read than a number. */}
          {user && (
            <div className="mt-6">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Selection Readiness</p>
              <AptitudeReportCard />
            </div>
          )}
          <SocialLinks source="profile" className="mt-6 pt-4 border-t border-slate-200" />
          <div className="mt-3 flex items-center justify-center gap-4 text-xs font-semibold text-slate-500">
            <Link to="/share" className="inline-flex items-center gap-1.5 hover:text-slate-700 transition-colors">
              <ShareIcon className="w-3.5 h-3.5" />
              Share SkyWatch
            </Link>
            {/* Never in the native app: Google Play forbids off-store payment
                links, so /donate is web-only everywhere (see Donate.jsx). */}
            {!SLIM_APP && (
              <Link to="/donate" data-testid="profile-help-donate" className="inline-flex items-center gap-1.5 hover:text-slate-700 transition-colors">
                <HeartIcon className="w-3.5 h-3.5" />
                Support SkyWatch
              </Link>
            )}
          </div>
        </motion.div>
      )}

      {/* Settings tab. Grouped by what the switch is about, most-touched
          first. Each card keeps its own heading; the group labels only say
          which shelf it sits on. Sign out and Delete account close the tab so
          they are not on screen while someone is looking at their stats. */}
      {tab === 'settings' && user && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <p className="text-[10px] font-extrabold text-brand-600 uppercase tracking-[0.2em]">Account</p>
          {/* Display Name */}
          <div className={`bg-surface rounded-2xl border border-slate-200 p-4 card-shadow${namePulse ? ' flashcard-ring-active' : ''}`}>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Display Name</p>

            {!nameEditing ? (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  {user.displayName ? (
                    <p className="text-sm font-bold text-slate-700 truncate">{user.displayName}</p>
                  ) : (
                    <p className="text-sm text-slate-400 italic">Set a display name</p>
                  )}
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Shown on leaderboards and your profile.
                  </p>
                </div>
                <button
                  onClick={startNameEdit}
                  disabled={nameOnCooldown}
                  className={`text-xs font-bold px-3 py-1.5 rounded-xl shrink-0 transition-colors
                    ${nameOnCooldown
                      ? 'bg-slate-50 border border-slate-200 text-slate-400 cursor-not-allowed'
                      : 'bg-brand-50 text-brand-700 hover:bg-brand-100'
                    }`}
                  title={nameOnCooldown ? `Available in ${nameCooldownDays} day${nameCooldownDays === 1 ? '' : 's'}` : undefined}
                >
                  {user.displayName ? 'Change' : 'Set'}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  type="text"
                  value={nameDraft}
                  onChange={e => { setNameDraft(e.target.value); if (nameError) setNameError('') }}
                  maxLength={20}
                  placeholder="3–20 chars · letters, numbers, _ and -"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-700 focus:outline-none focus:border-brand-400"
                  autoFocus
                  disabled={nameBusy}
                />
                {nameError && (
                  <p className="text-xs text-rose-600 font-semibold">{nameError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => saveDisplayName(false)}
                    disabled={nameBusy || !nameDraft.trim()}
                    className="flex-1 py-2 rounded-xl text-sm font-bold bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {nameBusy ? 'Saving…' : 'Save'}
                  </button>
                  {user.displayName && (
                    <button
                      onClick={() => saveDisplayName(true)}
                      disabled={nameBusy}
                      className="py-2 px-3 rounded-xl text-sm font-bold bg-slate-50 border border-slate-200 text-slate-500 hover:border-rose-300 hover:text-rose-600 disabled:opacity-50 transition-colors"
                    >
                      Clear
                    </button>
                  )}
                  <button
                    onClick={cancelNameEdit}
                    disabled={nameBusy}
                    className="py-2 px-3 rounded-xl text-sm font-bold bg-slate-50 border border-slate-200 text-slate-500 hover:border-brand-300 disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {nameOnCooldown && !nameEditing && (
              <p className="text-[11px] text-slate-400 mt-2">
                Next change available in {nameCooldownDays} day{nameCooldownDays === 1 ? '' : 's'}.
              </p>
            )}
            {!nameOnCooldown && user.displayName && !nameEditing && (
              <p className="text-[11px] text-slate-400 mt-2">
                You can change your name once every {COOLDOWN_DAYS} days.
              </p>
            )}
          </div>

          {/* Subscription — hidden in slim (native) mode and while beta tester auto-gold is active */}
          {!slim && !appSettings?.betaTesterAutoGold && (() => {
            const tier        = user.subscriptionTier ?? 'free'
            const isGold      = tier === 'gold'
            const isSilver    = tier === 'silver'
            const isActiveTrial = tier === 'trial' && user.isTrialActive
            const hasPaidPerks  = isGold || isSilver || isActiveTrial
            const icon = isGold ? '🥇' : (isSilver || isActiveTrial) ? '🥈' : '🆓'
            const badgeClass = isGold
              ? 'bg-amber-100 text-amber-700 group-hover:bg-amber-200'
              : (isSilver || isActiveTrial)
                ? 'bg-brand-100 text-brand-700 group-hover:bg-brand-200'
                : 'bg-slate-100 text-slate-600 group-hover:bg-brand-100 group-hover:text-brand-700'
            return (
              <div className="bg-surface rounded-2xl border border-slate-200 p-4 card-shadow">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Subscription</p>
                <Link
                  to="/subscribe"
                  className="flex items-center justify-between hover:bg-slate-50 rounded-xl px-1 py-1 -mx-1 transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{icon}</span>
                    <div>
                      <p className="text-sm font-semibold text-slate-700">Current Plan</p>
                      <p className="text-xs text-slate-400">{displayTier(user)}</p>
                    </div>
                  </div>
                  <span className={`text-xs font-bold px-3 py-1.5 rounded-xl transition-colors ${badgeClass}`}>
                    {hasPaidPerks ? 'Manage →' : 'Upgrade →'}
                  </span>
                </Link>
              </div>
            )
          })()}
          <p className="text-[10px] font-extrabold text-brand-600 uppercase tracking-[0.2em] pt-2">Sound</p>
          {/* Volume */}
          <div className={`bg-surface rounded-2xl border border-slate-200 p-4 card-shadow${isIOS ? ' opacity-50' : ''}`}>
            <div className="flex justify-between items-center mb-3">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">SkyWatch Volume</p>
              {isIOS
                ? <span className="text-xs text-slate-400">Use device buttons</span>
                : <span className="text-sm font-bold text-brand-600">{masterVol}%</span>
              }
            </div>
            <input
              type="range"
              className="w-full accent-brand-500 cursor-pointer disabled:cursor-not-allowed"
              min={0} max={100}
              value={masterVol}
              disabled={isIOS}
              onChange={e => {
                const v = Number(e.target.value)
                setMasterVol(v)
                setMasterVolume(v)
                // Menu music is playing on this page — apply the new level live
                // instead of only on the next navigation.
                refreshCbatMusicVolume()
                // Community has its own bed; it obeys the same master volume.
                refreshCommunityMusicVolume()
              }}
              aria-label="App volume"
            />
            <div className="flex justify-between text-[10px] text-slate-400 mt-1">
              {isIOS
                ? <span className="w-full text-center">Volume is controlled by your device buttons on iOS</span>
                : <><span>Mute</span><span>Max</span></>
              }
            </div>
          </div>

          <p className="text-[10px] font-extrabold text-brand-600 uppercase tracking-[0.2em] pt-2">Community and privacy</p>
          {/* Score sharing — one opt-out for every place their scores are shown
              to anyone else: the leaderboards, the Recent Scores feed, the
              medals, their player profile and the landing page's progress wall
              (backend/utils/cbatScoreSharing.js). Worded so the choice can be
              made without reading a policy: it says exactly where scores appear
              and exactly what does not (name, dates on the homepage). Shown on
              native too, since all of it renders in the app. */}
          <div className="bg-surface rounded-2xl border border-slate-200 p-4 card-shadow">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Score Sharing</p>
            <p className="text-[11px] text-slate-400 mb-3">
              Other signed-in players can see your scores on the leaderboards, in the recent scores
              feed and on your player profile, which opens from your name in chat or in that feed.
              A top three score on any all time board also earns a medal shown next to your name.
              We also sometimes show a player's score progress on the SkyWatch homepage as an
              example of how practice pays off. On the homepage you appear as your agent number only,
              never your display name, and never the date or time you played.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => changeShowcase(true)}
                disabled={showcaseBusy}
                className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all
                  ${showcaseVisible
                    ? 'bg-brand-600 text-white'
                    : 'bg-slate-50 border border-slate-200 text-slate-500 hover:border-brand-300'
                  }`}
              >
                📈 Include me
              </button>
              <button
                onClick={() => changeShowcase(false)}
                disabled={showcaseBusy}
                className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all
                  ${!showcaseVisible
                    ? 'bg-brand-600 text-white'
                    : 'bg-slate-50 border border-slate-200 text-slate-500 hover:border-brand-300'
                  }`}
              >
                🚫 Leave me out
              </button>
            </div>
            {!showcaseVisible && (
              <p className="text-[11px] text-slate-400 mt-2">
                Your scores will not appear on the leaderboards, in the recent scores feed, on your
                player profile or on the homepage, and you will not hold any medals. You can still
                see your own best and where it would rank. This takes effect straight away.
              </p>
            )}
          </div>

          {/* Supporter badge. Only offered to someone who has donated: a switch
              for a badge you have not earned is noise, and 99% of accounts
              would otherwise see a dead setting. */}
          {user?.hasDonated && (
            <div data-testid="supporter-badge-setting" className="bg-surface rounded-2xl border border-slate-200 p-4 card-shadow">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Supporter Badge</p>
              <p className="text-[11px] text-slate-400 mb-3">
                Thank you for donating. A Supporter badge is shown next to your name in chat, on the
                leaderboards and on your player profile. Other signed-in players can see it. You can
                hide it here at any time.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => changeSupporter(true)}
                  disabled={supporterBusy}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all
                    ${supporterVisible
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-50 border border-slate-200 text-slate-500 hover:border-brand-300'
                    }`}
                >
                  🏅 Show my badge
                </button>
                <button
                  onClick={() => changeSupporter(false)}
                  disabled={supporterBusy}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all
                    ${!supporterVisible
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-50 border border-slate-200 text-slate-500 hover:border-brand-300'
                    }`}
                >
                  🚫 Hide my badge
                </button>
              </div>
              {!supporterVisible && (
                <p className="text-[11px] text-slate-400 mt-2">
                  Your Supporter badge is hidden everywhere. This takes effect straight away.
                </p>
              )}
            </div>
          )}

          {/* Community notifications — the opt-out for the navbar unread dot. */}
          {appSettings?.chatEnabled !== false && (
            <div className="bg-surface rounded-2xl border border-slate-200 p-4 card-shadow">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Community Notifications</p>
              <p className="text-[11px] text-slate-400 mb-3">
                Show a red dot on the Community button when there are new messages in a channel or
                a direct message.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => changeCommunityNotifs(true)}
                  disabled={communityNotifsBusy}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all
                    ${communityNotifs
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-50 border border-slate-200 text-slate-500 hover:border-brand-300'
                    }`}
                >
                  🔔 Notify me
                </button>
                <button
                  onClick={() => changeCommunityNotifs(false)}
                  disabled={communityNotifsBusy}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all
                    ${!communityNotifs
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-50 border border-slate-200 text-slate-500 hover:border-brand-300'
                    }`}
                >
                  🔕 Turn off
                </button>
              </div>
              {!communityNotifs && (
                <p className="text-[11px] text-slate-400 mt-2">
                  The dot is off. Community still works normally and any new messages are waiting
                  for you when you open it.
                </p>
              )}
            </div>
          )}

          {/* The undo for a block. Sits next to the other Community setting
              rather than inside Community itself, because blocking someone
              removes their messages from the very place you would look for
              them. See BlockedAgents. */}
          {appSettings?.chatEnabled !== false && <BlockedAgents />}

          {!slim && (<>
          <p className="text-[10px] font-extrabold text-brand-600 uppercase tracking-[0.2em] pt-2">Learning</p>
          {/* Difficulty */}
          <div data-tutorial-target="profile-difficulty" className="bg-surface rounded-2xl border border-slate-200 p-4 card-shadow">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Recall Difficulty</p>
            <div className="flex gap-2">
              {/* Standard — always available */}
              <button
                onClick={() => changeDifficulty('easy')}
                disabled={diffBusy}
                className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all
                  ${(user.difficultySetting ?? 'easy') === 'easy'
                    ? 'bg-brand-600 text-white'
                    : 'bg-slate-50 border border-slate-200 text-slate-500 hover:border-brand-300'
                  }`}
              >
                🌱 Standard
              </button>

              {/* Advanced — locked for free users */}
              {isFreeUser(user) ? (
                <button
                  onClick={() => navigate('/subscribe')}
                  title="Upgrade to Silver to unlock Advanced difficulty"
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-slate-50 border border-slate-200 text-slate-400 opacity-60 hover:opacity-80 transition-opacity"
                >
                  🔒 Advanced
                </button>
              ) : (
                <button
                  onClick={() => changeDifficulty('medium')}
                  disabled={diffBusy}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all
                    ${(user.difficultySetting ?? 'easy') === 'medium'
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-50 border border-slate-200 text-slate-500 hover:border-brand-300'
                    }`}
                >
                  <span className="flame-blue">🔥</span> Advanced
                </button>
              )}
            </div>
            {isFreeUser(user) && (
              <p className="text-xs text-slate-400 mt-2">
                <button onClick={() => navigate('/subscribe')} className="text-brand-500 font-semibold hover:underline">
                  Upgrade to Silver
                </button>{' '}to unlock Advanced difficulty.
              </p>
            )}
          </div>

          </>)}
          <p className="text-[10px] font-extrabold text-brand-600 uppercase tracking-[0.2em] pt-2">Account actions</p>
          <div className="bg-surface rounded-2xl border border-slate-200 card-shadow overflow-hidden divide-y divide-slate-100">
            <button
              onClick={logout}
              className="w-full text-left px-4 py-3 text-sm font-semibold text-slate-500 hover:text-slate-700 transition-colors"
            >
              Sign out
            </button>
            {/* Kept in slim mode too: Google Play requires the in-app deletion
                path to exist in the shipped native app, which is slim-only. */}
            <button
              onClick={() => setShowDelete(true)}
              className="w-full text-left px-4 py-3 text-sm font-semibold text-slate-500 hover:text-red-700 transition-colors"
            >
              Delete account
            </button>
          </div>
        </motion.div>
      )}

      {/* Settings tab — signed-out state */}
      {tab === 'settings' && !user && (
        <div className="bg-surface rounded-2xl border border-slate-200 p-6 text-center card-shadow">
          <p className="text-sm text-slate-500">Sign in to adjust your settings.</p>
        </div>
      )}

      {/* Leaderboard tab */}
      {tab === 'leaderboard' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-surface rounded-2xl border border-slate-200 card-shadow overflow-hidden">
          <div className="p-4 border-b border-slate-100">
            <p className="font-bold text-slate-800 text-sm">Top Agents — Airstars</p>
          </div>
          <ol className="divide-y divide-slate-100">
            {leaderboard.map((agent, i) => {
              const pos = i + 1
              const isCurrent = user?.agentNumber === agent.agentNumber
              return (
                <li
                  key={agent.agentNumber}
                  className={`flex items-center gap-3 px-4 py-3 ${isCurrent ? 'bg-brand-50' : ''}`}
                >
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-extrabold shrink-0
                    ${pos === 1 ? 'bg-amber-400 text-white' : pos === 2 ? 'bg-slate-300 text-white' : pos === 3 ? 'bg-amber-700 text-white' : 'bg-slate-100 text-slate-500'}`}>
                    {pos}
                  </span>
                  <span className={`flex-1 text-sm font-semibold ${isCurrent ? 'text-brand-700' : 'text-slate-800'}`}>
                    {agent.displayName || `Agent ${agent.agentNumber}`} {isCurrent && <span className="text-xs text-brand-500">(You)</span>}
                  </span>
                  <span className="text-sm font-bold text-white"><span className="star-silver">⭐</span> {agent.totalAirstars.toLocaleString()}</span>
                </li>
              )
            })}
            {leaderboard.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-slate-400">No agents yet</li>
            )}
            {/* Pinned "you" row — shown when the signed-in user isn't in the visible list */}
            {user?.agentNumber && !leaderboard.some(a => a.agentNumber === user.agentNumber) && (
              <>
                <li className="px-4 py-1.5 flex items-center gap-3">
                  <span className="w-7 shrink-0" />
                  <span className="text-slate-300 text-lg leading-none tracking-tighter">•••</span>
                </li>
                <li className="flex items-center gap-3 px-4 py-3 bg-brand-50">
                  <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-extrabold shrink-0 bg-slate-100 text-slate-500">
                    —
                  </span>
                  <span className="flex-1 text-sm font-semibold text-brand-700">
                    {user.displayName || `Agent ${user.agentNumber}`} <span className="text-xs text-brand-500">(You)</span>
                  </span>
                  <span className="text-sm font-bold text-white"><span className="star-silver">⭐</span> {(user.totalAirstars ?? 0).toLocaleString()}</span>
                </li>
              </>
            )}
          </ol>
        </motion.div>
      )}

      {/* Help tab: report a problem, and the tutorials. */}
      {tab === 'tutorials' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
          <div className="bg-surface rounded-2xl border border-slate-200 card-shadow overflow-hidden divide-y divide-slate-100">
            <Link to="/report" className="flex items-center justify-between px-4 py-3 text-sm font-semibold text-slate-500 hover:text-slate-700 transition-colors">
              <span>⚠️ Report a Problem</span>
              <span className="text-slate-400">→</span>
            </Link>
          </div>
          {!slim && (<>
          <p className="text-sm text-slate-500 mb-1">Replay any tutorial to revisit how a feature works.</p>
          <div className="bg-surface rounded-2xl border border-slate-200 card-shadow overflow-hidden">
            {TUTORIAL_LABELS.map((tut, i) => (
              <div
                key={tut.key}
                className={`flex items-center gap-3 px-4 py-3 ${i < TUTORIAL_LABELS.length - 1 ? 'border-b border-slate-100' : ''}`}
              >
                <span className="text-xl w-7 text-center">{tut.emoji}</span>
                <span className="flex-1 text-sm font-semibold text-slate-700">{tut.label}</span>
                <button
                  onClick={() => replay(tut.key)}
                  className="text-xs font-bold text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 px-3 py-1.5 rounded-full transition-colors"
                >
                  Replay
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => { resetAll(); setResetDone(true); setTimeout(() => setResetDone(false), 2500) }}
            className="w-full py-2.5 rounded-xl text-sm font-bold transition-all bg-slate-50 border border-slate-200 text-slate-500 hover:border-brand-300 hover:text-brand-600"
          >
            {resetDone ? '✓ Tutorials reset — they\'ll show again as you navigate' : '🔄 Reset All Tutorials'}
          </button>
          </>)}
        </motion.div>
      )}

      {/* Build stamp — last thing on the page, shown to everyone (incl. Android).
          Full version + build in the tooltip helps diagnose stale-bundle reports.

          The stamp carries the update control, because the two belong together:
          the version is the evidence, and the control is what to do about it.
          Which control depends on what actually stands in the way — the Play
          Store on Android, the service worker's cached bundle on web. An
          out-of-date build only reaches the footer after "Not now" on
          AppUpdateCover, so the control stays here as the way back. */}
      {clientInfo && (
        <div className="mt-6 flex flex-col items-center gap-2">
          <p
            className="text-center text-[10px] text-slate-400"
            title={`${clientInfo.platform} · v${clientInfo.version}${clientInfo.build ? ` · ${clientInfo.build}` : ''}`}
          >
            v{clientInfo.version}
          </p>

          {updateAvailable && !isWeb ? (
            <>
              <a
                href={PLAY_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors no-underline"
              >
                ⬆️ Update app
              </a>
              <p className="text-[11px] text-slate-400 text-center max-w-xs">
                A newer version is available on Google Play.
              </p>
            </>
          ) : clientInfo.platform === 'web' ? (
            /* Web: styled like the Sign out / Delete account footer actions —
               a rarely-needed escape hatch, not something to draw the eye. */
            <>
              <button
                onClick={runForceUpdate}
                disabled={updateBusy}
                className="text-sm text-slate-400 hover:text-slate-600 transition-colors py-2 px-4 disabled:opacity-50"
              >
                {updateBusy ? 'Getting latest version…' : 'Get the latest version'}
              </button>
              <p className="text-[11px] text-slate-400 text-center max-w-xs">
                Clears the saved copy of the app and reloads it. Use this if
                something looks out of date. Offline games re-download the next
                time you play.
              </p>
            </>
          ) : null}

        </div>
      )}

      {showDelete && <DeleteAccountModal onClose={() => setShowDelete(false)} />}

      {adminTools}

    </div>
    </>
  )
}
