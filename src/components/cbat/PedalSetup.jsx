import { useCallback, useEffect, useRef, useState } from 'react'
import { listPads, loadPedalProfile, savePedalProfile, clearPedalProfile } from '../../utils/cbat/gamepad'
import { createPedalCalibration, readPedalAxis } from '../../utils/cbat/pedals'
import { AxisBar } from './StickSetup'

// Rudder pedal panel for the one CBAT game flown on them, SMA. Sits under the
// joystick cabinet in the rail and is styled as the same machine.
//
// Like the joystick panel it LEARNS rather than assumes: the player rests
// their feet, pushes right, pushes left, and pedals.js works out which device
// and which axis that was. Unlike the joystick panel there is no default
// mapping to fly on before that. Uncalibrated pedals are not read at all,
// because a guessed axis on a pedal set is a toe brake steering the dot and
// nothing about that looks broken until a run is lost to it.
//
// Same attract mode as the joystick cabinet: NO PEDALS DETECTED snaps in
// amber while nothing is set up, PEDALS DETECTED! gets the slow blue pulse
// once a set is. A quieter waiting state was tried and read as the panel
// being switched off next to the joystick one; the user wants the two
// cabinets to feel like the same machine.

const WAKE_HINT = 'Not seeing them? Click this page, then press a pedal all the way down. Browsers hide a device until it is used.'

