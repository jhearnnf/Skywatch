// The bot that plays a demo-mounted CBAT game.
//
// Games are mounted for real (see demoHarness.jsx) but nobody is holding the
// controls, so this drives them from the outside: find the start control, press
// it, then — for the games that sit waiting on input rather than running on a
// clock — keep pressing answer controls at a steady cadence.
//
// It only ever touches elements carrying an explicit `data-demo-*` attribute
// inside the card it was given, so it can never wander into a Back or Quit
// button, and the coupling to each game stays greppable.

export const START_SELECTOR  = '[data-demo-start]'
export const ANSWER_SELECTOR = '[data-demo-answer]'

// Press an element the way a person would. Games bind variously to onClick and
// onPointerDown (the Trace practise rotate pads use the latter), so fire the
// whole sequence rather than guessing which one is listening.
export function press(el) {
  if (!el) return false
  const opts = { bubbles: true, cancelable: true }
  try {
    if (typeof window.PointerEvent === 'function') {
      el.dispatchEvent(new window.PointerEvent('pointerdown', opts))
      el.dispatchEvent(new window.PointerEvent('pointerup', opts))
    }
    el.dispatchEvent(new MouseEvent('mousedown', opts))
    el.dispatchEvent(new MouseEvent('mouseup', opts))
    el.click()
    return true
  } catch {
    return false
  }
}

const enabled = (el) => !el.disabled && el.getAttribute('aria-disabled') !== 'true'

function pickTarget(root, selector, mode) {
  const all = Array.from(root.querySelectorAll(selector)).filter(enabled)
  if (all.length === 0) return null
  if (mode === 'random') return all[Math.floor(Math.random() * all.length)]
  return all[0]
}

/**
 * Drive one demo game.
 *
 * The start hunt runs for the whole life of the card, not just at the
 * beginning. `data-demo-start` marks every control that (re)starts play —
 * the intro Start button, but also Retry on a crash screen and Next Level on a
 * completed one. Pressing whichever is on screen is what keeps a card looking
 * like somebody is sat there playing it, instead of freezing on the first
 * end-of-round screen it hits.
 *
 * @param {HTMLElement} root         the card's stage element
 * @param {object}      opts
 * @param {number}      opts.answerIntervalMs  press an answer this often; 0 = never
 * @param {number}      opts.startTimeoutMs    no start control ever seen → give up
 * @param {number}      opts.stallTimeoutMs    silence that counts as stuck
 * @param {Function}    opts.onFail            called with a reason when the card
 *                                             should fall back to its poster
 * @param {Function}    opts.onStart           called on the first start press
 * @returns {Function}  cancel
 */
export function runDemoDriver(root, {
  answerIntervalMs  = 0,
  startTimeoutMs    = 8000,
  stallTimeoutMs    = 15000,
  startCooldownMs   = 1500,
  onFail            = () => {},
  onStart           = () => {},
  pollMs            = 300,
} = {}) {
  if (!root) return () => {}

  let cancelled = false
  let started = false
  let lastStartPress = 0
  let poll = null
  let answerTimer = null
  let stallTimer = null
  let observer = null
  let mutated = false

  const stop = () => {
    cancelled = true
    if (poll) clearInterval(poll)
    if (answerTimer) clearInterval(answerTimer)
    if (stallTimer) clearInterval(stallTimer)
    if (observer) observer.disconnect()
  }

  // A game that renders but never animates is worse than no game at all — a
  // frozen card reads as a broken page. Watch for DOM churn and fall back to
  // the poster if the card goes quiet for too long.
  if (typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(() => { mutated = true })
    observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true })
  }

  // A hidden tab stops getting rAF callbacks and throttles timers, so a
  // perfectly healthy card looks dead: no DOM churn for the stall check, no
  // progress for the start check. Both deadlines therefore pause with the tab —
  // otherwise alt-tabbing for fifteen seconds retired every card to its poster
  // for good, and the wall was still posters when the visitor came back.
  const isHidden = () => typeof document !== 'undefined' && document.hidden

  let startedAt = Date.now()
  poll = setInterval(() => {
    if (cancelled) return
    if (isHidden()) { startedAt = Date.now(); return }
    const target = pickTarget(root, START_SELECTOR, 'first')

    if (target) {
      // Cooldown so a start screen that lingers for a frame or two after the
      // press doesn't get hammered.
      if (Date.now() - lastStartPress < startCooldownMs) return
      lastStartPress = Date.now()
      press(target)
      if (!started) { started = true; onStart() }
      return
    }

    // Never found one at all — this card can't be driven; show its poster.
    if (!started && Date.now() - startedAt > startTimeoutMs) {
      stop()
      onFail('no-start')
    }
  }, pollMs)

  // Answer presses are harmless when no answer control is on screen, so the
  // cadence just runs — no need to sequence it behind the start.
  if (answerIntervalMs > 0) {
    answerTimer = setInterval(() => {
      if (cancelled) return
      press(pickTarget(root, ANSWER_SELECTOR, 'random'))
    }, answerIntervalMs)
  }

  if (observer && stallTimeoutMs > 0) {
    stallTimer = setInterval(() => {
      if (cancelled) return
      if (isHidden()) { mutated = false; return }
      if (!mutated) { stop(); onFail('stalled'); return }
      mutated = false
    }, stallTimeoutMs)
  }

  return stop
}
