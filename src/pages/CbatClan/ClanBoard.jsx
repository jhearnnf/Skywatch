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
//
// Every key hint on the board (the corner key caps, the colour keys) shows the
// key the player's chosen layout binds (./keys.js), never a fixed letter.
//
// `tutorial` is set only by the tutorial (./ClanTutorial.jsx, logic in
// utils/cbat/clanTutorial.js). It names what is in focus, which the board then
// lights (the band shows its key, the right box and its key cap, the matching
// on-screen keys), zooms toward, and keeps sharp while every other part blurs
// and greys out. It also carries the points pop-ups. Null on a test run, which
// lights nothing and never zooms.

import { CbatKeyCap } from '../../components/cbat/CbatTestChrome'
import { CLAN_BANDS } from '../../utils/cbat/clanSim'
import { CLAN_COLOURS } from '../../utils/cbat/clanDifficulty'
import { OPTION_NAMES } from './keys'
import { ZOOM_SCALE } from '../../utils/cbat/clanTutorial'

// Where each of the four options sits. The real screen reads A top-left,
// B top-right, C bottom-left, D bottom-right.
const OPTION_SLOTS = ['tl', 'tr', 'bl', 'br']

// Which parts of the board stay sharp for each kind of focus in the tutorial.
const FOCUS_AREAS = {
  colour: ['arena', 'colourKeys'],
  code:   ['options'],
  sum:    ['maths', 'numpad'],
}

