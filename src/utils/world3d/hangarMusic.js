// Hangar lobby music controller.
//
// Loops "hangar lobby (repeat).mp3" for as long as the 3D Hangar world is on
// screen. Unlike the CBAT menu soundtrack there's no separate intro clip — the
// one file loops from the start.
//
// Driven from a single place (see the <HangarMusic> component, mounted by
// World3D): callers declare the zone rather than managing playback.
//
//   'lobby' → walking around the hangar → 100% volume
//    null   → anywhere else             → faded out & stopped
//
// Fades, presence gating (pause when the tab/window isn't in front) and the
// autoplay-blocked retry come from the shared createLoopingMusic factory —
// see src/utils/loopingMusic.js.

import { getMasterVolume, getHangarLobbyMusicSetting, getHangarMusicVolume } from '../sound'
import { createLoopingMusic } from '../loopingMusic'

const music = createLoopingMusic({
  repeatSrc: '/sounds/hangar lobby (repeat).mp3',
  // Pre-master zone volumes (0..1).
  zoneVolumes: { lobby: 1.0 },
  // The admin level is a ceiling; the player's own music slider (pause menu)
  // scales underneath it, and master volume applies on top of both.
  getSetting: () => {
    const admin = getHangarLobbyMusicSetting()
    return { volume: admin.volume * (getHangarMusicVolume() / 100), enabled: admin.enabled }
  },
  getMasterVolume: () => getMasterVolume(),
})

// Declare the current hangar zone. `zone` is 'lobby' | null.
export function updateHangarMusic(zone) {
  music.update(zone)
}

// Re-apply the playing track's gain after a master-volume change (Profile →
// Sound) so it responds at once rather than only on the next zone change.
export function refreshHangarMusicVolume() {
  music.refreshVolume()
}

// Test/HMR helper — hard reset without fades.
export function _resetHangarMusic() {
  music.reset()
}
