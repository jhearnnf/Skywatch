// Which craft the player flies in ACT.
//
// The game itself is unchanged by this: the flight model, the collision test and
// every score still work off a point with BALL_RADIUS around it. All this picks
// is what gets DRAWN at that point — the original white ball, or one of the
// aircraft GLBs in public/models/. Purely cosmetic, deliberately, so a player
// swapping models can never be flying an easier or harder game than the
// leaderboard above them.
//
// The list is built the same way Trace Practise 3D builds its aircraft grid:
// from the live roster, filtered to the aircraft that actually have a model.

import { has3DModel, getModelUrl, titleToSlug } from '../../data/aircraftModels'

export const ACT_CRAFT_BALL = 'ball'

const ACT_CRAFT_KEY = 'sw_cbat_act_craft'

// The Chinook's rotor blades are broken in our GLB — they render as a smeared
// disc of stretched geometry, which is fine at the distance the other games put
// it at and very much not fine 1.6 units in front of a chase camera. Excluded
// until the model is re-exported.
const EXCLUDED_SLUGS = new Set(['chinook hc6 6a'])

// The default option, always first and always available — it needs no roster,
// no network and no model file.
export const BALL_OPTION = { id: ACT_CRAFT_BALL, title: 'Ball', cutoutUrl: null, modelUrl: null }

// roster — entries from getAircraftRoster('aircraft-cutouts'), i.e.
// { briefId, title, cutoutUrl }. Anything without a GLB is dropped, because the
// picker offering an aircraft that then fails to load reads as a broken game.
export function actCraftOptions(roster) {
  const aircraft = (roster || [])
    .filter(a => a?.title)
    .filter(a => has3DModel(a.briefId, a.title))
    .filter(a => !EXCLUDED_SLUGS.has(titleToSlug(a.title)))
    .map(a => ({
      id: titleToSlug(a.title),
      title: a.title,
      cutoutUrl: a.cutoutUrl || null,
      modelUrl: getModelUrl(a.briefId, a.title),
    }))
  return [BALL_OPTION, ...aircraft]
}

// The model URL to draw, or null for the ball. Falls back to the ball whenever
// the stored choice isn't in the list any more — an aircraft can leave the
// roster, and going offline cuts it down to the two precached models.
export function craftModelUrl(options, id) {
  return options.find(o => o.id === id)?.modelUrl || null
}

export function readStoredActCraft() {
  try {
    return localStorage.getItem(ACT_CRAFT_KEY) || ACT_CRAFT_BALL
  } catch {
    return ACT_CRAFT_BALL
  }
}

export function storeActCraft(id) {
  try { localStorage.setItem(ACT_CRAFT_KEY, String(id || ACT_CRAFT_BALL)) } catch { /* storage unavailable */ }
}
