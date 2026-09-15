import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'

// Android hardware back button: step back through the app's history, or exit
// when there is nothing behind the current page. Registered once, at the root.
//
// Never from inside an embed. The guide iframes /embed/cbat/:id, which is this
// whole SPA, and a listener registered from the frame lands in the native App
// plugin all the same. Capacitor then hands every back press to a JS callback
// the guide document has no handler for, instead of falling back to
// webView.goBack(), and the reader is stuck on the guide until the app is
// killed. The frame has no navigation of its own to answer for, so it must not
// register at all.
//
// Reads the path from the window rather than the router because the frame's
// path never changes: this is a boot-time question.
export function useNativeBackButton() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    if (window.location.pathname.startsWith('/embed/')) return
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
}

export default useNativeBackButton
