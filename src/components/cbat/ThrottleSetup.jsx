import { useCallback, useEffect, useRef, useState } from 'react'
import { listPads, loadThrottleProfile, saveThrottleProfile, clearThrottleProfile } from '../../utils/cbat/gamepad'
import { createLeverCalibration, createButtonCalibration, readLever } from '../../utils/cbat/throttle'
import { AxisBar } from './StickSetup'

// Throttle panel for the Instruments Practise drill. Sits under the joystick
// cabinet in the rail and is styled as the same machine, like PedalSetup.
//
// Two ways to work the throttle, picked with the switch at the top:
//   Lever    the default. Pull the lever back, Capture; push it forward,
//            Capture. The lever then sets the speed directly.
//   Buttons  the override. Press the button for FASTER, then for SLOWER.
// Both are learned (throttle.js), never guessed, and each is kept when the
// other is chosen, so flipping back costs nothing. Saved in this browser, like
// the joystick and pedal setups.
//
// Same attract mode as the other cabinets: the amber headline while nothing is
// set up for the chosen mode, THROTTLE DETECTED! in the blue pulse once it is.

const WAKE_HINT = 'Not seeing it? Click this page, then move the lever or press a button. Browsers hide a device until it is used.'

const BINDING_LABEL = { faster: 'Faster', slower: 'Slower' }

function isHeld(pads, binding) {
  if (!binding) return false
  const pad = pads.find(p => p.id === binding.id)
  const b = pad?.buttons?.[binding.index]
  return !!b && (b.pressed || b.value > 0.5)
}

