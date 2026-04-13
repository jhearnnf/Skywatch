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
