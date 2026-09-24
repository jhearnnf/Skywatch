import { useEffect, useRef } from 'react'
import { publicPageInitial } from './utils/publicPagePreview'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
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
import { NewGameUnlockProvider }           from './context/NewGameUnlockContext'
import { NewCategoryUnlockProvider }       from './context/NewCategoryUnlockContext'
import { UnsolvedReportsProvider }          from './context/UnsolvedReportsContext'
import { ChatUnreadProvider }                from './context/ChatUnreadContext'
import { GameChromeProvider }                from './context/GameChromeContext'
import TutorialPickerOverlay                  from './components/TutorialPickerOverlay'
import CbatMenuMusic                          from './components/CbatMenuMusic'
import CommunityMusic                         from './components/CommunityMusic'
import AppShell                            from './components/layout/AppShell'
import UiThemeSync                         from './components/layout/UiThemeSync'
import { useNativeBackButton }             from './hooks/useNativeBackButton'
import ScrollToTop                         from './components/ScrollToTop'
import AirstarNotification                 from './components/AirstarNotification'
import LevelUpNotification                 from './components/LevelUpNotification'
import RankPromotionNotification           from './components/RankPromotionNotification'
import CategoryUnlockNotification          from './components/CategoryUnlockNotification'
import LearnNavFlasher                     from './components/LearnNavFlasher'
import PlayNavFlasher                      from './components/PlayNavFlasher'
import UpdateNotificationModal             from './components/UpdateNotificationModal'
import OfflineStatus                        from './components/OfflineStatus'
import { captureLoginReturn, resolveLoginDest } from './utils/loginRedirect'
import { isSlimAllowed, isSlimLearnPath } from './utils/appMode'
import { transitionKeyFor } from './utils/navSections'
import { useSlimMode, useLandingPageEnabled, useSlimLearnEnabled } from './hooks/useSlimMode'
import { useNativeLaunchRoute } from './hooks/useNativeLaunch'

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
import BadgePicker    from './pages/BadgePicker'
import Rankings       from './pages/Rankings'
import Play           from './pages/Play'
import CaseFiles      from './pages/CaseFiles'
import CaseFilePlay   from './pages/CaseFilePlay'
import CaseFileDebrief from './pages/CaseFileDebrief'
import Cbat           from './pages/Cbat'
import CbatPlaneTurn  from './pages/CbatPlaneTurn'
import CbatAngles     from './pages/CbatAngles'
import CbatCodeDuplicates from './pages/CbatCodeDuplicates'
import CbatSymbols      from './pages/CbatSymbols'
import CbatTarget       from './pages/CbatTarget'
import CbatInstruments  from './pages/CbatInstruments'
import CbatAnt from './pages/CbatAnt'
import CbatFlag from './pages/CbatFlag'
import CbatClan from './pages/CbatClan'
import CbatVisualisation from './pages/CbatVisualisation'
import CbatDpt from './pages/CbatDpt'
import CbatAct from './pages/CbatAct'
import CbatNumericalOps from './pages/CbatNumericalOps'
import CbatDAD from './pages/CbatDAD'
import CbatSat from './pages/CbatSat'
import CbatCut from './pages/CbatCut'
import CbatRtt from './pages/CbatRtt'
import CbatSit from './pages/CbatSit'
import CbatSlt from './pages/CbatSlt'
import CbatVlt from './pages/CbatVlt'
import CbatMatf from './pages/CbatMatf'
import CbatVigilance from './pages/CbatVigilance'
import CbatSma from './pages/CbatSma'
import CbatLeaderboard from './pages/CbatLeaderboard'
import CbatAptitudeReport from './pages/CbatAptitudeReport'
import CbatGameGuard from './components/CbatGameGuard'
import AirstarHistory from './pages/AirstarHistory'
import GameHistory        from './pages/GameHistory'
import CbatGameHistory   from './pages/CbatGameHistory'
import IntelBriefHistory from './pages/IntelBriefHistory'
import ReportProblem  from './pages/ReportProblem'
import Donate         from './pages/Donate'
import Chat, { ChatAdminRoute } from './pages/chat/Chat'
import Contact        from './pages/Contact'
import Privacy        from './pages/Privacy'
import CbatDemoEmbed  from './pages/CbatDemoEmbed'
import DeleteAccount  from './pages/DeleteAccount'
import Subscription   from './pages/Subscription'
import Share          from './pages/Share'
import Survey         from './pages/Survey'
import CbatQuestionnaireResults from './pages/CbatQuestionnaireResults'
import SurveyOptOut   from './pages/SurveyOptOut'
import NotFound       from './pages/NotFound'