export default function ThrottleSetup({ title = 'Throttle' }) {
  const [profile, setProfile] = useState(loadThrottleProfile)
  const [view, setView] = useState({ padCount: 0, lever: null, faster: false, slower: false, live: {} })
  const [calibrating, setCalibrating] = useState(null) // null | 'lever' | 'buttons'
  const [step, setStep] = useState(null)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)

  const calRef = useRef(null)
  const viewRef = useRef(view)
  const profileRef = useRef(profile)
  useEffect(() => { profileRef.current = profile }, [profile])

  const mode = profile?.mode ?? 'lever'

  const store = useCallback((next) => {
    saveThrottleProfile(next)
    setProfile(loadThrottleProfile())
  }, [])

  const finishButtons = useCallback(() => {
    const cal = calRef.current
    if (!cal) return
    const out = cal.result()
    calRef.current = null
    setCalibrating(null)
    setStep(null)
    if (!out.ok) { setError(out.reason); return }
    store({ ...(profileRef.current || {}), mode: 'buttons', buttons: out.buttons })
    setError(null)
    setSaved(true)
  }, [store])

  useEffect(() => {
    let raf = null
    let lastPush = 0

    const frame = (now) => {
      raf = requestAnimationFrame(frame)
      const pads = listPads()
      const cal = calRef.current
      if (cal) {
        // Button steps advance themselves on a press; lever steps wait for
        // Capture, since the hand is on the lever.
        if (cal.kind === 'buttons') {
          if (cal.observe(pads)) {
            if (cal.done()) { finishButtons(); return }
            setStep(cal.step())
          }
        } else {
          cal.observe(pads)
        }
      }

      // About 15 Hz, like the other cabinets.
      if (now - lastPush < 66) return
      lastPush = now

      const p = profileRef.current
      const leverPad = p?.lever ? pads.find(d => d.id === p.lever.id) : null
      const next = {
        padCount: pads.length,
        lever: leverPad ? readLever(leverPad, p.lever.axis) : null,
        faster: isHeld(pads, p?.buttons?.faster),
        slower: isHeld(pads, p?.buttons?.slower),
        live: cal && cal.kind === 'lever' ? cal.live() : {},
      }
      const prev = viewRef.current
      const same = prev.padCount === next.padCount
        && prev.lever === next.lever
        && prev.faster === next.faster
        && prev.slower === next.slower
        && JSON.stringify(prev.live) === JSON.stringify(next.live)
      if (same) return
      viewRef.current = next
      setView(next)
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [finishButtons])

  const chooseMode = useCallback((next) => {
    if (next === mode || calibrating) return
    store({ ...(profileRef.current || { lever: null, buttons: null }), mode: next })
    setError(null)
    setSaved(false)
  }, [mode, calibrating, store])

  const start = useCallback(() => {
    if (!listPads().length) { setError('No device found yet. Plug it in and move the lever or press a button.'); return }
    const cal = mode === 'buttons' ? createButtonCalibration() : createLeverCalibration()
    cal.kind = mode
    calRef.current = cal
    setError(null)
    setSaved(false)
    setStep(cal.step())
    setCalibrating(mode)
  }, [mode])

  const cancel = useCallback(() => {
    calRef.current = null
    setCalibrating(null)
    setStep(null)
  }, [])

  const capture = useCallback(() => {
    const cal = calRef.current
    if (!cal || cal.kind !== 'lever') return
    cal.commit()
    if (!cal.done()) { setStep(cal.step()); return }
    const out = cal.result()
    calRef.current = null
    setCalibrating(null)
    setStep(null)
    if (!out.ok) { setError(out.reason); return }
    store({ ...(profileRef.current || {}), mode: 'lever', lever: out.lever })
    setError(null)
    setSaved(true)
  }, [store])

  // Forgets the chosen mode's setup only; the other one is kept.
  const forget = useCallback(() => {
    const p = profileRef.current
    if (!p) return
    const next = { ...p, [mode]: null }
    if (!next.lever && !next.buttons) {
      clearThrottleProfile()
      setProfile(null)
    } else {
      store(next)
    }
    setSaved(false)
    setError(null)
  }, [mode, store])

  const btn = 'cbat-arcade-btn px-3 py-1.5 rounded text-[11px] font-extrabold uppercase tracking-wider cursor-pointer'
  const primary = `${btn} bg-brand-600 hover:bg-brand-700 border-b-[#1f5da8] text-white`
  const ghost = `${btn} border border-game-line border-b-surface text-slate-500 hover:text-brand-600 hover:border-brand-600`

  const leverReady = mode === 'lever' && !!profile?.lever && view.lever != null
  const buttonsReady = mode === 'buttons' && !!profile?.buttons
  const ready = leverReady || buttonsReady

  return (
    <div
      data-throttle-ready={ready ? 'yes' : 'no'}
      data-throttle-mode={mode}
      className={`cbat-arcade-panel @container rounded-lg border-2 p-3 mb-4 text-left transition-opacity duration-300 ${
        ready ? 'border-brand-600/50 opacity-100' : 'cbat-arcade-idle border-game-line opacity-90'
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b-2 border-[#12283f]">
        <span className="font-mono text-[10px] font-extrabold uppercase tracking-[0.22em] text-brand-600">
          {title}
        </span>
        {ready && (
          <span className="flex items-center gap-1.5 font-mono text-[9px] font-extrabold uppercase tracking-widest text-brand-600">
            <span className="cbat-led-on h-1.5 w-1.5 rounded-full" aria-hidden="true" />
            CALIBRATED
          </span>
        )}
      </div>

      {/* Lever is the default; buttons are the override. */}
      <div className="mb-3 grid grid-cols-2 gap-1" role="radiogroup" aria-label="Throttle control">
        {[['lever', 'Lever'], ['buttons', 'Buttons']].map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={mode === key}
            data-throttle-choice={key}
            disabled={!!calibrating}
            onClick={() => chooseMode(key)}
            className={`rounded border px-2 py-1 font-mono text-[10px] font-extrabold uppercase tracking-wider transition-colors ${
              mode === key
                ? 'border-brand-600 bg-brand-600/15 text-brand-600'
                : 'border-game-line text-slate-500 hover:text-brand-600'
            } disabled:cursor-not-allowed`}
          >
            {label}
          </button>
        ))}
      </div>

      {ready && !calibrating && (
        <>
          <p
            data-throttle-detected
            className="cbat-stick-detected mb-2 text-center font-mono text-[min(1.125rem,5cqi)] leading-7 font-extrabold uppercase tracking-[0.18em] whitespace-nowrap text-brand-600"
          >
            <span aria-hidden="true" className="mr-1.5">{'▸'}</span>
            Throttle detected!
            <span aria-hidden="true" className="ml-1.5">{'◂'}</span>
          </p>
          {leverReady ? (
            <>
              <div className="mb-3">
                {/* 0..1 shown on the -1..1 bar: idle lights the left end, full the right. */}
                <AxisBar label="Lever" value={view.lever * 2 - 1} />
              </div>
              <p className="mb-3 text-xs text-game-muted">
                The lever sets your speed. Push it forward and the bar should fill to the right; if it
                fills to the left, recalibrate. Until you move it in a run, R and F still work.
              </p>
            </>
          ) : (
            <>
              <div className="mb-3 grid grid-cols-2 gap-2">
                {['faster', 'slower'].map(k => (
                  <div key={k} className="flex items-center gap-2 rounded border border-[#12283f] bg-game-panel px-2 py-1">
                    <span className={`h-2 w-2 rounded-full ${view[k] ? 'cbat-led-on' : 'bg-[#0e1c2e]'}`} aria-hidden="true" />
                    <span className="font-mono text-[10px] uppercase tracking-wide text-game-muted">
                      {BINDING_LABEL[k]} <span className="text-slate-500">#{profile.buttons[k].index}</span>
                    </span>
                  </div>
                ))}
              </div>
              <p className="mb-3 text-xs text-game-muted">
                Hold them in the drill to speed up and slow down. Each light comes on while its button is held.
              </p>
            </>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={start} className={primary}>Recalibrate</button>
            <button type="button" onClick={forget} className={ghost}>Forget</button>
            {saved && <span className="font-mono text-[10px] text-brand-600">SAVED</span>}
          </div>
        </>
      )}

      {!ready && !calibrating && (
        <>
          <p
            data-throttle-missing
            className="cbat-stick-attract mb-2 text-center font-mono text-[min(1.125rem,5cqi)] font-extrabold uppercase tracking-[0.16em] leading-tight whitespace-nowrap"
          >
            <span aria-hidden="true" className="mr-1.5">{'▸'}</span>
            {view.padCount > 0 ? 'No throttle set up' : 'No throttle detected'}
            <span aria-hidden="true" className="ml-1.5">{'◂'}</span>
          </p>
          {view.padCount > 0 ? (
            <>
              <p className="mb-3 text-xs text-game-muted">
                {mode === 'lever'
                  ? 'Use your joystick’s throttle lever to set the speed. Show us the lever once and it is remembered.'
                  : 'Pick two buttons on your stick, one to speed up and one to slow down.'}
              </p>
              <button type="button" onClick={start} className={primary}>
                {mode === 'lever' ? 'Set up lever' : 'Set up buttons'}
              </button>
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
          {calibrating === 'lever' ? (
            <>
              <p className="mb-2 text-[10px] text-slate-500">Hold it there and press Capture.</p>
              {/* Every device's raw axes, so the player can see the lever move
                  before trusting the result, and read the numbers back to us
                  if it does not work. */}
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
            </>
          ) : (
            <button type="button" onClick={cancel} className={ghost}>Cancel</button>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-amber-300">{error}</p>}
    </div>
  )
}
