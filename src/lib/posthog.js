import posthog from 'posthog-js'

const KEY  = import.meta.env.VITE_POSTHOG_KEY
const HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://eu.i.posthog.com'

let initialized = false

// The CBAT guide (public/cbat-guide.html) is a static document with its own
// PostHog snippet, and it iframes a live /embed/cbat/<id> game beside every
// test it describes. Those frames load this same bundle, so left alone each
// one calls posthog.init() too. They do not start a session of their own — the
// distinct_id and session cookies are per-domain, so every frame joins the
// reader's session and registers in it as a separate *window*.
//
// A replay of one reader then holds ten windows, and the player cuts between
// the guide and a full-bleed close-up of a game the reader never looked at
// that closely, several times a minute. Nothing is lost by staying out: rrweb
// descends into same-origin iframes from the parent, so the guide's own
// recorder already captures each frame inline, once, in place on the page.
function isGuideEmbed() {
  return typeof window !== 'undefined' &&
         window.location.pathname.startsWith('/embed/')
}

export function initPostHog() {
  if (initialized || !KEY || isGuideEmbed()) return
  posthog.init(KEY, {
    api_host: HOST,
    // SPA-friendly: auto-capture pageviews on pushState/replaceState
    capture_pageview: 'history_change',
    capture_pageleave: true,
    autocapture: true,
    session_recording: {
      maskAllInputs: false,
      maskInputOptions: { password: true },
    },
    person_profiles: 'always',
  })
  initialized = true
}

export function identifyUser(user) {
  if (!initialized || !user?._id) return
  posthog.identify(user._id, {
    email:         user.email,
    username:      user.username,
    rank:          user.rank,
    totalAirstars: user.totalAirstars,
  })
}

export function resetPostHog() {
  if (!initialized) return
  posthog.reset()
}

export function captureEvent(name, props) {
  if (!initialized) return
  posthog.capture(name, props)
}

export { posthog }
