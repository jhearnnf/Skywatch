import { useEffect, useRef, useState, useCallback } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { HelmetProvider } from 'react-helmet-async'
import { AnimatePresence, motion, useIsPresent, MotionGlobalConfig } from 'framer-motion'

// Disable all Framer Motion animations on e-ink / e-paper displays (update: slow).
// Has no effect on normal screens — matchMedia returns false there.
if (window.matchMedia('(update: slow)').matches) {
  MotionGlobalConfig.skipAnimations = true
}

import { AuthProvider, useAuth }          from './context/AuthContext'
import { AppSettingsProvider }             from './context/AppSettingsContext'
import { AppTutorialProvider }             from './context/AppTutorialContext'
import { FlashcardBadgeProvider }          from './context/FlashcardBadgeContext'
import { NewGameUnlockProvider }           from './context/NewGameUnlockContext'
import { UnsolvedReportsProvider }          from './context/UnsolvedReportsContext'
import AppShell                            from './components/layout/AppShell'
import AircoinNotification                 from './components/AircoinNotification'
import LevelUpNotification                 from './components/LevelUpNotification'
import RankPromotionNotification           from './components/RankPromotionNotification'

// v2 pages
import Landing        from './pages/Landing'
import Home           from './pages/Home'
import LearnPriority  from './pages/LearnPriority'
import BriefReader    from './pages/BriefReader'
import QuizFlow            from './pages/QuizFlow'
import BattleOfOrderFlow  from './pages/BattleOfOrderFlow'
import WhereAircraftGame  from './pages/WhereAircraftGame'
import QuizBriefsList     from './pages/QuizBriefsList'
import BOOBriefsList      from './pages/BOOBriefsList'

// v2 pages (continued)
import LoginPage      from './pages/Login'
import Profile        from './pages/Profile'
import Rankings       from './pages/Rankings'
import Play           from './pages/Play'
import Cbat           from './pages/Cbat'
import CbatPlaneTurn  from './pages/CbatPlaneTurn'
import CbatAngles     from './pages/CbatAngles'
import CbatCodeDuplicates from './pages/CbatCodeDuplicates'
import CbatSymbols      from './pages/CbatSymbols'
import CbatLeaderboard from './pages/CbatLeaderboard'
import AircoinHistory from './pages/AircoinHistory'
import GameHistory        from './pages/GameHistory'
import IntelBriefHistory from './pages/IntelBriefHistory'
import ReportProblem  from './pages/ReportProblem'
import Contact        from './pages/Contact'
import Subscription   from './pages/Subscription'
import Share          from './pages/Share'
import NotFound       from './pages/NotFound'

// v2 admin
import Admin          from './pages/Admin'
import AptitudeSync   from './pages/AptitudeSync'

import { playSound } from './utils/sound'

// ── Page transition wrapper ────────────────────────────────────────────────
function PageWrapper({ children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  )
}

// ── Notification layer (sits above all routes) ─────────────────────────────
function NotifLayer() {
  const { notifQueue, shiftNotif } = useAuth()
  const current     = notifQueue[0] ?? null
  const prevIdRef   = useRef(null)

  useEffect(() => {
    if (!current || current.id === prevIdRef.current) return
    prevIdRef.current = current.id
    if (current.type === 'aircoin')       playSound('aircoin')
    else if (current.type === 'levelup')  playSound('level_up')
    else if (current.type === 'rankpromotion') playSound('rank_promotion')
  }, [current])

  if (!current) return null

  if (current.type === 'aircoin') {
    return <AircoinNotification key={current.id} amount={current.amount} label={current.label} onDone={shiftNotif} />
  }
  if (current.type === 'levelup') {
    return <LevelUpNotification key={current.id} level={current.level} onDone={shiftNotif} />
  }
  if (current.type === 'rankpromotion') {
    return <RankPromotionNotification key={current.id} rank={current.rank} onDone={shiftNotif} />
  }
  return null
}

// ── Loading screen ─────────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-brand-50">
      <div className="text-center">
        <div className="w-10 h-10 border-3 border-brand-200 border-t-brand-600 rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm font-semibold text-brand-700 tracking-widest">SKYWATCH</p>
      </div>
    </div>
  )
}

