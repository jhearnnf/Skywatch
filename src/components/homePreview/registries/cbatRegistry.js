import { lazy } from 'react'

// Phase 3 will replace these placeholders with one scene per CBAT game.
// The registry is built dynamically from src/data/cbatGames.js (lifted from
// Cbat.jsx) so new CBAT games auto-appear here. For now: a single overview
// scene + stub placeholders so the second window renders end-to-end.
const CbatOverviewScene = lazy(() => import('../scenes/cbat/CbatOverviewScene'))
const CbatTargetScene   = lazy(() => import('../scenes/cbat/CbatTargetScene'))
const CbatAntScene      = lazy(() => import('../scenes/cbat/CbatAntScene'))
const CbatSymbolsScene  = lazy(() => import('../scenes/cbat/CbatSymbolsScene'))
const CbatCodeDuplicatesScene = lazy(() => import('../scenes/cbat/CbatCodeDuplicatesScene'))
const CbatAnglesScene      = lazy(() => import('../scenes/cbat/CbatAnglesScene'))
const CbatInstrumentsScene = lazy(() => import('../scenes/cbat/CbatInstrumentsScene'))
const CbatPlaneTurnScene   = lazy(() => import('../scenes/cbat/CbatPlaneTurnScene'))
const CbatFlagScene        = lazy(() => import('../scenes/cbat/CbatFlagScene'))
const CbatVisualisation2DScene = lazy(() => import('../scenes/cbat/CbatVisualisation2DScene'))
const CbatDptScene         = lazy(() => import('../scenes/cbat/CbatDptScene'))
const CbatActScene         = lazy(() => import('../scenes/cbat/CbatActScene'))

// Mapping from CBAT_GAMES key (in src/data/cbatGames.js) → scene component.
// If a key has no entry here it is silently skipped — useful for the 2
// unimplemented placeholders (visualisation-3d, dad).
const SCENE_BY_KEY = {
  target:            CbatTargetScene,
  ant:               CbatAntScene,
  symbols:           CbatSymbolsScene,
  'code-duplicates': CbatCodeDuplicatesScene,
  angles:            CbatAnglesScene,
  instruments:       CbatInstrumentsScene,
  'plane-turn':      CbatPlaneTurnScene,
  flag:              CbatFlagScene,
  'visualisation-2d': CbatVisualisation2DScene,
  dpt:               CbatDptScene,
  act:               CbatActScene,
}

const TITLE_BY_KEY = {
  target:            'HUNT THE TARGET',
  ant:               'CRUNCH THE NUMBERS',
  symbols:           'SPOT THE SYMBOL',
  'code-duplicates': 'COUNT THE CODE',
  angles:            'JUDGE THE ANGLE',
  instruments:       'READ THE COCKPIT',
  'plane-turn':      'PLAN YOUR TURN',
  flag:              'PUSH THE LIMITS',
  'visualisation-2d':'WELD THE SHAPES',
  dpt:               'VECTOR THE FIGHTERS',
  act:               'TUNE YOUR EAR',
}

export function buildCbatScenes(settings, user, cbatGames) {
  const s = settings ?? {}
  const isAdmin = !!user?.isAdmin
  const cbatGameEnabled = s.cbatGameEnabled ?? {}
  const masterOn = !!s.cbatEnabled

  // Master CBAT toggle off → hide the window entirely
  if (!masterOn && !isAdmin) return []
  if (!Array.isArray(cbatGames)) return []

  // Intro overview scene first
  const scenes = [{
    id: 'cbat-overview',
    title: 'PRACTICE CBAT',
    subtitle: 'Eleven targeted training games',
    durationMs: 3500,
    accent: '#fbbf24',
    Component: CbatOverviewScene,
  }]

  for (const game of cbatGames) {
    const Component = SCENE_BY_KEY[game.key]
    if (!Component) continue              // no scene built (e.g. coming-soon)
    if (!game.path) continue              // game has no live route — skip
    const enabled = cbatGameEnabled[game.key] !== false
    if (!enabled && !isAdmin) continue    // admin disabled it for non-admins
    scenes.push({
      id: `cbat-${game.key}`,
      title: TITLE_BY_KEY[game.key] ?? game.title.toUpperCase(),
      subtitle: game.title,
      durationMs: 2500,
      accent: '#fbbf24',
      Component,
      meta: { gameKey: game.key },
    })
  }

  return scenes
}
