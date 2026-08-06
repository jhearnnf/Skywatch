// Community soundtrack controller.
//
// One looping track across the Community pages. Unlike the CBAT menu music
// there is no separate intro clip — the file loops from the start, so only
// `repeatSrc` is given and createLoopingMusic handles the rest.
//
// Zones:
//   'community' → anywhere under /chat → normal volume
//    null       → off Community        → faded out & stopped
//
// Volume is the product of three things, all read live:
//   • the admin level for this track  (AppSettings.volumeCommunityMusic)
//   • the admin on/off switch          (AppSettings.soundEnabledCommunityMusic)
//   • the player's own master volume   (Profile → Sound)
// so turning the app volume down in Profile quietens this too, and an admin
// muting it silences it for everyone. Fades, presence gating (pause on tab
// switch / minimise) and the autoplay-blocked retry all live in the shared
// factory — see src/utils/loopingMusic.js.

import { getMasterVolume, getCommunityMusicSetting } from './sound'
import { createLoopingMusic } from './loopingMusic'

const music = createLoopingMusic({
  repeatSrc: '/sounds/community (repeat).mp3',
  // Pre-master zone volume (0..1). Chat is a reading surface, so the bed sits
  // below the CBAT menu's 1.0 — it should not compete with the text.
  zoneVolumes: { community: 0.7 },
  getSetting: () => getCommunityMusicSetting(),
  getMasterVolume: () => getMasterVolume(),
})

// Declare the current zone. `zone` is 'community' | null.
export function updateCommunityMusic(zone) {
  music.update(zone)
}

// Re-apply gain after a volume change (Profile → Sound, or the Community
// console) so it responds at once rather than on the next navigation.
export function refreshCommunityMusicVolume() {
  music.refreshVolume()
}

// Test/HMR helper — hard reset without fades.
export function _resetCommunityMusic() {
  music.reset()
}
