// Single source of truth for which aircraft are available offline.
//
// Only these two ship/cache their assets for offline CBAT play:
//   • Hawk T2 — hardcoded trainer for Plane Turn's Trace 1 mode.
//   • Eurofighter Typhoon FGR4 — the default frontline fighter (DPT, Target,
//     Flag, Plane Turn aircraft select).
//
// The GLB models are tiny (~50–70 KB) and bundled in the build; this list also
// drives the PWA precache (GLBs) and the offline roster filter (slugs). The
// slugs MUST match titleToSlug() output from src/data/aircraftModels.js.

export const OFFLINE_AIRCRAFT_SLUGS = ['eurofighter typhoon fgr4', 'hawk t2']

export const OFFLINE_AIRCRAFT_GLBS = [
  'eurofighter typhoon fgr4.glb',
  'hawk t2.glb',
]
