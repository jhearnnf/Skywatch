import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './main.css'
import App from './App.jsx'
import { initPostHog } from './lib/posthog'

initPostHog()

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
