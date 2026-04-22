import posthog from 'posthog-js'

const KEY  = import.meta.env.VITE_POSTHOG_KEY
const HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://eu.i.posthog.com'

let initialized = false

export function initPostHog() {
  if (initialized || !KEY) return
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
