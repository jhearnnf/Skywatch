import { useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'

// Is the user actually here, looking at the app?
//
// "Present" means the page is visible AND the window has focus — so locking the
// phone, switching tab/app, minimising, or clicking into another window all drop
// presence, and coming back restores it.
//
// The signal set mirrors the CBAT menu-music controller (src/utils/cbat/
// menuMusic.js): event-driven rather than polling document.hasFocus(), so it's
// deterministic and testable. On native we also listen to Capacitor's
// appStateChange, which is the reliable background signal on Android/iOS where
// a screen lock doesn't always produce a visibilitychange in the WebView.
//
// Returns both the state (for rendering) and a ref (for rAF loops and other
// callbacks that must not re-subscribe on every change).
export default function usePagePresence() {
  const [present, setPresent] = useState(true)
  const presentRef = useRef(true)

  useEffect(() => {
    let cancelled = false
    let visible = true
    let focused = true
    try { visible = document.visibilityState !== 'hidden' } catch { visible = true }

    const reconcile = () => {
      const now = visible && focused
      if (now === presentRef.current) return
      presentRef.current = now
      setPresent(now)
    }

    const onVisibility = () => {
      try { visible = document.visibilityState !== 'hidden' } catch { visible = true }
      reconcile()
    }
    const onPageHide = () => { visible = false; reconcile() }
    const onFocus    = () => { focused = true;  reconcile() }
    const onBlur     = () => { focused = false; reconcile() }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)

    // Native app background/foreground. The listener registers asynchronously,
    // so a fast unmount has to be able to tear down a handle that doesn't exist
    // yet — hence the cancelled flag.
    let removeNative = null
    if (Capacitor.isNativePlatform()) {
      import('@capacitor/app')
        .then(({ App }) => Promise.resolve(App.addListener('appStateChange', ({ isActive }) => {
          visible = isActive
          focused = isActive
          reconcile()
        })))
        .then((handle) => {
          if (cancelled) { try { handle?.remove?.() } catch { /* already torn down */ } return }
          removeNative = () => { try { handle?.remove?.() } catch { /* already torn down */ } }
        })
        .catch(() => {})
    }

    // The page can already be hidden on mount (restored background tab).
    reconcile()

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      removeNative?.()
    }
  }, [])

  return { present, presentRef }
}