// ── Route guard ────────────────────────────────────────────────────────────
function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (!user)   return <Navigate to="/login" replace />
  return children
}

// ── Login wrapper (redirect if already authed) ─────────────────────────────
// Three-layer defence against finishNewUser()'s navigate racing against setUser():
//   1. flushSync in finishNewUser commits the navigate synchronously (Login.jsx)
//   2. useIsPresent() is false during AnimatePresence exit — no redirect fires then
//   3. sw_post_login_destination: if navigate lost the race and we DO redirect here,
//      we send the user to the brief they just completed rather than /home
function LoginRoute() {
  const { user, loading } = useAuth()
  const isPresent = useIsPresent()

  // Clean up the stored destination whenever this component unmounts, whether the
  // navigate in finishNewUser won the race or we redirected via <Navigate> below.
  useEffect(() => () => sessionStorage.removeItem('sw_post_login_destination'), [])

  if (loading) return <LoadingScreen />
  if (user && isPresent) {
    const dest = sessionStorage.getItem('sw_post_login_destination') || '/home'
    return <Navigate to={dest} replace />
  }
  return <LoginPage />
}

// ── App routes ─────────────────────────────────────────────────────────────
function AppRoutes() {
  const { loading } = useAuth()
  const location    = useLocation()
  const navigate    = useNavigate()

  // Android hardware back button — navigate back or exit on home
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let listener
    import('@capacitor/app').then(({ App }) => {
      listener = App.addListener('backButton', ({ canGoBack }) => {
        if (canGoBack) {
          window.history.back()
        } else {
          App.exitApp()
        }
      })
    })
    return () => { listener?.then(l => l.remove()) }
  }, [])

  if (loading) return <LoadingScreen />

  return (
    <AppShell>
      <AnimatePresence mode="wait" initial={false}>
        <Routes location={location} key={location.pathname}>

          {/* Public */}
          <Route path="/" element={<PageWrapper><Landing /></PageWrapper>} />
          <Route path="/login" element={<LoginRoute />} />

          {/* Core learning (accessible without login, progress tracked when logged in) */}
          <Route path="/home"              element={<PageWrapper><Home /></PageWrapper>} />
          <Route path="/learn-priority"    element={<PageWrapper><LearnPriority /></PageWrapper>} />
          <Route path="/brief/:briefId"    element={<PageWrapper><BriefReader /></PageWrapper>} />
          <Route path="/quiz/:briefId"          element={<RequireAuth><PageWrapper><QuizFlow /></PageWrapper></RequireAuth>} />
          <Route path="/aptitude-sync/:briefId" element={<RequireAuth><AptitudeSync /></RequireAuth>} />
          <Route path="/battle-of-order/:briefId" element={<RequireAuth><PageWrapper><BattleOfOrderFlow /></PageWrapper></RequireAuth>} />
          <Route path="/wheres-that-aircraft/:aircraftBriefId" element={<RequireAuth><PageWrapper><WhereAircraftGame /></PageWrapper></RequireAuth>} />

          {/* v2 pages */}
          <Route path="/profile"          element={<PageWrapper><Profile /></PageWrapper>} />
          <Route path="/rankings"         element={<PageWrapper><Rankings /></PageWrapper>} />
          <Route path="/play"                   element={<PageWrapper><Play /></PageWrapper>} />
          <Route path="/play/quiz"              element={<RequireAuth><PageWrapper><QuizBriefsList /></PageWrapper></RequireAuth>} />
          <Route path="/play/battle-of-order"   element={<RequireAuth><PageWrapper><BOOBriefsList /></PageWrapper></RequireAuth>} />
          <Route path="/cbat"                   element={<PageWrapper><Cbat /></PageWrapper>} />
          <Route path="/cbat/plane-turn"        element={<RequireAuth><PageWrapper><CbatPlaneTurn /></PageWrapper></RequireAuth>} />
          <Route path="/cbat/angles"           element={<RequireAuth><PageWrapper><CbatAngles /></PageWrapper></RequireAuth>} />
          <Route path="/cbat/code-duplicates" element={<RequireAuth><PageWrapper><CbatCodeDuplicates /></PageWrapper></RequireAuth>} />
          <Route path="/cbat/symbols"          element={<RequireAuth><PageWrapper><CbatSymbols /></PageWrapper></RequireAuth>} />
          <Route path="/cbat/:gameKey/leaderboard" element={<RequireAuth><PageWrapper><CbatLeaderboard /></PageWrapper></RequireAuth>} />

          {/* v2 protected pages */}
          <Route path="/subscribe"        element={<PageWrapper><Subscription /></PageWrapper>} />
          <Route path="/report"           element={<PageWrapper><ReportProblem /></PageWrapper>} />
          <Route path="/contact"          element={<PageWrapper><Contact /></PageWrapper>} />
          <Route path="/share"            element={<PageWrapper><Share /></PageWrapper>} />
          <Route path="/aircoin-history"       element={<RequireAuth><PageWrapper><AircoinHistory /></PageWrapper></RequireAuth>} />
          <Route path="/game-history"          element={<RequireAuth><PageWrapper><GameHistory /></PageWrapper></RequireAuth>} />
          <Route path="/intel-brief-history"   element={<RequireAuth><PageWrapper><IntelBriefHistory /></PageWrapper></RequireAuth>} />
          <Route path="/admin"             element={<RequireAuth><PageWrapper><Admin /></PageWrapper></RequireAuth>} />

          {/* 404 */}
          <Route path="*" element={<PageWrapper><NotFound /></PageWrapper>} />
        </Routes>
      </AnimatePresence>
    </AppShell>
  )
}

