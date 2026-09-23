// Which aircraft the player flies in the Instruments Practise drill, under the
// SkyWatch theme. Built the way ACT's list is (actCraft.js): the live roster,
// filtered to aircraft with a working close-up GLB, because the chase camera
// sits close enough to show a broken model.
//
// Unlike ACT there is no ball: this drill is about flying an aircraft, so the
// Typhoon is the default and is always on the list, even offline or before the
// roster arrives. Purely cosmetic: every aircraft flies the same model.
//
// The Real CBAT theme never reads this. It always flies the red Hawk.

import { hasWorkingCloseupModel, getModelUrl, titleToSlug } from '../../data/aircraftModels'

const STORE_KEY = 'sw_cbat_instruments_craft'

export const DEFAULT_DRILL_CRAFT = {
  id: 'eurofighter typhoon fgr4',
  title: 'Eurofighter Typhoon FGR4',
  cutoutUrl: null,
  modelUrl: '/models/eurofighter typhoon fgr4.glb',
}

// roster: entries from getAircraftRoster('aircraft-cutouts'), { briefId, title, cutoutUrl }.
export function drillCraftOptions(roster) {
  const aircraft = (roster || [])
    .filter(a => a?.title)
    .filter(a => hasWorkingCloseupModel(a.briefId, a.title))
    .map(a => ({
      id: titleToSlug(a.title),
      title: a.title,
      cutoutUrl: a.cutoutUrl || null,
      modelUrl: getModelUrl(a.briefId, a.title),
    }))
  // The Typhoon is always there; take the roster's copy when it has one, for
  // its cutout tile.
  if (aircraft.some(a => a.id === DEFAULT_DRILL_CRAFT.id)) return aircraft
  return [DEFAULT_DRILL_CRAFT, ...aircraft]
}

// The model to fly. Falls back to the Typhoon if the stored choice has left the
// list (an aircraft leaving the roster, or going offline).
export function drillCraftUrl(options, id) {
  return options.find(o => o.id === id)?.modelUrl || DEFAULT_DRILL_CRAFT.modelUrl
}

export function readStoredDrillCraft() {
  try { return localStorage.getItem(STORE_KEY) || DEFAULT_DRILL_CRAFT.id } catch { return DEFAULT_DRILL_CRAFT.id }
}

export function storeDrillCraft(id) {
  try { localStorage.setItem(STORE_KEY, String(id || DEFAULT_DRILL_CRAFT.id)) } catch { /* storage unavailable */ }
}