function OptionBox({ index, text, keyLabel, lit, dimmed, feedback, disabled, onPick }) {
  const label = OPTION_NAMES[index]
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
      data-lit={lit || undefined}
      className={`cbat-clan-option cbat-clan-option-${OPTION_SLOTS[index]}${verdict ? ` cbat-clan-option-${verdict}` : ''}${lit ? ' cbat-clan-option-lit' : ''}${dimmed ? ' cbat-clan-dim' : ''}`}
      aria-label={text ? `Option ${label}: ${text} (${keyLabel})` : `Option ${label} (${keyLabel})`}
    >
      <span className="cbat-clan-option-text">{text ?? ''}</span>
      <span className="cbat-clan-option-key" aria-hidden="true">
        <CbatKeyCap label={keyLabel} />
        <span className="cbat-clan-option-key-sw">{keyLabel}</span>
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
  snapshot, cbat, layout, tutorial = null, onColour, onOption, onDigit, onBackspace, onEnter,
}) {
  const { diamonds, letters, maths } = snapshot
  const asking = letters.phase === 'asking'
  const mathFeedback = maths.feedback
  const digits = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0']
  const focus = tutorial?.focus ?? null
  const guide = tutorial?.lighting ?? null
  // The tutorial flags the code while it is up, so it is never missed; and
  // never blurs it, even while a diamond has the focus.
  const memorise = !!tutorial && letters.phase === 'showing' && !!letters.code
  const dim = (area) => (focus && !FOCUS_AREAS[focus.kind].includes(area) && !(memorise && area === 'letters') ? ' cbat-clan-dim' : '')

  return (
    <div
      className={`cbat-clan-board${cbat ? ' cbat-clan-real' : ''}${tutorial ? ' cbat-clan-tutorial' : ''}`}
      data-testid="clan-board"
      data-focus={focus?.kind}
    >
      <div className="cbat-clan-stage">
        <div
          className="cbat-clan-grid"
          style={tutorial ? { transform: `scale(${focus ? ZOOM_SCALE : 1})`, transformOrigin: tutorial.zoomOrigin } : undefined}
        >
          <OptionBox index={0} text={asking ? letters.options[0] : null} keyLabel={layout.options[0]} lit={guide?.option === 0} dimmed={!!dim('options')} feedback={cbat ? null : letters.feedback} disabled={!asking} onPick={onOption} />

          {/* The code box. Blank between codes and while the options are up. */}
          <div
            className={`cbat-clan-letters${dim('letters')}${memorise ? ' cbat-clan-letters-memorise' : ''}${letters.feedback && !cbat ? (letters.feedback.correct ? ' cbat-clan-letters-correct' : ' cbat-clan-letters-wrong') : ''}`}
            data-testid="clan-letters"
            aria-live="polite"
          >
            {letters.code && <span className="cbat-clan-code">{letters.code}</span>}
            {memorise && (
              <span className="cbat-clan-remember" data-testid="clan-remember">
                Remember this <span aria-hidden="true">›</span>
              </span>
            )}
            {!cbat && letters.phase === 'showing' && <span className="cbat-clan-caption">Memorise</span>}
            {!cbat && asking && <span className="cbat-clan-caption">Which was it?</span>}
          </div>

          <OptionBox index={1} text={asking ? letters.options[1] : null} keyLabel={layout.options[1]} lit={guide?.option === 1} dimmed={!!dim('options')} feedback={cbat ? null : letters.feedback} disabled={!asking} onPick={onOption} />

          {/* The arena. Bands take the right half; diamonds cross from the left. */}
          <div className={`cbat-clan-arena${dim('arena')}`} data-testid="clan-arena">
            {CLAN_COLOURS.map(c => {
              const [lo, hi] = CLAN_BANDS[c]
              const lit = !!guide?.colours.includes(c)
              return (
                <span
                  key={c}
                  className={`cbat-clan-band cbat-clan-band-${c}${lit ? ' cbat-clan-band-lit' : ''}`}
                  style={{ left: `${lo * 100}%`, width: `${(hi - lo) * 100}%` }}
                  data-lit={lit || undefined}
                  aria-hidden="true"
                >
                  {lit && <span className="cbat-clan-guide-key">{layout.colours[c]}</span>}
                </span>
              )
            })}
            {diamonds.map(d => <Diamond key={d.id} d={d} cbat={cbat} />)}
          </div>

          <OptionBox index={2} text={asking ? letters.options[2] : null} keyLabel={layout.options[2]} lit={guide?.option === 2} dimmed={!!dim('options')} feedback={cbat ? null : letters.feedback} disabled={!asking} onPick={onOption} />

          {/* The sum. */}
          <div
            className={`cbat-clan-maths${dim('maths')}${mathFeedback && !cbat ? (mathFeedback.correct ? ' cbat-clan-maths-correct' : ' cbat-clan-maths-wrong') : ''}`}
            data-testid="clan-maths"
          >
            {maths.question ? (
              <span className="cbat-clan-sum">
                {maths.question} ={' '}
                {focus?.kind === 'sum' ? (
                  // The tutorial's sum: a blinking cursor after whatever is typed,
                  // to say the answer goes here.
                  <span className="cbat-clan-entered cbat-clan-entered-active">
                    {maths.entered}<span className="cbat-clan-caret" data-testid="clan-caret" aria-hidden="true" />
                  </span>
                ) : (
                  <span className="cbat-clan-entered">{maths.entered || (cbat ? '' : '_')}</span>
                )}
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

          <OptionBox index={3} text={asking ? letters.options[3] : null} keyLabel={layout.options[3]} lit={guide?.option === 3} dimmed={!!dim('options')} feedback={cbat ? null : letters.feedback} disabled={!asking} onPick={onOption} />
        </div>

        {/* Points pop-ups, over the grid but outside it so the zoom leaves them be. */}
        {tutorial?.popups.map(p => (
          <span
            key={p.id}
            className={`cbat-clan-pop cbat-clan-pop-${p.tone}`}
            style={{ left: p.at.left, top: p.at.top }}
            data-clan-pop={p.tone}
            aria-live="polite"
          >
            <span className="cbat-clan-pop-points">{p.points}</span>
            <span className="cbat-clan-pop-text">{p.text}</span>
          </span>
        ))}
      </div>

      {/* On-screen keys. A desktop plays this on the keyboard; a phone or a
          tablet has nothing else. Under the Real CBAT theme the strip is hidden
          on a hover-capable desktop, the Symbols arrangement. */}
      <div className="cbat-clan-keys" data-testid="clan-keys">
        <div className={`cbat-clan-colour-keys${dim('colourKeys')}`}>
          {CLAN_COLOURS.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => onColour(c)}
              className={`cbat-clan-colour-key cbat-clan-colour-key-${c}${guide?.colours.includes(c) ? ' cbat-clan-key-lit' : ''}`}
              aria-label={`${c} (${layout.colours[c]})`}
              data-clan-colour-key={c}
            >
              {layout.colours[c]}
            </button>
          ))}
        </div>
        <div className={`cbat-clan-numpad${dim('numpad')}`}>
          {digits.map(d => (
            <button key={d} type="button" onClick={() => onDigit(d)} className="cbat-clan-numkey" data-clan-digit={d}>{d}</button>
          ))}
          <button type="button" onClick={onBackspace} className="cbat-clan-numkey" aria-label="Backspace">⌫</button>
          <button type="button" onClick={onEnter} className={`cbat-clan-numkey cbat-clan-numkey-enter${guide?.enter ? ' cbat-clan-key-lit' : ''}`} aria-label="Enter">↵</button>
        </div>
      </div>
    </div>
  )
}
