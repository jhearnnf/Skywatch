import { useState } from 'react'
import Navbar        from './components/Navbar'
import Footer        from './components/Footer'
import Dashboard         from './pages/Dashboard'
import IntelFeed         from './pages/IntelFeed'
import Profile           from './pages/Profile'
import IntelligenceBrief from './pages/IntelligenceBrief'
import Contact           from './pages/Contact'
import About             from './pages/About'
import ReportProblem     from './pages/ReportProblem'
import Admin             from './pages/Admin'
import './App.css'

export default function App() {
  const [page,   setPage]   = useState({ id: 'dashboard', params: {} })
  const isAdmin = false // replace with auth context once auth is implemented

  const navigate = (id, params = {}) => {
    setPage({ id, params })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const renderPage = () => {
    const { id, params } = page
    switch (id) {
      case 'intel-feed':        return <IntelFeed navigate={navigate} />
      case 'intelligence-brief':return <IntelligenceBrief briefId={params.briefId} navigate={navigate} />
      case 'profile':           return <Profile />
      case 'admin':             return <Admin />
      case 'contact':           return <Contact />
      case 'about':             return <About />
      case 'report':            return <ReportProblem fromPage={params.fromPage} navigate={navigate} />
      default:                  return <Dashboard navigate={navigate} />
    }
  }

  return (
    <div className="app">
      <Navbar page={page.id} navigate={navigate} isAdmin={isAdmin} />
      {renderPage()}
      <Footer navigate={navigate} currentPage={page.id} />
    </div>
  )
}
