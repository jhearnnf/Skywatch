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

// A segmented LED meter rather than a dot on a track. Segments light from the
// centre outwards in the direction the stick is pushed, which is how a cabinet
// would show it and, more usefully, makes a mis-mapped axis obvious at a glance:
// a stick pushed right that lights the left half is telling you something a
// sliding dot does not.
const LED_SEGMENTS = 17
const LED_CENTRE = (LED_SEGMENTS - 1) / 2

function AxisBar({ label, value }) {
  const clamped = Math.max(-1, Math.min(1, value))
  const target = Math.round(LED_CENTRE + clamped * LED_CENTRE)
  const lo = Math.min(LED_CENTRE, target)
  const hi = Math.max(LED_CENTRE, target)

  return (
    <div className="flex items-center gap-2">
      <span className="w-8 shrink-0 font-mono text-[10px] uppercase tracking-widest text-slate-500">{label}</span>
      <div className="flex flex-1 items-center gap-px" aria-hidden="true">
        {Array.from({ length: LED_SEGMENTS }, (_, i) => {
          const on = i >= lo && i <= hi
          const centre = i === LED_CENTRE
          return (
            <span
              key={i}
              className={`cbat-led h-2.5 flex-1 rounded-[1px] ${
                on ? (centre && target === LED_CENTRE ? 'cbat-led-centre' : 'cbat-led-on') : 'bg-[#0e1c2e]'
              }`}
            />
          )
        })}
      </div>
      <span className="w-10 shrink-0 text-right font-mono text-[10px] text-brand-600">{clamped.toFixed(2)}</span>
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

  // Cabinet buttons: chunky, uppercase, with a hard lip that depresses when
  // pressed. See .cbat-arcade-btn in main.css.
  const btn = 'cbat-arcade-btn px-3 py-1.5 rounded text-[11px] font-extrabold uppercase tracking-wider cursor-pointer'
  const primary = `${btn} bg-brand-600 hover:bg-brand-700 border-b-[#1f5da8] text-white`
  const ghost = `${btn} border border-[#1a3a5c] border-b-[#0c1829] text-slate-500 hover:text-brand-600 hover:border-brand-600`

  return (
    <div
      data-stick-connected={view.connected ? 'yes' : 'no'}
      className={`cbat-arcade-panel rounded-lg border-2 p-3 mb-4 text-left transition-opacity duration-300 ${
        view.connected
          ? 'border-brand-600/50 opacity-100'
          : 'cbat-arcade-idle border-[#1a3a5c] opacity-90'
      }`}
    >
      {/* Marquee. The title bar of a cabinet, not a form legend. */}
      <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b-2 border-[#12283f]">
        <span className="font-mono text-[10px] font-extrabold uppercase tracking-[0.22em] text-brand-600">
          {title}
        </span>
        {view.connected && (
          <span className="flex items-center gap-1.5 font-mono text-[9px] font-extrabold uppercase tracking-widest text-brand-600">
            <span className="cbat-led-on h-1.5 w-1.5 rounded-full" aria-hidden="true" />
            {view.calibrated ? 'CALIBRATED' : 'DEFAULT MAPPING'}
          </span>
        )}
      </div>

      {/* The arcade moment. A stick is rare enough here that finding one is
          worth announcing, and it also answers the question the panel exists to
          answer before the player has read a word of it. */}
      {view.connected && !calibrating && (
        <p
          data-stick-detected
          className="cbat-stick-detected mb-2 text-center font-mono text-lg font-extrabold uppercase tracking-[0.18em] text-brand-600"
        >
          <span aria-hidden="true" className="mr-1.5">{'\u25B8'}</span>
          Joystick detected!
          <span aria-hidden="true" className="ml-1.5">{'\u25C2'}</span>
        </p>
      )}

      {mockActive && (
        <p className="mb-2 font-mono text-[10px] text-amber-300">MOCK STICK ACTIVE — mouse = stick, J = trigger, K = bleep</p>
      )}

      {!view.connected && (
        <>
          <p
            data-stick-missing
            className="cbat-stick-attract mb-2 text-center font-mono text-lg font-extrabold uppercase tracking-[0.16em] leading-tight"
          >
            <span aria-hidden="true" className="mr-1.5">{'▸'}</span>
            No joystick detected
            <span aria-hidden="true" className="ml-1.5">{'◂'}</span>
          </p>
          <p className="text-xs text-[#8a9bb5]">{WAKE_HINT}</p>
        </>
      )}

      {view.connected && !calibrating && (
        <>
          <p
            className="mb-2 truncate rounded border border-[#12283f] bg-[#0a1628] px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-[#8a9bb5]"
            title={view.id}
          >
            {view.id}
          </p>
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
          <p className="font-mono text-sm font-extrabold uppercase tracking-wider text-[#ddeaf8]">{step.prompt}</p>
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
          <summary className="cursor-pointer font-mono text-[10px] font-extrabold uppercase tracking-widest text-slate-500">Raw readout</summary>
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
