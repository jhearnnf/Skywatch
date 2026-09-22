// The CLAN screen while a run is on: the real test's layout, from a candidate's
// screenshot of the software. Four grey option boxes in the corners, lettered
// A to D; the code box top-centre; the black arena in the middle with the
// diamonds crossing toward the red, yellow and green bands on its right; the
// sum bottom-centre. Everything renders from an immutable sim snapshot.
//
// Two skins from one markup. Under the Real CBAT theme (`cbat`) the classes in
// main.css paint the screenshot's literal colours — grey boxes, black arena,
// serif capitals — and nothing on screen says right or wrong. Under SkyWatch
// the same boxes take the game tokens and flash their verdicts.

import { CbatKeyCap } from '../../components/cbat/CbatTestChrome'
import { CLAN_BANDS } from '../../utils/cbat/clanSim'
import { CLAN_COLOURS } from '../../utils/cbat/clanDifficulty'
import { OPTION_KEYS, COLOUR_KEYS } from './keys'

// Where each of the four options sits. The real screen reads A top-left,
// B top-right, C bottom-left, D bottom-right.
const OPTION_SLOTS = ['tl', 'tr', 'bl', 'br']

function OptionBox({ index, text, feedback, disabled, onPick }) {
  const label = OPTION_KEYS[index]
  const verdict = feedback && feedback.pickedIndex === index
    ? (feedback.correct ? 'correct' : 'wrong')
    : null
  return (
    <button
      type="button"
      onClick={() => onPick(index)}
      disabled={disabled}
      data-clan-option={label}
      data-verdict={verdict ?? undefined}
      className={`cbat-clan-option cbat-clan-option-${OPTION_SLOTS[index]}${verdict ? ` cbat-clan-option-${verdict}` : ''}`}
      aria-label={text ? `Option ${label}: ${text}` : `Option ${label}`}
    >
      <span className="cbat-clan-option-text">{text ?? ''}</span>
      <span className="cbat-clan-option-key" aria-hidden="true">
        <CbatKeyCap label={label} />
        <span className="cbat-clan-option-key-sw">{label}</span>
      </span>
    </button>
  )
}

function Diamond({ d, cbat }) {
  // The real software gives no feedback: a caught diamond simply goes.
  if (cbat && d.state === 'hit') return null
  return (
    <span
      className={`cbat-clan-diamond cbat-clan-diamond-${d.colour} cbat-clan-diamond-${d.state}`}
      style={{ left: `${Math.min(100, Math.max(-4, d.x * 100))}%`, top: `${d.y * 100}%` }}
      data-clan-diamond={d.colour}
      data-state={d.state}
      aria-hidden="true"
    />
  )
}

export default function ClanBoard({
  snapshot, cbat, onColour, onOption, onDigit, onBackspace, onEnter,
}) {
  const { diamonds, letters, maths } = snapshot
  const asking = letters.phase === 'asking'
  const mathFeedback = maths.feedback
  const digits = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0']

  return (
    <div className={`cbat-clan-board${cbat ? ' cbat-clan-real' : ''}`} data-testid="clan-board">
      <div className="cbat-clan-grid">
        <OptionBox index={0} text={asking ? letters.options[0] : null} feedback={cbat ? null : letters.feedback} disabled={!asking} onPick={onOption} />

        {/* The code box. Blank between codes and while the options are up. */}
        <div
          className={`cbat-clan-letters${letters.feedback && !cbat ? (letters.feedback.correct ? ' cbat-clan-letters-correct' : ' cbat-clan-letters-wrong') : ''}`}
          data-testid="clan-letters"
          aria-live="polite"
        >
          {letters.code && <span className="cbat-clan-code">{letters.code}</span>}
          {!cbat && letters.phase === 'showing' && <span className="cbat-clan-caption">Memorise</span>}
          {!cbat && asking && <span className="cbat-clan-caption">Which was it? A to D</span>}
        </div>

        <OptionBox index={1} text={asking ? letters.options[1] : null} feedback={cbat ? null : letters.feedback} disabled={!asking} onPick={onOption} />

        {/* The arena. Bands take the right half; diamonds cross from the left. */}
        <div className="cbat-clan-arena" data-testid="clan-arena">
          {CLAN_COLOURS.map(c => {
            const [lo, hi] = CLAN_BANDS[c]
            return (
              <span
                key={c}
                className={`cbat-clan-band cbat-clan-band-${c}`}
                style={{ left: `${lo * 100}%`, width: `${(hi - lo) * 100}%` }}
                aria-hidden="true"
              />
            )
          })}
          {diamonds.map(d => <Diamond key={d.id} d={d} cbat={cbat} />)}
        </div>

        <OptionBox index={2} text={asking ? letters.options[2] : null} feedback={cbat ? null : letters.feedback} disabled={!asking} onPick={onOption} />

        {/* The sum. */}
        <div
          className={`cbat-clan-maths${mathFeedback && !cbat ? (mathFeedback.correct ? ' cbat-clan-maths-correct' : ' cbat-clan-maths-wrong') : ''}`}
          data-testid="clan-maths"
        >
          {maths.question ? (
            <span className="cbat-clan-sum">
              {maths.question} = <span className="cbat-clan-entered">{maths.entered || (cbat ? '' : '_')}</span>
            </span>
          ) : (
            !cbat && <span className="cbat-clan-caption">Standby</span>
          )}
          {!cbat && maths.question && (
            <span className="cbat-clan-maths-timer" aria-hidden="true">
              <span style={{ width: `${maths.remainingFrac * 100}%` }} />
            </span>
          )}
        </div>

        <OptionBox index={3} text={asking ? letters.options[3] : null} feedback={cbat ? null : letters.feedback} disabled={!asking} onPick={onOption} />
      </div>

      {/* On-screen keys. A desktop plays this on the keyboard; a phone or a
          tablet has nothing else. Under the Real CBAT theme the strip is hidden
          on a hover-capable desktop, the Symbols arrangement. */}
      <div className="cbat-clan-keys" data-testid="clan-keys">
        <div className="cbat-clan-colour-keys">
          {CLAN_COLOURS.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => onColour(c)}
              className={`cbat-clan-colour-key cbat-clan-colour-key-${c}`}
              aria-label={`${c} (${COLOUR_KEYS[c]})`}
              data-clan-colour-key={c}
            >
              {COLOUR_KEYS[c]}
            </button>
          ))}
        </div>
        <div className="cbat-clan-numpad">
          {digits.map(d => (
            <button key={d} type="button" onClick={() => onDigit(d)} className="cbat-clan-numkey" data-clan-digit={d}>{d}</button>
          ))}
          <button type="button" onClick={onBackspace} className="cbat-clan-numkey" aria-label="Backspace">⌫</button>
          <button type="button" onClick={onEnter} className="cbat-clan-numkey cbat-clan-numkey-enter" aria-label="Enter">↵</button>
        </div>
      </div>
    </div>
  )
}
