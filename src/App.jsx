import { useEffect, useRef } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'

import { AuthProvider, useAuth }          from './context/AuthContext'
import { AppSettingsProvider }             from './context/AppSettingsContext'
import { AppTutorialProvider }             from './context/AppTutorialContext'
import AppShell                            from './components/layout/AppShell'
import AircoinNotification                 from './components/AircoinNotification'
import LevelUpNotification                 from './components/LevelUpNotification'
import RankPromotionNotification           from './components/RankPromotionNotification'

// v2 pages
import Landing        from './pages/v2/Landing'
import Home           from './pages/v2/Home'
import Learn          from './pages/v2/Learn'
import CategoryBriefs from './pages/v2/CategoryBriefs'
import BriefReader    from './pages/v2/BriefReader'
import QuizFlow       from './pages/v2/QuizFlow'

// v2 pages (continued)
import LoginPage      from './pages/v2/Login'
import Profile        from './pages/v2/Profile'
import Rankings       from './pages/v2/Rankings'
import Play           from './pages/v2/Play'
import AircoinHistory from './pages/v2/AircoinHistory'
import GameHistory    from './pages/v2/GameHistory'
import ReportProblem  from './pages/v2/ReportProblem'
import Subscription   from './pages/v2/Subscription'
import NotFound       from './pages/v2/NotFound'

// v2 admin
import Admin          from './pages/v2/Admin'

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
function LoginRoute() {
  const { user } = useAuth()
  if (user) return <Navigate to="/home" replace />
  return <LoginPage />
}

// ── App routes ─────────────────────────────────────────────────────────────
function AppRoutes() {
  const { loading } = useAuth()
  const location    = useLocation()

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
          <Route path="/learn"             element={<PageWrapper><Learn /></PageWrapper>} />
          <Route path="/learn/:category"   element={<PageWrapper><CategoryBriefs /></PageWrapper>} />
          <Route path="/brief/:briefId"    element={<PageWrapper><BriefReader /></PageWrapper>} />
          <Route path="/quiz/:briefId"     element={<RequireAuth><PageWrapper><QuizFlow /></PageWrapper></RequireAuth>} />

          {/* v2 pages */}
          <Route path="/profile"          element={<PageWrapper><Profile /></PageWrapper>} />
          <Route path="/rankings"         element={<PageWrapper><Rankings /></PageWrapper>} />
          <Route path="/play"             element={<PageWrapper><Play /></PageWrapper>} />

          {/* v2 protected pages */}
          <Route path="/subscribe"        element={<PageWrapper><Subscription /></PageWrapper>} />
          <Route path="/report"           element={<PageWrapper><ReportProblem /></PageWrapper>} />
          <Route path="/aircoin-history"  element={<RequireAuth><PageWrapper><AircoinHistory /></PageWrapper></RequireAuth>} />
          <Route path="/game-history"     element={<RequireAuth><PageWrapper><GameHistory /></PageWrapper></RequireAuth>} />
          <Route path="/admin"             element={<RequireAuth><PageWrapper><Admin /></PageWrapper></RequireAuth>} />

          {/* 404 */}
          <Route path="*" element={<PageWrapper><NotFound /></PageWrapper>} />
        </Routes>
      </AnimatePresence>
    </AppShell>
  )
}

// ── Root ───────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppSettingsProvider>
          <AppTutorialProvider>
            <AppRoutes />
            <NotifLayer />
          </AppTutorialProvider>
        </AppSettingsProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
