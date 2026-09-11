import glbFilenames from 'virtual:public-models'

const AVAILABLE_MODELS = new Set(
  glbFilenames.map(f => f.replace(/\.glb$/i, '').toLowerCase())
)

// Maps briefId -> filename in public/models/
const MODEL_MAP = {
  // Add entries as .glb files become available
  // e.g. 'some-brief-id': 'eurofighter_typhoon_fgr4.glb'
}

export function titleToSlug(title) {
  return title.toLowerCase().replace(/[^a-z0-9\-]+/g, ' ').trim()
}

export function getModelUrl(briefId, title) {
  if (MODEL_MAP[briefId]) return `/models/${MODEL_MAP[briefId]}`
  return `/models/${titleToSlug(title)}.glb`
}

export function has3DModel(briefId, title) {
  if (MODEL_MAP[briefId]) return true
  return AVAILABLE_MODELS.has(titleToSlug(title))
}

// The Chinook's rotor blades are broken in our GLB — they render as a smeared
// disc of stretched geometry. Fine at the distance a normal top-down view puts
// it at, not fine when a game frames a close-up crop (ACT's chase cam, Target's
// scan-panel sliver). Shared here so every close-up view excludes it the same
// way, rather than each game keeping its own copy of this list.
const BROKEN_CLOSEUP_SLUGS = new Set(['chinook hc6 6a'])

export function hasWorkingCloseupModel(briefId, title) {
  return has3DModel(briefId, title) && !BROKEN_CLOSEUP_SLUGS.has(titleToSlug(title))
}
