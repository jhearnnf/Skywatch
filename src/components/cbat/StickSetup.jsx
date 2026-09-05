import { useCallback, useEffect, useRef, useState } from 'react'
import {
  listPads, pickPad, loadProfile, saveProfile, clearProfile,
  createCalibration, readStickAxes, defaultProfile, pressedButtons,
} from '../../utils/cbat/gamepad'

// Joystick panel for the CBAT games that are flown on a stick — RTT and ACT.
//
// It does two jobs, and the second is the important one. The first is to tell
// the player whether the thing they plugged in has been seen at all. The second
// is to LEARN the mapping: which axis is roll, which is pitch, which way round
// each of them goes, and which buttons are the trigger and the bleep. None of
// that can be assumed for a flight stick — they report `mapping: ''` and put
// their axes wherever the driver felt like — so the alternative to asking is a
// table of USB ids that is wrong for every device not on it.
//
// Asking has a second benefit worth stating plainly: a player whose stick is
// mapped oddly fixes it here in twenty seconds, rather than filing a bug against
// hardware nobody working on this owns.
//
// The raw readout at the bottom is the diagnostic. If calibration itself goes
// wrong, those numbers are what a player can read back to us.
//
// Pass a `children` slot for the game's own sensitivity control, so ACT's rate
// slider and RTT's existing one each stay with their game.

// Chrome does not admit a gamepad exists until it has seen input from it, and
// only reports one while the page has focus. So "nothing detected" is very
// often "nothing has been pressed yet", and the copy has to say so or the
// player concludes their stick is broken.
const WAKE_HINT = 'Not seeing it? Click this page, then press a button on the stick — browsers hide a gamepad until it is used.'

function AxisBar({ label, value }) {
  const pct = Math.round(((value + 1) / 2) * 100)
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 shrink-0 text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
      <div className="relative h-1.5 flex-1 rounded-full bg-[#0c1829]">
        <div className="absolute inset-y-0 left-1/2 w-px bg-[#1a3a5c]" />
        <div
          className="absolute top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-brand-600"
          style={{ left: `${pct}%` }}
        />
      </div>
      <span className="w-10 shrink-0 text-right font-mono text-[10px] text-brand-600">{value.toFixed(2)}</span>
    </div>
  )
}

