// CBAT menu music controller.
//
// Plays the menu soundtrack across the CBAT selection + instructions screens
// (and the slim landing):
//   1. "cbat menu (start).mp3" plays once, then
//   2. "cbat menu (repeat).mp3" loops continuously.
//
// The soundtrack is a *zone* feature driven from one place (see the
// <CbatMenuMusic> component). Callers don't manage playback directly — they
// declare which zone the user is in and the controller cross-fades / starts /
// stops to match:
//
//   'menu'         → CBAT game-selection page / slim landing → 100% volume
//   'instructions' → a game's pre-play / results screen      →  25% volume
//    null          → in a game, or off the CBAT area         → faded out & stopped
//
// Fades, presence gating and the autoplay-blocked retry all live in the shared
// createLoopingMusic factory — see src/utils/loopingMusic.js for the details
// (the hangar lobby track uses the same machinery).

import { getMasterVolume, getCbatMenuMusicSetting } from '../sound'
import { createLoopingMusic } from '../loopingMusic'

const music = createLoopingMusic({
  startSrc:  '/sounds/cbat menu (start).mp3',
  repeatSrc: '/sounds/cbat menu (repeat).mp3',
  // Pre-master zone volumes (0..1).
  zoneVolumes: { menu: 1.0, instructions: 0.25 },
  getSetting: () => getCbatMenuMusicSetting(),
  getMasterVolume: () => getMasterVolume(),
})

// Declare the current CBAT zone. `zone` is 'menu' | 'instructions' | null.
export function updateCbatMusic(zone) {
  music.update(zone)
}

// Re-apply the playing track's gain after a master-volume change (Profile →
// Sound) so it responds at once rather than only on the next zone change.
export function refreshCbatMusicVolume() {
  music.refreshVolume()
}

// Test/HMR helper — hard reset without fades.
export function _resetCbatMusic() {
  music.reset()
}
