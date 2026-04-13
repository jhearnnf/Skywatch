// Auto-discover .glb files in public/models/ at build time
const glbFiles = import.meta.glob('/public/models/*.glb', { eager: true, query: '?url' })

// Build a set of available model slugs from discovered files
const AVAILABLE_MODELS = new Set(
  Object.keys(glbFiles).map(path => {
    // path looks like "/public/models/f-35b lightning ii.glb"
    const filename = path.split('/').pop().replace(/\.glb$/, '')
    return filename.toLowerCase()
  })
)

// Maps briefId -> filename in public/models/
const MODEL_MAP = {
  // Add entries as .glb files become available
  // e.g. 'some-brief-id': 'eurofighter_typhoon_fgr4.glb'
}

function titleToSlug(title) {
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
