import { useLocation } from 'react-router-dom'
import TopBar   from './TopBar'
import Sidebar  from './Sidebar'
import BottomNav from './BottomNav'

// Pages where we want no chrome at all (full-screen experiences)
const BARE_PAGES = ['/', '/login', '/register']

export default function AppShell({ children }) {
  const { pathname } = useLocation()
  const bare = BARE_PAGES.includes(pathname)

  if (bare) return <>{children}</>

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar />

      <div className="flex flex-1 pt-14">
        <Sidebar />

        {/* Main content — offset for sidebar on md+ */}
        <main className="flex-1 md:ml-56 pb-20 md:pb-6 min-w-0 overflow-x-clip">
          <div className="max-w-3xl mx-auto px-4 py-6">
            {children}
          </div>
        </main>
      </div>

      <BottomNav />
    </div>
  )
}