// v2 admin
import Admin          from './pages/Admin'
import AgentProfile from './pages/AgentProfile'
import CbatAwardPreview from './pages/CbatAwardPreview'
import OpenRouterUsage from './pages/OpenRouterUsage'
import Clipper        from './pages/Clipper'
import AptitudeSync   from './pages/AptitudeSync'
import World3DRoute  from './components/world3d/World3DRoute'

import { playSound } from './utils/sound'
import { recordPath } from './utils/routeTrail'
import useHeartbeat from './hooks/useHeartbeat'

// ── Page transition wrapper ────────────────────────────────────────────────
function PageWrapper({ children }) {
  return (
    <motion.div
      className="app-page"
      initial={publicPageInitial({ opacity: 0, y: 8 })}
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
    if (current.type === 'airstar')       playSound('airstar')
    else if (current.type === 'levelup')  playSound('level_up')
    else if (current.type === 'rankpromotion') playSound('rank_promotion')
    else if (current.type === 'categoryUnlock') playSound('category_unlocked')
  }, [current])

  if (!current) return null

  if (current.type === 'airstar') {
    return <AirstarNotification key={current.id} amount={current.amount} label={current.label} onDone={shiftNotif} />
  }
  if (current.type === 'levelup') {
    return <LevelUpNotification key={current.id} level={current.level} onDone={shiftNotif} />
  }
  if (current.type === 'rankpromotion') {
    return <RankPromotionNotification key={current.id} rank={current.rank} onDone={shiftNotif} />
  }
  if (current.type === 'categoryUnlock') {
    return <CategoryUnlockNotification key={current.id} categories={current.categories} onDone={shiftNotif} />
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
  const location = useLocation()
  if (loading) return <LoadingScreen />
  if (!user) {
    captureLoginReturn(location)
    return <Navigate to="/login" replace />
  }
  return children
}

// ── Login wrapper (redirect if already authed) ─────────────────────────────
// Three-layer defence against finishNewUser()'s navigate racing against setUser():
//   1. flushSync in finishNewUser commits the navigate synchronously (Login.jsx)
//   2. useIsPresent() is false during AnimatePresence exit — no redirect fires then
//   3. sw_post_login_destination: if navigate lost the race and we DO redirect here,
//      we send the user to the brief/deep-link they were heading to rather than /home
// /admin/agent/:id → /agent/:id, keeping the Back-button state the opener sent.
function LegacyAgentProfileRedirect() {
  const { id } = useParams()
  const location = useLocation()
  return <Navigate to={`/agent/${id}`} replace state={location.state} />
}