export default function StickSetup({ title = 'Joystick', mockActive = false, children }) {
  // Everything the panel draws, refreshed from the frame loop below. Held as
  // one object so a frame that changes nothing costs one comparison rather than
  // five setState calls.
  const [view, setView] = useState({
    connected: false, id: null, calibrated: false,
    x: 0, y: 0, rawAxes: [], rawButtons: [],
  })
  const [calibrating, setCalibrating] = useState(false)
  const [step, setStep] = useState(null)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)

  const calRef = useRef(null)
  // The device calibration was started against. Pinned so plugging in a second
  // pad half way through cannot swap the thing being measured.
  const targetIdRef = useRef(null)
  const viewRef = useRef(view)

  const finish = useCallback((cal) => {
    const out = cal.result()
    calRef.current = null
    setCalibrating(false)
    setStep(null)
    targetIdRef.current = null
    if (!out.ok) { setError(out.reason); return }
    saveProfile(out.profile)
    setError(null)
    setSaved(true)
  }, [])

  useEffect(() => {
    let raf = null
    let lastPush = 0

    const frame = (now) => {
      raf = requestAnimationFrame(frame)
      const pads = listPads()
      const pad = pickPad(pads, targetIdRef.current)

      // Calibration observes EVERY frame, because a button press is only
      // visible as a difference between two of them — a press shorter than the
      // gap would simply not exist.
      const cal = calRef.current
      if (cal && pad) {
        if (cal.observe(pad)) {
          setStep(cal.step())
          if (cal.done()) finish(cal)
        }
      }

      // The rest of the panel is only redrawn at about 15 Hz. It is an intro
      // screen; there is nothing on it worth sixty React renders a second.
      if (now - lastPush < 66) return
      lastPush = now

      const id = pad ? pad.id : null
      const stored = id ? loadProfile(id) : null
      const axes = pad ? readStickAxes(pad, stored || defaultProfile(id)) : { x: 0, y: 0 }
      const next = {
        connected: !!pad,
        id,
        calibrated: !!stored?.calibrated,
        x: axes.x,
        y: axes.y,
        rawAxes: pad ? Array.from(pad.axes || []) : [],
        rawButtons: pad ? pressedButtons(pad) : [],
      }
      const prev = viewRef.current
      const same = prev.connected === next.connected
        && prev.id === next.id
        && prev.calibrated === next.calibrated
        && Math.abs(prev.x - next.x) < 0.01
        && Math.abs(prev.y - next.y) < 0.01
        && prev.rawButtons.join() === next.rawButtons.join()
      if (same) return
      viewRef.current = next
      setView(next)
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [finish])

  const start = useCallback(() => {
    const pad = pickPad(listPads(), null)
    if (!pad) { setError('No joystick detected yet.'); return }
    targetIdRef.current = pad.id
    const cal = createCalibration(pad.id)
    calRef.current = cal
    setError(null)
    setSaved(false)
    setStep(cal.step())
    setCalibrating(true)
  }, [])

  const cancel = useCallback(() => {
    calRef.current = null
    targetIdRef.current = null
    setCalibrating(false)
    setStep(null)
  }, [])

  const capture = useCallback(() => {
    const cal = calRef.current
    if (!cal) return
    cal.commit()
    setStep(cal.step())
    if (cal.done()) finish(cal)
  }, [finish])

  const skip = useCallback(() => {
    const cal = calRef.current
    if (!cal) return
    cal.skip()
    setStep(cal.step())
    if (cal.done()) finish(cal)
  }, [finish])

  const forget = useCallback(() => {
    if (view.id) clearProfile(view.id)
    setSaved(false)
    setError(null)
  }, [view.id])

  const btn = 'px-3 py-1.5 rounded text-xs font-bold cursor-pointer transition-colors'
  const primary = `${btn} bg-brand-600 hover:bg-brand-700 text-white`
  const ghost = `${btn} border border-[#1a3a5c] text-slate-500 hover:text-brand-600`

  return (
    <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 mb-4 text-left">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-slate-500 uppercase tracking-wide">{title}</span>
        <span className={`font-mono text-[10px] ${view.connected ? 'text-brand-600' : 'text-slate-500'}`}>
          {view.connected ? (view.calibrated ? 'CALIBRATED' : 'DEFAULT MAPPING') : 'NOT DETECTED'}
        </span>
      </div>

      {mockActive && (
        <p className="mb-2 font-mono text-[10px] text-amber-300">MOCK STICK ACTIVE — mouse = stick, J = trigger, K = bleep</p>
      )}

      {!view.connected && (
        <p className="text-xs text-[#8a9bb5]">{WAKE_HINT}</p>
      )}

      {view.connected && !calibrating && (
        <>
          <p className="mb-2 truncate font-mono text-[10px] text-[#8a9bb5]" title={view.id}>{view.id}</p>
          <div className="space-y-1.5 mb-3">
            <AxisBar label="Roll" value={view.x} />
            <AxisBar label="Pitch" value={view.y} />
          </div>
          {!view.calibrated && (
            <p className="mb-3 text-xs text-[#8a9bb5]">
              Flying on a guessed mapping. If the bars above do not follow the stick — or follow it the
              wrong way — calibrate and they will.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={start} className={primary}>
              {view.calibrated ? 'Recalibrate' : 'Calibrate'}
            </button>
            {view.calibrated && (
              <button type="button" onClick={forget} className={ghost}>Forget</button>
            )}
            {saved && <span className="font-mono text-[10px] text-brand-600">SAVED</span>}
          </div>
        </>
      )}

      {calibrating && step && (
        <div>
          <p className="text-sm font-bold text-[#ddeaf8]">{step.prompt}</p>
          <p className="mb-2 text-xs text-[#8a9bb5]">{step.hint}</p>
          <p className="mb-3 text-[10px] text-slate-500">
            {step.kind === 'axes'
              ? 'Hold it there and squeeze any button on the stick — or press Capture.'
              : 'Press the button you want.'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {step.kind === 'axes'
              ? <button type="button" onClick={capture} className={primary}>Capture</button>
              : <button type="button" onClick={skip} className={ghost}>Skip</button>}
            <button type="button" onClick={cancel} className={ghost}>Cancel</button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-amber-300">{error}</p>}

      {view.connected && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-slate-500">Raw readout</summary>
          <p className="mt-1 break-all font-mono text-[10px] text-[#8a9bb5]">
            axes [{view.rawAxes.map(v => v.toFixed(2)).join(', ')}]
          </p>
          <p className="break-all font-mono text-[10px] text-[#8a9bb5]">
            buttons down [{view.rawButtons.join(', ')}]
          </p>
        </details>
      )}

      {children && <div className="mt-3 border-t border-[#1a3a5c] pt-3">{children}</div>}
    </div>
  )
}
