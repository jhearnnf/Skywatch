import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './main.css'
import App from './App.jsx'
import { initPostHog } from './lib/posthog'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import { setUpdateSW } from './utils/appUpdate'
import { markUpdateReady, startUpdateChecks } from './utils/staleBuild'
import { recoverFromChunkError } from './utils/chunkLoadRecovery'
import { getActiveMock } from './lib/cbatMockSession'
import { preparePublicPagePreview } from './utils/publicPagePreview'

initPostHog()

if (Capacitor.isNativePlatform()) {
  StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {})
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {})
  if (Capacitor.getPlatform() === 'android') {
    StatusBar.setBackgroundColor({ color: '#06101e' }).catch(() => {})
  }
}

// Register the PWA service worker for offline support — web only (Capacitor
// already serves the bundle from the device) and only in production builds.
//
// The returned updateSW is handed to appUpdate so Profile's "Get the latest
// version" button can ask the worker to check for a new deploy before it
// clears the caches. Without this it would be discarded and the button would
// have only the blunt instrument.
//
// A new build does not reload the page the moment it activates (that could be mid-game): it is
// marked ready and loaded at the next safe page change, and checked for every 15 minutes since a
// tab left open never re-checks on its own. See utils/staleBuild.js.
if (!Capacitor.isNativePlatform() && import.meta.env.PROD) {
  import('virtual:pwa-register')
    .then(({ registerSW }) => setUpdateSW(registerSW({
      immediate: true,
      onNeedReload: markUpdateReady,
      onRegisteredSW: (_url, registration) => startUpdateChecks({ registration: registration ?? null }),
      onRegisterError: () => startUpdateChecks(),
    })))
    .catch(() => { if ('serviceWorker' in navigator) startUpdateChecks() /* compare against /version.json instead */ })
  // No service worker support at all: registerSW does nothing and calls nothing back.
  if (!('serviceWorker' in navigator)) startUpdateChecks()
}

// A deploy renamed the code this tab still asks for. See utils/chunkLoadRecovery.js.
window.addEventListener('vite:preloadError', () => {
  recoverFromChunkError({
    storage: sessionStorage,
    mockActive: !!getActiveMock(),
    reload: () => window.location.reload(),
    // A full load, not a router push: the point is to fetch the new build.
    goTo: path => window.location.replace(path),
  })
})

// React 19 hoists Helmet's metadata natively. Remove the initial document's
// marked fallback first, so it cannot leave a second title/canonical behind.
document.head.querySelectorAll('[data-static-seo]').forEach(node => node.remove())
preparePublicPagePreview()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