// The old full-site landing page, kept for admins only. Everyone else is sent
// to the live landing page at `/`, so the URL gives nothing away.
function LegacyLandingRoute() {
  const { user, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (!user?.isAdmin) return <Navigate to="/" replace />
  return <Landing legacy />
}

function LoginRoute() {
  const { user, loading } = useAuth()
  const isPresent = useIsPresent()

  if (loading) return <LoadingScreen />
  if (user && isPresent) {
    return <Navigate to={resolveLoginDest()} replace />
  }
  return <LoginPage />
}

// ── App routes ─────────────────────────────────────────────────────────────
function AppRoutes() {
  const { user, loading } = useAuth()
  const location    = useLocation()
  const navigate    = useNavigate()
  const slim        = useSlimMode()
  const slimLearnEnabled = useSlimLearnEnabled()
  const landingEnabled = useLandingPageEnabled()
  // Native only: whether a launch at `/` should skip the landing page. Called
  // here with every other hook, ahead of the early returns below.
  const skipLaunchLanding = useNativeLaunchRoute(location.pathname, user, !loading)
  useHeartbeat()

  // When the user transitions TO /login from another route, remember where
  // they came from so we can send them back after successful sign-in. Covers
  // every in-page Sign-In Link/button without needing per-call-site changes.
  const prevLocationRef = useRef(null)
  useEffect(() => {
    const prev = prevLocationRef.current
    if (prev && location.pathname === '/login' && prev.pathname !== '/login') {
      captureLoginReturn(prev)
    }
    prevLocationRef.current = location
  }, [location])

  // Keep the last few pages visited, so a problem report can say where the
  // person actually was. Recorded here rather than in the report form because
  // by the time that page mounts the pages worth naming are already behind it.
  // See src/utils/routeTrail.js.
  useEffect(() => { recordPath(location.pathname) }, [location.pathname])

  // Android hardware back button. Its own hook: see useNativeBackButton for
  // why it must stay out of the /embed/ frames.
  useNativeBackButton()

  if (loading) return <LoadingScreen />

  // Embeds render bare: no shell, no nav, no page transition. They exist to be
  // iframed by pages outside the SPA (the CBAT guide), where app chrome would
  // be a second navigation inside somebody else's document.
  //
  // Returned ahead of both redirects below on purpose. The slim-mode gate would
  // bounce /embed/* to /cbat — an iframe showing the games hub instead of the
  // game — and neither redirect means anything for a frame with no user in it.
  if (location.pathname.startsWith('/embed/')) {
    return (
      <Routes location={location}>
        <Route path="/embed/cbat/:demoId" element={<CbatDemoEmbed />} />
      </Routes>
    )
  }

  // No landing page to show — go straight to the CBAT games page. That's web
  // slim mode when an admin has turned the landing page off. See
  // useLandingPageEnabled.
  if (!landingEnabled && location.pathname === '/') {
    return <Navigate to="/cbat" replace />
  }

  // The native app opens on the games, not on the landing page — every launch
  // but the first one for a signed-out install, which gets the intro once. This
  // is the launch route only: `/` stays reachable from the header logo
  // afterwards, so the redirect stops applying once the app has moved off it.
  // See useNativeLaunchRoute.
  if (skipLaunchLanding && location.pathname === '/') {
    return <Navigate to="/cbat" replace />
  }

  // Slim ("CBAT-only") mode: native app always, or web when an admin enables
  // it site-wide. Any path outside the slim allow-list (learning content,
  // other games, etc.) redirects to the CBAT games home. On the web the
  // slimmed landing at `/` is allow-listed and rendered; on native the launch
  // redirect above decides whether it is shown.
  if (slim && !isSlimAllowed(location.pathname)) {
    return <Navigate to="/cbat" replace />
  }

  // Learn is allow-listed in slim mode, but the admin can switch the whole
  // group off with the "Learn in Slim Mode" flag.
  if (slim && !slimLearnEnabled && isSlimLearnPath(location.pathname)) {
    return <Navigate to="/cbat" replace />
  }

  return (
    <AppShell>
      <ScrollToTop />
      <AnimatePresence mode="wait" initial={false}>
        <Routes location={location} key={transitionKeyFor(location.pathname)}>

          {/* Public */}
          <Route path="/" element={<PageWrapper><Landing /></PageWrapper>} />
          <Route path="/homepagelegacy" element={<PageWrapper><LegacyLandingRoute /></PageWrapper>} />
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
          <Route path="/profile/badge"    element={<RequireAuth><PageWrapper><BadgePicker /></PageWrapper></RequireAuth>} />
          <Route path="/rankings"         element={<PageWrapper><Rankings /></PageWrapper>} />
          <Route path="/play"                   element={<PageWrapper><Play /></PageWrapper>} />
          <Route path="/case-files"             element={<PageWrapper><CaseFiles /></PageWrapper>} />
          <Route path="/case-files/:caseSlug/:chapterSlug" element={<RequireAuth><PageWrapper><CaseFilePlay /></PageWrapper></RequireAuth>} />
          <Route path="/case-files/:caseSlug/:chapterSlug/debrief" element={<RequireAuth><PageWrapper><CaseFileDebrief /></PageWrapper></RequireAuth>} />
          <Route path="/play/quiz"              element={<RequireAuth><PageWrapper><QuizBriefsList /></PageWrapper></RequireAuth>} />
          <Route path="/play/battle-of-order"   element={<RequireAuth><PageWrapper><BOOBriefsList /></PageWrapper></RequireAuth>} />
          <Route path="/cbat"                   element={<PageWrapper><Cbat /></PageWrapper>} />
          {/* Ahead of /cbat/:gameKey/leaderboard so "report" is never read as a game key. Not
              behind RequireAuth: like /cbat itself, it renders its own sign-in card, which makes
              it a landing page for the feature rather than a redirect. */}
          <Route path="/cbat/report"            element={<PageWrapper><CbatAptitudeReport /></PageWrapper>} />
          <Route path="/cbat/trace"             element={<RequireAuth><PageWrapper><CbatGameGuard gameKey="plane-turn"        gameTitle="Trace 1/2"       ><CbatPlaneTurn       /></CbatGameGuard></PageWrapper></RequireAuth>} />
          <Route path="/cbat/plane-turn"        element={<Navigate to="/cbat/trace" replace />} />
          <Route path="/cbat/plane-turn/leaderboard" element={<Navigate to="/cbat/plane-turn-2d/leaderboard" replace />} />
          <Route path="/cbat/angles"           element={<RequireAuth><PageWrapper><CbatGameGuard gameKey="angles"            gameTitle="Angles"          ><CbatAngles          /></CbatGameGuard></PageWrapper></RequireAuth>} />
          <Route path="/cbat/code-duplicates" element={<PageWrapper><CbatGameGuard gameKey="code-duplicates" gameTitle="Code Duplicates"><CbatCodeDuplicates /></CbatGameGuard></PageWrapper>} />
          <Route path="/cbat/symbols"         element={<PageWrapper><CbatGameGuard gameKey="symbols"         gameTitle="Symbols"        ><CbatSymbols        /></CbatGameGuard></PageWrapper>} />
          <Route path="/cbat/target"          element={<PageWrapper><CbatGameGuard gameKey="target"          gameTitle="Target"         ><CbatTarget         /></CbatGameGuard></PageWrapper>} />
          <Route path="/cbat/instruments"      element={<RequireAuth><PageWrapper><CbatGameGuard gameKey="instruments"       gameTitle="Instruments"     ><CbatInstruments     /></CbatGameGuard></PageWrapper></RequireAuth>} />
          <Route path="/cbat/instruments-orientation" element={<Navigate to="/cbat/instruments?mode=orientation" replace />} />
          <Route path="/cbat/ant"             element={<PageWrapper><CbatGameGuard gameKey="ant"             gameTitle="ANT"            ><CbatAnt            /></CbatGameGuard></PageWrapper>} />
          <Route path="/cbat/flag"             element={<RequireAuth><PageWrapper><CbatGameGuard gameKey="flag"              gameTitle="FLAG"            ><CbatFlag            /></CbatGameGuard></PageWrapper></RequireAuth>} />
          <Route path="/cbat/clan"             element={<RequireAuth><PageWrapper><CbatGameGuard gameKey="clan"              gameTitle="CLAN"            ><CbatClan            /></CbatGameGuard></PageWrapper></RequireAuth>} />
          <Route path="/cbat/visualisation"    element={<RequireAuth><PageWrapper><CbatGameGuard gameKey="visualisation"     gameTitle="Visualisation 2D/3D"><CbatVisualisation /></CbatGameGuard></PageWrapper></RequireAuth>} />
          <Route path="/cbat/visualisation-2d" element={<Navigate to="/cbat/visualisation" replace />} />
          <Route path="/cbat/visualisation-3d" element={<Navigate to="/cbat/visualisation" replace />} />
          <Route path="/cbat/dpt"              element={<RequireAuth><PageWrapper><CbatGameGuard gameKey="dpt"               gameTitle="DPT"             ><CbatDpt             /></CbatGameGuard></PageWrapper></RequireAuth>} />
          <Route path="/cbat/act"              element={<RequireAuth><PageWrapper><CbatGameGuard gameKey="act"               gameTitle="ACT"             ><CbatAct             /></CbatGameGuard></PageWrapper></RequireAuth>} />
          <Route path="/cbat/numerical-ops"    element={<RequireAuth><PageWrapper><CbatGameGuard gameKey="numerical-ops"     gameTitle="Numerical Operations"><CbatNumericalOps /></CbatGameGuard></PageWrapper></RequireAuth>} />
          <Route path="/cbat/dad"              element={<RequireAuth><PageWrapper><CbatGameGuard gameKey="dad"               gameTitle="Directions and Distances"><CbatDAD /></CbatGameGuard></PageWrapper></RequireAuth>} />
          <Route path="/cbat/sat"              element={<RequireAuth><PageWrapper><CbatGameGuard gameKey="sat"               gameTitle="Situational Awareness Test"><CbatSat /></CbatGameGuard></PageWrapper></RequireAuth>} />
          <Route path="/cbat/cut"              element={<RequireAuth><PageWrapper><CbatGameGuard gameKey="cut"               gameTitle="Cognitive Updating Test"><CbatCut /></CbatGameGuard></PageWrapper></RequireAuth>} />
          <Route path="/cbat/rtt"              element={<RequireAuth><PageWrapper><CbatGameGuard gameKey="rtt"               gameTitle="Rapid Tracking Test"><CbatRtt /></CbatGameGuard></PageWrapper></RequireAuth>} />
          <Route path="/cbat/sit"              element={<RequireAuth><PageWrapper><CbatGameGuard gameKey="sit"               gameTitle="Spatial Integration Test"><CbatSit /></CbatGameGuard></PageWrapper></RequireAuth>} />
          <Route path="/cbat/slt"              element={<RequireAuth><PageWrapper><CbatGameGuard gameKey="slt"               gameTitle="System Logic Test"><CbatSlt /></CbatGameGuard></PageWrapper></RequireAuth>} />
          <Route path="/cbat/vlt"              element={<RequireAuth><PageWrapper><CbatGameGuard gameKey="vlt"               gameTitle="Verbal Logic Test"><CbatVlt /></CbatGameGuard></PageWrapper></RequireAuth>} />
          <Route path="/cbat/matf"             element={<RequireAuth><PageWrapper><CbatGameGuard gameKey="matf"              gameTitle="Table Reading Test"><CbatMatf /></CbatGameGuard></PageWrapper></RequireAuth>} />
          <Route path="/cbat/vigilance"        element={<RequireAuth><PageWrapper><CbatGameGuard gameKey="vigilance"         gameTitle="Vigilance Test"><CbatVigilance /></CbatGameGuard></PageWrapper></RequireAuth>} />
          <Route path="/cbat/sma"              element={<RequireAuth><PageWrapper><CbatGameGuard gameKey="sma"               gameTitle="Sensory Motor Apparatus Test"><CbatSma /></CbatGameGuard></PageWrapper></RequireAuth>} />
          <Route path="/cbat/:gameKey/leaderboard" element={<RequireAuth><PageWrapper><CbatLeaderboard /></PageWrapper></RequireAuth>} />

          {/* v2 protected pages */}
          <Route path="/subscribe"        element={<PageWrapper><Subscription /></PageWrapper>} />
          <Route path="/report"           element={<PageWrapper><ReportProblem /></PageWrapper>} />
          {/* Public on purpose — see the note at the top of Donate.jsx. */}
          <Route path="/donate"           element={<PageWrapper><Donate /></PageWrapper>} />
          <Route path="/chat"             element={<RequireAuth><PageWrapper><Chat /></PageWrapper></RequireAuth>} />
          {/* Static segment before the dynamic one — react-router ranks it
              higher regardless, but the order documents the intent. */}
          <Route path="/chat/admin"       element={<RequireAuth><PageWrapper><ChatAdminRoute /></PageWrapper></RequireAuth>} />
          {/* Same <Chat /> element type as /chat above, deliberately: React
              then reconciles them as one component instead of unmounting and
              remounting, so opening a conversation keeps the rail and its data
              alive. Paired with transitionKeyFor() — both are needed. */}
          <Route path="/chat/:conversationId" element={<RequireAuth><PageWrapper><Chat /></PageWrapper></RequireAuth>} />
          <Route path="/contact"          element={<PageWrapper><Contact /></PageWrapper>} />
          {/* The CBAT community guide is deliberately NOT a route. It is a
              standalone document served straight from public/cbat-guide.html —
              its own typography and layout, not the app's. See appMode.js. */}
          <Route path="/privacy"          element={<PageWrapper><Privacy /></PageWrapper>} />
          <Route path="/delete-account"   element={<PageWrapper><DeleteAccount /></PageWrapper>} />
          <Route path="/share"            element={<PageWrapper><Share /></PageWrapper>} />
          {/* Public, token-authenticated: the emailed CBAT outcome questionnaire.
              Deliberately outside RequireAuth — the recipient may not be signed in
              on the device they open the email on, and requiring a login here
              would lose most of the responses the campaign exists to collect. */}
          <Route path="/survey/:token/opt-out" element={<PageWrapper><SurveyOptOut /></PageWrapper>} />
          <Route path="/survey/:token"         element={<PageWrapper><Survey /></PageWrapper>} />
          {/* And the same questionnaire with no token, for someone who is
              already signed in: the page asks the server for this account's own
              invite and carries on. Also outside RequireAuth, so a signed-out
              visitor gets the page's own "sign in or use your emailed link"
              screen rather than being bounced to /login with no explanation. */}
          <Route path="/survey"                element={<PageWrapper><Survey /></PageWrapper>} />
          <Route path="/airstar-history"       element={<RequireAuth><PageWrapper><AirstarHistory /></PageWrapper></RequireAuth>} />
          <Route path="/game-history"          element={<RequireAuth><PageWrapper><GameHistory /></PageWrapper></RequireAuth>} />
          <Route path="/cbat-game-history"     element={<RequireAuth><PageWrapper><CbatGameHistory /></PageWrapper></RequireAuth>} />
          <Route path="/intel-brief-history"   element={<RequireAuth><PageWrapper><IntelBriefHistory /></PageWrapper></RequireAuth>} />
          <Route path="/admin"             element={<RequireAuth><PageWrapper><Admin /></PageWrapper></RequireAuth>} />
          {/* Clipper — admin-only short-form video tool. The page itself checks
              isAdmin; every /api/clipper route is adminOnly server-side too. */}
          <Route path="/clipper"           element={<RequireAuth><PageWrapper><Clipper /></PageWrapper></RequireAuth>} />
          {/* Another player's profile, opened from the user card in Community and
              from a name in the recent-scores feed. Any signed-in agent may read
              it; the admin-only cards are gated on isAdmin and marked as such.
              The old /admin/agent/:id address still resolves, state and all,
              for links pasted before the page was made public. */}
          <Route path="/agent/:id"         element={<RequireAuth><PageWrapper><AgentProfile /></PageWrapper></RequireAuth>} />
          <Route path="/admin/agent/:id"   element={<LegacyAgentProfileRedirect />} />
          <Route path="/admin/openrouter-usage" element={<RequireAuth><PageWrapper><OpenRouterUsage /></PageWrapper></RequireAuth>} />
          <Route path="/admin/cbat-questionnaire" element={<RequireAuth><PageWrapper><CbatQuestionnaireResults /></PageWrapper></RequireAuth>} />
          {/* Admin-only preview of the post-game progress-award flow. Under /admin so it inherits
              the slim-mode allowlist and stays out of the player-facing routes. */}
          <Route path="/admin/award-preview" element={<RequireAuth><PageWrapper><CbatAwardPreview /></PageWrapper></RequireAuth>} />

          {/* 3D World (feature-flagged) */}
          <Route path="/immerse" element={<World3DRoute />} />

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
    <HelmetProvider>
    <BrowserRouter>
      <AuthProvider>
        <AppSettingsProvider>
          <AppTutorialProvider>
            <NewGameUnlockProvider>
             <NewCategoryUnlockProvider>
              <UnsolvedReportsProvider>
                <ChatUnreadProvider>
                  <GameChromeProvider>
                    <UiThemeSync />
                    <AppRoutes />
                    <CbatMenuMusic />
        <CommunityMusic />
                    <NotifLayer />
                    <OfflineStatus />
                    <UpdateNotificationModal />
                    <LearnNavFlasher />
                    <PlayNavFlasher />
                    <TutorialPickerOverlay />
                  </GameChromeProvider>
                </ChatUnreadProvider>
              </UnsolvedReportsProvider>
             </NewCategoryUnlockProvider>
            </NewGameUnlockProvider>
          </AppTutorialProvider>
        </AppSettingsProvider>
      </AuthProvider>
    </BrowserRouter>
    </HelmetProvider>
  )
}
