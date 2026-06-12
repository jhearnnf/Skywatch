// Single source of truth for which aircraft are available offline.
//
// Only these two ship/cache their assets for offline CBAT play:
//   • Hawk T2 — hardcoded trainer for Plane Turn's Trace 1 mode.
//   • Eurofighter Typhoon FGR4 — the default frontline fighter (DPT, Target,
//     Flag, Plane Turn aircraft select).
//
// `title` MUST slugify (via titleToSlug) to `slug`, and `slug` MUST equal the
// GLB filename (minus .glb) — that's how getModelUrl/has3DModel resolve the
// bundled model. These titles are used as a STATIC fallback so the offline
// roster always offers both aircraft even on a fresh install that never cached
// the dynamic /aircraft-cutouts roster (the GLBs are always bundled).
export const OFFLINE_AIRCRAFT = [
  { title: 'Eurofighter Typhoon FGR4', slug: 'eurofighter typhoon fgr4', glb: 'eurofighter typhoon fgr4.glb' },
  { title: 'Hawk T2',                  slug: 'hawk t2',                  glb: 'hawk t2.glb' },
]

export const OFFLINE_AIRCRAFT_SLUGS = OFFLINE_AIRCRAFT.map((a) => a.slug)
export const OFFLINE_AIRCRAFT_GLBS  = OFFLINE_AIRCRAFT.map((a) => a.glb)
