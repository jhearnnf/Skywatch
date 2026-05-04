import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './main.css'
import App from './App.jsx'
import { initPostHog } from './lib/posthog'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'

initPostHog()

if (Capacitor.isNativePlatform()) {
  StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {})
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {})
  if (Capacitor.getPlatform() === 'android') {
    StatusBar.setBackgroundColor({ color: '#06101e' }).catch(() => {})
  }
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
