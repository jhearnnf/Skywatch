import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './main.css'
import App from './App.jsx'
import { initPostHog } from './lib/posthog'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import { setUpdateSW } from './utils/appUpdate'

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
if (!Capacitor.isNativePlatform() && import.meta.env.PROD) {
  import('virtual:pwa-register')
    .then(({ registerSW }) => setUpdateSW(registerSW({ immediate: true })))
    .catch(() => { /* SW unavailable — app still works online */ })
}

window.addEventListener('vite:preloadError', () => {
  if (!sessionStorage.getItem('skywatch-reload-on-preload-error')) {
    sessionStorage.setItem('skywatch-reload-on-preload-error', '1')
    window.location.reload()
  }
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
