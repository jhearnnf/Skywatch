import { OFFLINE_AIRCRAFT } from '../../lib/offlineAircraft'

// The inert stand-ins a demo-mounted game runs against. Kept out of
// demoHarness.jsx so that file exports only its component (fast refresh).

// Aircraft-select games (Target, DPT, Flag, Trace) fetch a roster before they
// can start. Serve the two aircraft whose GLB models are bundled in the build,
// so the 3D cards always have a model to fly. Titles must match OFFLINE_AIRCRAFT
// exactly — getModelUrl/has3DModel resolve the GLB from the title slug.
export const DEMO_ROSTER = OFFLINE_AIRCRAFT.map((a) => ({
  briefId: `demo-${a.slug}`,
  title: a.title,
  cutoutUrl: null,
}))

// Only `isAdmin` is ever read off `user` by the CBAT games; the rest of the
// shape exists so anything reading it defensively doesn't crash. A non-null
// user is required — several games skip their setup fetches when logged out.
export const DEMO_USER = { _id: 'demo-user', name: 'Demo', isAdmin: false }

const ROSTER_ENDPOINTS = ['/aircraft-cutouts', '/fighter-aircraft']

function demoResponseBody(url = '') {
  if (ROSTER_ENDPOINTS.some((e) => url.includes(e))) return { data: DEMO_ROSTER }
  // Everything else (personal bests, progress, result submissions) gets an
  // empty-but-successful payload. Games all guard on `d.data` before using it.
  return {}
}

// Resolving *successfully* is the point: submitCbatResult (src/lib/cbatOutbox.js)
// only queues a score into the offline IndexedDB outbox when the POST fails or
// 401s. An always-ok stub means a demo score can neither be submitted nor
// queued for a later flush.
export function createDemoApiFetch() {
  return async function demoApiFetch(url) {
    const body = demoResponseBody(String(url ?? ''))
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }
  }
}
