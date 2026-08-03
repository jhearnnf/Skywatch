import { useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import Overlay from '../../ui/Overlay'
import { pause } from '../state/pauseStore'
import { useSlimMode } from '../../../hooks/useSlimMode'
import { getHangarMusicVolume, setHangarMusicVolume } from '../../../utils/sound'
import { refreshHangarMusicVolume } from '../../../utils/world3d/hangarMusic'

// In-world pause menu. The frame loop is frozen while this is open (see
// World3D + CharacterController), so the hangar holds still behind it. The
// music keeps playing on purpose — you can't set a music level you can't hear.

export default function PauseMenu() {
  const paused = useSyncExternalStore(pause.subscribe, pause.get, () => false)
  const navigate = useNavigate()
  const slim = useSlimMode()
  const [musicVol, setMusicVol] = useState(() => getHangarMusicVolume())

  if (!paused) return null

  const onMusicChange = (v) => {
    setMusicVol(v)
    setHangarMusicVolume(v)
    // Apply to the track that's playing right now rather than on the next visit.
    refreshHangarMusicVolume()
  }

  const quit = () => {
    pause.set(false)
    // Whichever home the current mode has — slim clients have no /home.
    navigate(slim ? '/cbat' : '/home')
  }

  return (
    // Portals to <body>, so clicks on the menu never reach the hangar container's
    // click-to-lock handler.
    <Overlay zIndex={40} className="flex items-center justify-center backdrop-blur-sm">
      <div className="bg-surface-raised border border-brand-300 rounded-xl p-6 max-w-sm w-[90vw] shadow-2xl">
        <h2 className="text-lg font-bold text-brand-800 mb-1">Paused</h2>
        <p className="text-xs text-slate-600 mb-5">The hangar is on hold</p>

        <label className="block mb-5">
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-sm font-semibold text-slate-700">Music</span>
            <span className="text-xs text-slate-500 tabular-nums">{musicVol}%</span>
          </div>
          <input
            type="range"
            min={0} max={100}
            value={musicVol}
            onChange={e => onMusicChange(Number(e.target.value))}
            className="w-full accent-brand-500 cursor-pointer"
            aria-label="Hangar music volume"
          />
        </label>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => pause.set(false)}
            className="px-4 py-2 rounded-lg bg-brand-500 text-white font-semibold hover:bg-brand-600 transition-colors"
          >
            Resume
          </button>
          <button
            type="button"
            onClick={quit}
            className="px-4 py-2 rounded-lg border border-brand-300 text-brand-700 font-semibold hover:bg-brand-50 transition-colors"
          >
            Quit game
          </button>
        </div>

        <p className="mt-4 text-[11px] text-slate-500 text-center">
          Click the hangar to take back mouse look
        </p>
      </div>
    </Overlay>
  )
}
