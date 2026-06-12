import glbFilenames from 'virtual:public-models'

// Derive the aircraft list from the Vite virtual manifest (same source the
// rest of the app uses) so adding a new .glb to public/models/ surfaces a
// new plinth automatically — no code change required.
//
// Slot grid: two rows of 4 aircraft along the long axis of the bay. The bay
// is 16 wide × 14 deep (local coords), so we get plenty of clearance between
// plinths for the agent to walk around.

const SLOTS = [
  // Back row (closer to back wall)
  { x: -6, z:  4 },
  { x: -2, z:  4 },
  { x:  2, z:  4 },
  { x:  6, z:  4 },
  // Front row (closer to door)
  { x: -6, z: -2 },
  { x: -2, z: -2 },
  { x:  2, z: -2 },
  { x:  6, z: -2 },
]

function prettify(slug) {
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function getAircraftPlacements() {
  const titles = glbFilenames
    .filter(f => f.toLowerCase().endsWith('.glb'))
    .map(f => f.replace(/\.glb$/i, ''))
    .sort()
  return titles.slice(0, SLOTS.length).map((title, i) => ({
    slug: title,
    title: prettify(title),
    modelUrl: `/models/${title}.glb`,
    slot: SLOTS[i],
  }))
}
