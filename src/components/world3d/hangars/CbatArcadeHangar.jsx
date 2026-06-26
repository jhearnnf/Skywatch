import { useNavigate } from 'react-router-dom'
import { CBAT_GAMES } from '../../../data/cbatGames'
import { useAppSettings } from '../../../context/AppSettingsContext'
import ArcadeCabinet from '../props/ArcadeCabinet'
import Interactable from '../interaction/Interactable'

// Cabinet slots laid out around the hangar interior. Local coordinates
// (relative to the hangar centre, which is 16 wide × 14 deep — so x ∈ [-8, 8],
// z ∈ [-7, 7] with the door on the front/-Z face). 14 slots — one per *visible*
// CBAT game (hidden games never get a cabinet). If the visible list ever grows
// beyond SLOTS.length, slots after the array end simply don't get a cabinet
// (no overflow, no crowding). hangarLayout.test.js asserts the slots keep up.

export const SLOTS = [
  // Back row, screens facing the door (-Z local). 5 cabinets.
  { x: -6, z: 5.5, rot: 0 },
  { x: -3, z: 5.5, rot: 0 },
  { x:  0, z: 5.5, rot: 0 },
  { x:  3, z: 5.5, rot: 0 },
  { x:  6, z: 5.5, rot: 0 },
  // Left wall, screens facing interior (+X). 4 cabinets.
  { x: -6.5, z:  4, rot: -Math.PI / 2 },
  { x: -6.5, z:  1, rot: -Math.PI / 2 },
  { x: -6.5, z: -2, rot: -Math.PI / 2 },
  { x: -6.5, z: -5, rot: -Math.PI / 2 },
  // Right wall, screens facing interior (-X). 4 cabinets.
  { x:  6.5, z:  4, rot:  Math.PI / 2 },
  { x:  6.5, z:  1, rot:  Math.PI / 2 },
  { x:  6.5, z: -2, rot:  Math.PI / 2 },
  { x:  6.5, z: -5, rot:  Math.PI / 2 },
  // Front wall, left of the doorway, screen facing interior (+Z). 1 cabinet.
  // Clear of the door gap (x ∈ [-2, 2]) and the z=-5 wall cabinets.
  { x: -5, z: -6, rot: Math.PI },
]

function isGameEnabled(game, cbatGameEnabled) {
  if (!game.path) return false
  if (!cbatGameEnabled) return true
  // cbatGameEnabled comes as a plain object from /api/settings; missing keys
  // are treated as enabled to match the backend's defensive behaviour.
  // Visualisation/Plane Turn split into 2D + 3D keys on the backend; treat
  // the combined cabinet as enabled if EITHER variant is enabled.
  if (game.key === 'visualisation') {
    return cbatGameEnabled['visualisation-2d'] !== false || cbatGameEnabled['visualisation-3d'] !== false
  }
  if (game.key === 'plane-turn') {
    return cbatGameEnabled['plane-turn-2d'] !== false || cbatGameEnabled['plane-turn-3d'] !== false || cbatGameEnabled['trace-1'] !== false
  }
  return cbatGameEnabled[game.key] !== false
}

export default function CbatArcadeHangar({ spec }) {
  const navigate = useNavigate()
  const { settings } = useAppSettings() ?? {}
  const cbatGameEnabled = settings?.cbatGameEnabled

  return (
    <>
      {CBAT_GAMES.filter(g => !g.hidden).slice(0, SLOTS.length).map((game, i) => {
        const slot = SLOTS[i]
        const enabled = isGameEnabled(game, cbatGameEnabled)
        return (
          <group key={game.key} position={[slot.x, 0, slot.z]}>
            <ArcadeCabinet broken={!enabled} game={game} rotation={slot.rot} />
            <Interactable
              id={`cbat-cabinet-${game.key}`}
              x={spec.center[0] + slot.x}
              z={spec.center[2] + slot.z}
              range={1.8}
              label={enabled ? `Play ${game.title}` : `${game.title} — Out of order`}
              disabled={!enabled}
              onActivate={enabled ? () => navigate(game.path) : undefined}
            />
          </group>
        )
      })}
    </>
  )
}
