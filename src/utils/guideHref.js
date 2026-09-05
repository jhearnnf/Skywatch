import { isNative } from './isNative'

// Where the CBAT guide lives, per platform.
//
// The guide is a standalone document in public/, not an app route. On the web it
// answers on a clean, extensionless URL — /cbat-guide — because vercel.json
// rewrites that path to the file in production and vite.config.js does the same
// in dev. The clean URL is the canonical one, the one in sitemap.xml and the one
// Google has crawled, so every anchor a crawler can see must keep pointing at it.
//
// The native app has no server to do that rewrite. Capacitor serves the bundled
// dist/ over https://localhost, so a request for /cbat-guide finds no such file,
// falls back to index.html and boots the SPA — which has no route for the path,
// so slim mode bounces it to /cbat. Tapping "Read the guide" appeared to do
// nothing (or to open the games menu). Native therefore asks for the file by its
// real name, which is in the bundle at android/app/src/main/assets/public/.
//
// Crawlers only ever see the web branch: isNative is false everywhere except
// inside the store binary, including during the build-time prerender.
export const CBAT_GUIDE_HREF = isNative ? '/cbat-guide.html' : '/cbat-guide'

// The app paints light status-bar text for its dark theme (main.jsx), and the
// guide is a cream document, so leaving for it left the clock and the signal
// icons white on near-white. Hand the status bar over before we go.
//
// Nothing sets it back, and nothing needs to: the guide is a full page
// navigation away from the SPA, so returning reboots the app and main.jsx runs
// again. Imported lazily so the web build and the tests never pull the plugin
// in just to render a link.
//
// Returns the pending work so a test can await it. Nothing at a call site does:
// the navigation this precedes must not wait on a status-bar colour, and the
// WebView survives it either way.
// Both spellings of every guide we publish, and nothing else. The chat rail
// lists guides from the database, so it can carry links to documents we do not
// style and must not hand the status bar over for those.
//
// The international guides share the UK guide's stylesheet, so they are the
// same cream document and need the same handover. Adding a guide means adding
// its slug here as well.
export function isCbatGuideUrl(url) {
  return /^\/cbat-guide(-canada|-australia)?(\.html)?$/.test(url || '')
}

export function prepareGuideChrome() {
  if (!isNative) return Promise.resolve()
  return import('@capacitor/status-bar')
    .then(({ StatusBar, Style }) => StatusBar.setStyle({ style: Style.Light }))
    .catch(() => {})
}
