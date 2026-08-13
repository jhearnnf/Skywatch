import { useNavigate } from 'react-router-dom'
import { CBAT_GAMES } from '../../../data/cbatGames'
import { useAppSettings } from '../../../context/AppSettingsContext'
import ArcadeCabinet from '../props/ArcadeCabinet'
import Interactable from '../interaction/Interactable'
// Slot geometry lives in data/ alongside the other layout tables, so this file
// exports nothing but a component (and Fast Refresh keeps working).
import { SLOTS } from '../data/cbatArcadeSlots'

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
