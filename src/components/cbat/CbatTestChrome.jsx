import { Link } from 'react-router-dom'
import CbatQuitButton from '../CbatQuitButton'
import { useCbatTheme } from '../../hooks/useCbatTheme'

// The screen furniture of the real test software, switched on by the Real
// CBAT theme and invisible under the SkyWatch look:
//
//   - CbatGameHeader: every game's "<- Instructions / title" row. Under the
//     default theme it renders exactly the markup the games always had. Under
//     the Real CBAT theme, while `test` is set, it becomes the title bar of
//     the real screens: "Angles - Testing (3 of 20)" centred over a thin
//     white rule, with the boxed Time / Progress meters top-left.
//   - CbatFooterStrip: the instruction strip along the bottom, "Enter or
//     change your answer, then press ->", with the arrow drawn as a key the
//     player can also tap, and the "Your Answer [ 3 ]" readout beside it.
//   - CbatKeyCap: the grey bevelled key drawn beside a numbered or lettered
//     option, so the keyboard shortcut is visible the way it is on the real
//     answer lists.
//
// Wording and layout are from candidates' screenshots of the test software.

// "Angles - Testing (3 of 20)". Stage is the real software's word for the
// phase: Instructions, Practice or Testing. Item/total are optional.
export function testBarTitle(title, { stage = 'Testing', item, total } = {}) {
  const count = item != null && total != null ? ` (${item} of ${total})` : ''
  return `${title} - ${stage}${count}`
}

const clamp01 = (v) => (v == null || Number.isNaN(v) ? null : Math.max(0, Math.min(1, v)))

function Meter({ label, frac, tone }) {
  const f = clamp01(frac)
  return (
    <div className="cbat-testbar-meter">
      <span>{label}</span>
      <i>{f != null && <b className={tone} style={{ width: `${f * 100}%` }} />}</i>
    </div>
  )
}

export function CbatGameHeader({
  title,
  fullTitle,
  intro = false,
  backTo = '/cbat',
  onQuit,
  confirmNeeded = false,
  quitLabel,
  titleClass = 'text-slate-900',
  className = '',
  test = null,
  children,
}) {
  const cbat = useCbatTheme()
  const quit = intro
    ? <Link to={backTo} className="text-slate-500 hover:text-brand-400 transition-colors text-sm">&larr; CBAT</Link>
    : <CbatQuitButton onConfirm={onQuit} confirmNeeded={confirmNeeded} label={quitLabel} />

  if (cbat && test) {
    return (
      <div className={`cbat-testbar ${className}`} data-testid="cbat-testbar">
        <div className="cbat-testbar-left">
          {quit}
          <div className="cbat-testbar-meters" aria-hidden="true">
            {clamp01(test.timeFrac) != null && (
              <Meter label="Time" frac={test.timeFrac} tone="cbat-testbar-time" />
            )}
            <Meter label="Progress" frac={test.progressFrac} tone="cbat-testbar-progress" />
          </div>
        </div>
        <h1 className="cbat-testbar-title">{testBarTitle(fullTitle ?? title, test)}</h1>
        <div className="cbat-testbar-right">{children}</div>
      </div>
    )
  }

  return (
    <div className={`flex items-center gap-2 mb-2 ${className}`}>
      {quit}
      <h1 className={`text-sm font-extrabold ${titleClass}`}>{title}</h1>
      {children}
    </div>
  )
}

export const FOOTER_ANSWER_TEXT = 'Enter or change your answer, then press'

// `answer` is the readout: undefined hides "Your Answer" entirely, null shows
// an empty box, anything else is shown inside it. `onSubmit` draws the arrow
// key; without it the strip is text only. `hint` is a second, quieter line
// (the practice phase's "Esc skips to the test").
export function CbatFooterStrip({ text = FOOTER_ANSWER_TEXT, answer, onSubmit, canSubmit = true, hint, className = '' }) {
  const cbat = useCbatTheme()
  if (!cbat) return null
  return (
    <div className={`cbat-footer-strip ${className}`} data-testid="cbat-footer-strip">
      {answer !== undefined && (
        <span className="cbat-footer-answer">
          Your Answer [ <b>{answer ?? ''}</b> ]
        </span>
      )}
      <span className="cbat-footer-text">
        {text}
        {onSubmit && (
          <button
            type="button"
            className="cbat-keycap cbat-keycap-arrow"
            onClick={onSubmit}
            disabled={!canSubmit}
            aria-label="Submit answer"
            data-testid="cbat-footer-submit"
          >
            &#10140;
          </button>
        )}
      </span>
      {hint && <span className="cbat-footer-hint">{hint}</span>}
    </div>
  )
}

// The grey key beside an option. Renders nothing under the SkyWatch theme, so
// games can drop it into any option button unconditionally.
export function CbatKeyCap({ label, className = '' }) {
  const cbat = useCbatTheme()
  if (!cbat) return null
  return <span className={`cbat-keycap ${className}`} aria-hidden="true">{label}</span>
}

export default CbatGameHeader
