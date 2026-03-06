import { useState, useEffect, useRef } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import Navbar        from './components/Navbar'
import Footer        from './components/Footer'
import Dashboard         from './pages/Dashboard'
import IntelFeed         from './pages/IntelFeed'
import Profile           from './pages/Profile'
import IntelligenceBrief from './pages/IntelligenceBrief'
import Rankings          from './pages/Rankings'
import Login             from './pages/Login'
import Welcome           from './pages/Welcome'
import Contact           from './pages/Contact'
import About             from './pages/About'
import ReportProblem     from './pages/ReportProblem'
import Admin             from './pages/Admin'
import AircoinHistory      from './pages/AircoinHistory'
import GameHistory         from './pages/GameHistory'
import AircoinNotification       from './components/AircoinNotification'
import LevelUpNotification       from './components/LevelUpNotification'
import RankPromotionNotification from './components/RankPromotionNotification'
import { playSound }        from './utils/sound'
import './App.css'

// Inner app — has access to AuthContext
function AppInner() {
  const { loading, notifQueue, shiftNotif } = useAuth()
  const currentNotif   = notifQueue[0] ?? null
  const prevNotifIdRef = useRef(null)

  useEffect(() => {
    if (!currentNotif || currentNotif.id === prevNotifIdRef.current) return
    prevNotifIdRef.current = currentNotif.id
    if (currentNotif.type === 'aircoin') playSound('aircoin')
    else if (currentNotif.type === 'levelup') playSound('level_up')
    else if (currentNotif.type === 'rankpromotion') playSound('rank_promotion')
  }, [currentNotif])

  const [page, setPage] = useState(() => {
    // Show welcome page if user hasn't visited today
    const today     = new Date().toDateString()
    const lastVisit = localStorage.getItem('skywatch_last_visit')
    return lastVisit === today
      ? { id: 'dashboard', params: {} }
      : { id: 'welcome',   params: {} }
  })

  const navigate = (id, params = {}) => {
    setPage({ id, params })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (loading) {
    return (
      <div className="app-loading">
        <div className="app-loading__spinner" aria-label="Loading" />
      </div>
    )
  }

  const renderPage = () => {
    const { id, params } = page
    switch (id) {
      case 'welcome':           return <Welcome navigate={navigate} />
      case 'login':             return <Login navigate={navigate} />
      case 'intel-feed':        return <IntelFeed navigate={navigate} initialCategory={params.category} />
      case 'intelligence-brief':return <IntelligenceBrief briefId={params.briefId} navigate={navigate} />
      case 'profile':           return <Profile navigate={navigate} />
      case 'rankings':          return <Rankings navigate={navigate} />
      case 'admin':             return <Admin navigate={navigate} />
      case 'contact':           return <Contact />
      case 'about':             return <About />
      case 'report':            return <ReportProblem fromPage={params.fromPage} navigate={navigate} />
      case 'aircoin-history':   return <AircoinHistory navigate={navigate} />
      case 'game-history':      return <GameHistory navigate={navigate} />
      default:                  return <Dashboard navigate={navigate} />
    }
  }

  // Hide navbar/footer on welcome and login pages for full-screen experience
  const fullScreen = page.id === 'welcome' || page.id === 'login'

  return (
    <div className="app">
      {!fullScreen && <Navbar page={page.id} navigate={navigate} />}
      {renderPage()}
      {!fullScreen && <Footer navigate={navigate} currentPage={page.id} />}
      {currentNotif?.type === 'aircoin' && (
        <AircoinNotification
          key={currentNotif.id}
          amount={currentNotif.amount}
          label={currentNotif.label}
          onDone={shiftNotif}
        />
      )}
      {currentNotif?.type === 'levelup' && (
        <LevelUpNotification
          key={currentNotif.id}
          level={currentNotif.level}
          onDone={shiftNotif}
        />
      )}
      {currentNotif?.type === 'rankpromotion' && (
        <RankPromotionNotification
          key={currentNotif.id}
          rank={currentNotif.rank}
          onDone={shiftNotif}
        />
      )}
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  )
}
