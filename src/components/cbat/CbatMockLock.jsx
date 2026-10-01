import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import {
  useActiveMock, setActiveMock, refreshActiveMock, currentStep, mockGamePathname, mockUrl,
  MOCK_ROUTE, MOCK_STORAGE_KEY, onLeaveRequest, readRememberedMock,
  isGrantedGamePath, clearGrantedGamePath,
} from '../../lib/cbatMockSession'
import { captureEvent } from '../../lib/posthog'
import Overlay from '../ui/Overlay'

// The rest of SkyWatch is closed while a Mock Assessment runs, the way the real test room is: the
// player can be on the assessment's own pages and on the test it is waiting for, and nowhere else
// unless they choose to leave. Leaving keeps every score already posted; the mock itself ends.
//
// Two layers, because there are two ways to move:
//   a link click (the nav, a game's back link) is caught before it navigates, and asks;
//   anything else (a programmatic navigate, the browser or Android back button, a typed URL, a
//     new tab) is caught on arrival and sent back to the assessment WITHOUT asking: arriving is not
//     choosing to leave. The assessment page says the mock is still running.
//
// Also the one place the stored mock is kept in step with the account: taken from this browser's
// memory before the first paint, confirmed by the server on sign-in and whenever the tab comes
// back into view, shared with other tabs through localStorage, and cleared on sign-out.
const REFRESH_GAP_MS = 3000

export default function CbatMockLock() {
  const { user, apiFetch, API } = useAuth() ?? {}
  const mock = useActiveMock()
  const location = useLocation()
  const navigate = useNavigate()
  const [leaveTo, setLeaveTo] = useState(null)
  const [leaving, setLeaving] = useState(false)
  const [leaveSource, setLeaveSource] = useState(null)

  const userId = user?._id ?? null

  // Lock from the first frame: take the remembered mock for this account before painting, then
  // let the server confirm or correct it below.
  useLayoutEffect(() => {
    if (!userId) { setActiveMock(null, { remember: false }); return }
    const remembered = readRememberedMock(userId)
    if (remembered) setActiveMock(remembered, { remember: false })
  }, [userId])

  // Another tab started or left a mock.
  useEffect(() => {
    if (!userId) return undefined
    const onStorage = (e) => {
      if (e.key !== MOCK_STORAGE_KEY) return
      setActiveMock(readRememberedMock(userId), { remember: false })
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [userId])

  useEffect(() => {
    if (!userId) return undefined
    const refresh = () => refreshActiveMock({ apiFetch, API }).catch(() => { /* offline: keep what we had */ })
    refresh()

    // A tab that was already open when a mock started (or ended) in another tab only learns
    // about it by asking again, so ask whenever the tab comes back into view. Throttled: focus
    // and visibilitychange usually fire together.
    let last = Date.now()
    const onReturn = () => {
      if (document.visibilityState === 'hidden' || Date.now() - last < REFRESH_GAP_MS) return
      last = Date.now()
      refresh()
    }
    window.addEventListener('focus', onReturn)
    document.addEventListener('visibilitychange', onReturn)
    return () => {
      window.removeEventListener('focus', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
    }
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  const allowed = useMemo(() => {
    if (!mock) return null
    const step = currentStep(mock)
    return new Set(step ? step.gameKeys.map(g => mockGamePathname(g, { step })) : [])
  }, [mock])

  // The assessment's own pages are always open. The test it is waiting on is open only to the tab
  // that was sent there from the assessment screen (see grantGamePath).
  const isAllowed = useCallback((pathname, state = null) => {
    if (!allowed) return true
    if (pathname === MOCK_ROUTE || pathname.startsWith(`${MOCK_ROUTE}/`)) return true
    return allowed.has(pathname) && isGrantedGamePath(pathname, state)
  }, [allowed])

  // Layer 1: links.
  useEffect(() => {
    if (!mock) return undefined
    const onClick = (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = e.target?.closest?.('a[href]')
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return
      let url
      try { url = new URL(a.href, window.location.href) } catch { return }
      if (url.origin !== window.location.origin) return
      if (isAllowed(url.pathname)) return
      e.preventDefault()
      e.stopPropagation()
      setLeaveTo(`${url.pathname}${url.search}${url.hash}`)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [mock, isAllowed])

  // Layer 2: arrivals. Layout effect, so the page it bounces from never gets to paint.
  useLayoutEffect(() => {
    if (!mock || isAllowed(location.pathname, location.state)) return
    // No question here. Arriving somewhere closed (a new tab, the back button, a typed address) is
    // not a decision to leave, and asking "Leave the assessment?" at that moment read as a question
    // about the tab: answering it ended a player's mock by accident. They land on the assessment,
    // which says it is still running; leaving is only ever asked about when they click to go.
    navigate(MOCK_ROUTE, { replace: true, state: { mockReturned: true } })
  }, [mock, location.pathname, location.search, location.state, isAllowed, navigate])

  // "Leave assessment" buttons on the assessment's own pages ask through the same dialog.
  useEffect(() => onLeaveRequest((to) => { setLeaveSource('button'); setLeaveTo(to ?? '/cbat') }), [])

  const stay = () => { setLeaveTo(null); setLeaveSource(null) }
  const leave = async () => {
    if (!mock) { setLeaveTo(null); return }
    setLeaving(true)
    try {
      // Where the leave came from, kept on the mock so an unexpected one can be traced.
      await apiFetch(mockUrl(API, `/${mock.id}/abandon`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: leaveSource ?? 'link', from: location.pathname, to: leaveTo }),
      })
    } catch { /* the server will close it on the idle limit regardless */ }
    captureEvent('cbat_mock_left', { testsDone: mock.testsDone, testsTotal: mock.testsTotal })
    const to = leaveTo
    setActiveMock(null)
    clearGrantedGamePath()
    setLeaving(false)
    setLeaveTo(null)
    setLeaveSource(null)
    navigate(to || '/cbat')
  }

  if (!mock || leaveTo == null) return null

  return (
    <Overlay zIndex={10000} onDismiss={stay} lockBodyScroll className="flex items-center justify-center px-4" data-testid="cbat-mock-leave">
      <div role="dialog" aria-modal="true" aria-labelledby="cbat-mock-leave-title" className="w-full max-w-sm bg-surface border border-slate-200 rounded-2xl p-5 card-shadow">
        <h2 id="cbat-mock-leave-title" className="text-lg font-extrabold text-slate-900 mb-2">Leave the assessment?</h2>
        <p className="text-sm text-slate-600 mb-2">
          The rest of SkyWatch is closed while your Mock Assessment is running.
        </p>
        <p className="text-sm text-slate-600 mb-5">
          If you leave, the scores from the tests you have finished are saved, but this assessment
          ends. To sit it again you will need to start a new one.
        </p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={stay}
            autoFocus
            className="w-full px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg text-sm transition-colors"
            data-testid="cbat-mock-stay"
          >
            Stay in the assessment
          </button>
          <button
            type="button"
            onClick={leave}
            disabled={leaving}
            className="w-full px-4 py-2.5 border border-slate-300 text-slate-600 hover:text-slate-800 font-bold rounded-lg text-sm transition-colors disabled:opacity-50"
            data-testid="cbat-mock-confirm-leave"
          >
            {leaving ? 'Leaving…' : 'Leave the assessment'}
          </button>
        </div>
      </div>
    </Overlay>
  )
}
