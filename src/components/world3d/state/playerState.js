// Singleton mutable player animation state. Written every frame by
// CharacterController (based on movement / grounded), read every frame by
// PlayerModel to cross-fade the matching clip. Kept outside React state to
// avoid per-frame re-renders — same pattern as inputStore.
//
// anim — one of 'Idle' | 'Walk' | 'Run' | 'Jump' (must match the GLB clip names)

export const playerState = {
  anim: 'Idle',
}
