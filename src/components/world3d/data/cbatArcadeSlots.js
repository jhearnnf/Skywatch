// Cabinet slots laid out around the hangar interior. Local coordinates
// (relative to the hangar centre, which is 16 wide × 14 deep — so x ∈ [-8, 8],
// z ∈ [-7, 7] with the door on the front/-Z face). Hidden games never get a
// cabinet. If the visible list ever grows beyond SLOTS.length, slots after the
// array end simply don't get one (no overflow, no crowding) — which is quiet
// enough to miss, so hangarLayout.test.js asserts the slots keep up. It had
// fallen two behind by the time RTT was added, and FOUR behind when SIT, SLT,
// VLT, MATF and Vigilance landed: four of the five new games had no cabinet in
// here at all.
//
// 23 slots for 22 visible games, so there is one spare. The next game added
// needs a slot added here with it — hangarLayout.test.js will say so.
//
// A cabinet's footprint is 1.4 wide × 1.0 deep (see ArcadeCabinet), which is
// what every gap below is worked against. The rows are packed tighter than they
// were to make room; `cabinetFootprint` in the test walks the whole set and
// fails on any overlap, so the spacing is checked rather than eyeballed.
//
// Wall-hugging only, deliberately: cabinets carry no collider, so an island row
// in the middle of the floor would be something the player walks straight
// through. Against a wall they never have the chance.

export const SLOTS = [
  // Back row, screens facing the door (-Z local). 7 cabinets, 2.2 apart.
  { x: -6.6, z: 5.5, rot: 0 },
  { x: -4.4, z: 5.5, rot: 0 },
  { x: -2.2, z: 5.5, rot: 0 },
  { x:  0,   z: 5.5, rot: 0 },
  { x:  2.2, z: 5.5, rot: 0 },
  { x:  4.4, z: 5.5, rot: 0 },
  { x:  6.6, z: 5.5, rot: 0 },
  // Left wall, screens facing interior (+X). 6 cabinets, 2.0 apart. The topmost
  // stops at z = 4 so it stays clear of the back row rounding the corner.
  { x: -6.5, z:  4, rot: -Math.PI / 2 },
  { x: -6.5, z:  2, rot: -Math.PI / 2 },
  { x: -6.5, z:  0, rot: -Math.PI / 2 },
  { x: -6.5, z: -2, rot: -Math.PI / 2 },
  { x: -6.5, z: -4, rot: -Math.PI / 2 },
  { x: -6.5, z: -6, rot: -Math.PI / 2 },
  // Right wall, screens facing interior (-X). 6 cabinets, mirrored.
  { x:  6.5, z:  4, rot:  Math.PI / 2 },
  { x:  6.5, z:  2, rot:  Math.PI / 2 },
  { x:  6.5, z:  0, rot:  Math.PI / 2 },
  { x:  6.5, z: -2, rot:  Math.PI / 2 },
  { x:  6.5, z: -4, rot:  Math.PI / 2 },
  { x:  6.5, z: -6, rot:  Math.PI / 2 },
  // Front wall, either side of the doorway, screens facing interior (+Z).
  // 4 cabinets, all clear of the door gap (x ∈ [-2, 2]) and of the z = -6 wall
  // cabinets beside them.
  { x: -5,   z: -6, rot: Math.PI },
  { x: -3,   z: -6, rot: Math.PI },
  { x:  3,   z: -6, rot: Math.PI },
  { x:  5,   z: -6, rot: Math.PI },
]

// Footprint of the cabinet at a slot, as an axis-aligned box in hangar-local
// space. Rotating it by ±90° swaps width and depth. Exported for the layout
// test — packing the rows tighter is only safe if something checks it.
export const CABINET_W = 1.4
export const CABINET_D = 1.0

export function cabinetFootprint(slot) {
  const turned = Math.abs(Math.round(Math.sin(slot.rot))) === 1
  const halfX = (turned ? CABINET_D : CABINET_W) / 2
  const halfZ = (turned ? CABINET_W : CABINET_D) / 2
  return { minX: slot.x - halfX, maxX: slot.x + halfX, minZ: slot.z - halfZ, maxZ: slot.z + halfZ }
}