export default function PedalSetup({ title = 'Pedals' }) {
  const [view, setView] = useState({ padCount: 0, id: null, x: 0, live: {} })
  const [calibrating, setCalibrating] = useState(false)
  const [step, setStep] = useState(null)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)

  const calRef = useRef(null)
  const viewRef = useRef(view)

  useEffect(() => {
    let raf = null
    let lastPush = 0

    const frame = (now) => {
      raf = requestAnimationFrame(frame)
      const pads = listPads()
      const cal = calRef.current
      if (cal) cal.observe(pads)

      // Redrawn at about 15 Hz, like the joystick panel. Nothing here is worth
      // sixty renders a second.
      if (now - lastPush < 66) return
      lastPush = now

      let id = null
      let x = 0
      for (const p of pads) {
        const prof = loadPedalProfile(p.id)
        if (prof) { id = p.id; x = readPedalAxis(p, prof); break }
      }
      const live = cal ? cal.live() : {}
      const next = { padCount: pads.length, id, x, live }
      const prev = viewRef.current
      const same = prev.padCount === next.padCount
        && prev.id === next.id
        && Math.abs(prev.x - next.x) < 0.01
        && JSON.stringify(prev.live) === JSON.stringify(next.live)
      if (same) return
      viewRef.current = next
      setView(next)
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  const start = useCallback(() => {
    if (!listPads().length) { setError('No pedals detected yet.'); return }
    const cal = createPedalCalibration()
    calRef.current = cal
    setError(null)
    setSaved(false)
    setStep(cal.step())
    setCalibrating(true)
  }, [])

  const cancel = useCallback(() => {
    calRef.current = null
    setCalibrating(false)
    setStep(null)
  }, [])

  const capture = useCallback(() => {
    const cal = calRef.current
    if (!cal) return
    cal.commit()
    if (!cal.done()) { setStep(cal.step()); return }
    const out = cal.result()
    calRef.current = null
    setCalibrating(false)
    setStep(null)
    if (!out.ok) { setError(out.reason); return }
    savePedalProfile(out.profile)
    setError(null)
    setSaved(true)
  }, [])

  const forget = useCallback(() => {
    if (view.id) clearPedalProfile(view.id)
    setSaved(false)
    setError(null)
  }, [view.id])

  const btn = 'cbat-arcade-btn px-3 py-1.5 rounded text-[11px] font-extrabold uppercase tracking-wider cursor-pointer'
  const primary = `${btn} bg-brand-600 hover:bg-brand-700 border-b-[#1f5da8] text-white`
  const ghost = `${btn} border border-game-line border-b-surface text-slate-500 hover:text-brand-600 hover:border-brand-600`

  const connected = !!view.id

  return (
    <div
      data-pedals-connected={connected ? 'yes' : 'no'}
      className={`cbat-arcade-panel rounded-lg border-2 p-3 mb-4 text-left transition-opacity duration-300 ${
        connected ? 'border-brand-600/50 opacity-100' : 'cbat-arcade-idle border-game-line opacity-90'
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b-2 border-[#12283f]">
        <span className="font-mono text-[10px] font-extrabold uppercase tracking-[0.22em] text-brand-600">
          {title}
        </span>
        {connected && (
          <span className="flex items-center gap-1.5 font-mono text-[9px] font-extrabold uppercase tracking-widest text-brand-600">
            <span className="cbat-led-on h-1.5 w-1.5 rounded-full" aria-hidden="true" />
            CALIBRATED
          </span>
        )}
      </div>

      {connected && !calibrating && (
        <>
          <p
            data-pedals-detected
            className="cbat-stick-detected mb-2 text-center font-mono text-lg font-extrabold uppercase tracking-[0.18em] text-brand-600"
          >
            <span aria-hidden="true" className="mr-1.5">{'▸'}</span>
            Pedals detected!
            <span aria-hidden="true" className="ml-1.5">{'◂'}</span>
          </p>
          <p
            className="mb-2 truncate rounded border border-[#12283f] bg-game-panel px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-game-muted"
            title={view.id}
          >
            {view.id}
          </p>
          <div className="mb-3">
            <AxisBar label="Pedal" value={view.x} />
          </div>
          <p className="mb-3 text-xs text-game-muted">
            The pedals take the left and right axis in this game. Right pedal forward lights the right
            half of the bar; if it lights the left, recalibrate.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={start} className={primary}>Recalibrate</button>
            <button type="button" onClick={forget} className={ghost}>Forget</button>
            {saved && <span className="font-mono text-[10px] text-brand-600">SAVED</span>}
          </div>
        </>
      )}

      {!connected && !calibrating && (
        <>
          <p
            data-pedals-missing
            className="cbat-stick-attract mb-2 text-center font-mono text-lg font-extrabold uppercase tracking-[0.16em] leading-tight"
          >
            <span aria-hidden="true" className="mr-1.5">{'▸'}</span>
            No pedals detected
            <span aria-hidden="true" className="ml-1.5">{'◂'}</span>
          </p>
          {view.padCount > 0 ? (
            <>
              <p className="mb-3 text-xs text-game-muted">
                Pedals are learned by watching you press them, so it does not matter which lead they
                are on or which device they show up as. Plug them in and calibrate.
              </p>
              <button type="button" onClick={start} className={primary}>Calibrate pedals</button>
            </>
          ) : (
            <p className="text-xs text-game-muted">{WAKE_HINT}</p>
          )}
        </>
      )}

      {calibrating && step && (
        <div>
          <p className="font-mono text-sm font-extrabold uppercase tracking-wider text-game-text">{step.prompt}</p>
          <p className="mb-2 text-xs text-game-muted">{step.hint}</p>
          <p className="mb-2 text-[10px] text-slate-500">Hold it there and press Capture.</p>
          {/* Every device's raw axes, so the player can watch something move
              before trusting the result, and read the numbers back to us if it
              does not. */}
          <div className="mb-3 space-y-1">
            {Object.entries(view.live).map(([id, axes]) => (
              <p key={id} className="break-all font-mono text-[10px] text-game-muted" title={id}>
                <span className="text-slate-500">{id.slice(0, 18)}</span>{' '}
                [{axes.map(v => v.toFixed(2)).join(', ')}]
              </p>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={capture} className={primary}>Capture</button>
            <button type="button" onClick={cancel} className={ghost}>Cancel</button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-amber-300">{error}</p>}
    </div>
  )
}