// ── Report notification banner ─────────────────────────────────────────────
// Fetches unread in-app notifications on login, shows them one at a time.
function ReportNotifBanner() {
  const { user } = useAuth()
  const API = import.meta.env.VITE_API_URL || ''
  const [notifs,  setNotifs]  = useState([])
  const [visible, setVisible] = useState(false)

  // Fetch unread notifications whenever the user logs in
  useEffect(() => {
    if (!user) return
    fetch(`${API}/api/users/me/notifications`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        const list = d.data?.notifications ?? []
        if (list.length > 0) { setNotifs(list); setVisible(true) }
      })
      .catch(() => {})
  }, [user?._id])

  const dismiss = async () => {
    const current = notifs[0]
    if (!current) return
    setVisible(false)
    // Mark as read
    await fetch(`${API}/api/users/me/notifications/${current._id}/read`, {
      method: 'POST', credentials: 'include',
    }).catch(() => {})
    // Advance queue after brief delay
    setTimeout(() => {
      setNotifs(prev => {
        const next = prev.slice(1)
        if (next.length > 0) setVisible(true)
        return next
      })
    }, 300)
  }

  const current = notifs[0]
  if (!current || !visible) return null

  return (
    <div
      style={{
        position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
        zIndex: 9000, maxWidth: 440, width: 'calc(100% - 32px)',
        background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16,
        boxShadow: '0 8px 32px rgba(0,0,0,0.12)', padding: '16px 20px',
        display: 'flex', gap: 12, alignItems: 'flex-start',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#1d4ed8', margin: '0 0 4px' }}>
          {current.title}
        </p>
        <p style={{ fontSize: 13, color: '#334155', margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
          {current.message}
        </p>
      </div>
      <button
        onClick={dismiss}
        style={{
          flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer',
          color: '#94a3b8', fontSize: 18, lineHeight: 1, padding: '2px 4px',
        }}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  )
}

// ── Root ───────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <HelmetProvider>
    <BrowserRouter>
      <AuthProvider>
        <AppSettingsProvider>
          <AppTutorialProvider>
            <NewGameUnlockProvider>
              <UnsolvedReportsProvider>
              <FlashcardBadgeProvider>
                <AppRoutes />
                <NotifLayer />
                <ReportNotifBanner />
              </FlashcardBadgeProvider>
              </UnsolvedReportsProvider>
            </NewGameUnlockProvider>
          </AppTutorialProvider>
        </AppSettingsProvider>
      </AuthProvider>
    </BrowserRouter>
    </HelmetProvider>
  )
}
