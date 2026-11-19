import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useGameChrome } from '../context/GameChromeContext'
import { listenForForeground } from '../lib/pushNotifications'
import { canShowInAppNotice, dropSeen, enqueue } from '../utils/inAppNoticeRoutes'

// The banner for a chat notification that arrives while SkyWatch is open.
// (Closed or in the background, the phone or browser shows a normal system
// notification instead; see public/push-sw.js and pushNotify.js.)
//
//  - Already on the chat it is about: dropped, they can see it.
//  - Mid-game or on any screen not on the allowlist: held, then shown on the
//    next allowed screen. See utils/inAppNoticeRoutes.js for why.
//  - Several waiting: the newest is shown with "and N more".

const SHOW_MS = 6000

export default function InAppPushNotice() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { immersive } = useGameChrome()
  const [queue, setQueue] = useState([])

  useEffect(() => listenForForeground((payload) => {
    setQueue(q => enqueue(q, { ...payload, id: `${Date.now()}-${Math.random()}` }))
  }), [])

  // Arriving on the chat a waiting item is about counts as having seen it.
  // Adjusted during render on a route change (React's pattern for state
  // derived from a changing prop) rather than in an effect.
  const [seenPath, setSeenPath] = useState(pathname)
  if (seenPath !== pathname) {
    setSeenPath(pathname)
    setQueue(q => dropSeen(q, pathname))
  }

  const visible = dropSeen(queue, pathname)
  const allowed = canShowInAppNotice(pathname, { immersive })
  const current = allowed && visible.length ? visible[visible.length - 1] : null
  const more = visible.length - 1

  const clear = useCallback(() => setQueue([]), [])

  useEffect(() => {
    if (!current) return
    const t = setTimeout(clear, SHOW_MS)
    return () => clearTimeout(t)
  }, [current, clear])

  const open = () => {
    const url = current?.url
    clear()
    if (url) navigate(url)
  }

  return (
    <AnimatePresence>
      {current && (
        <motion.div
          key={current.id}
          data-testid="in-app-push-notice"
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          className="fixed left-1/2 -translate-x-1/2 z-[9000] w-[calc(100%-2rem)] max-w-sm"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
        >
          <div className="flex items-start gap-2 bg-surface rounded-2xl border border-brand-200 card-shadow p-3">
            <button onClick={open} className="flex-1 min-w-0 text-left">
              <p className="text-sm font-bold text-slate-800 truncate">{current.title}</p>
              {current.body && <p className="text-xs text-slate-500 line-clamp-2">{current.body}</p>}
              {more > 0 && (
                <p className="text-[11px] font-semibold text-brand-600 mt-1">
                  and {more} more
                </p>
              )}
            </button>
            <button
              onClick={clear}
              aria-label="Dismiss"
              className="shrink-0 text-slate-400 hover:text-slate-600 text-lg leading-none px-1"
            >
              ×
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
