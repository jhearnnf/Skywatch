// Two-column instructions layout for the games that can be flown on a stick —
// ACT, RTT and SMA.
//
// The joystick panel used to sit inside the instructions card. It is a tall
// panel (status, wake hint, axis bars, calibrate, raw readout, plus the game's
// own sensitivity slider) and it pushed everything below it off the bottom of a
// 1080p window. The card scrolled while the page had several hundred empty
// pixels either side of it.
//
// THE CARD STAYS DEAD CENTRE. That is the whole point of the grid below rather
// than a two-item flex row: a row of [rail, card] centres the PAIR, which
// shunts the card off to the right of the page and reads as broken. Three
// columns — rail, card, and an empty one the same width as the rail — leave the
// card exactly where it has always been, with the panel hanging off its left
// and open space on its right.
//
// The centre column is `minmax(0, 28rem)`, so on a window that cannot afford
// all three tracks the card gives up width rather than the layout overflowing.
// The rail columns never shrink, so the panel is never clipped.
//
// BELOW `lg` THE RAIL IS NOT RENDERED AT ALL. A gamepad is a desktop thing:
// nobody is flying a CBAT test on a stick plugged into a phone, and on a narrow
// screen the panel would be back to pushing the card around — which is the
// problem this exists to solve. The setup it holds is not needed to play with a
// mouse or a finger, so nothing is lost by leaving it out.
//
// The shell caps every route at max-w-3xl, so a page using this also needs
// `useGameBodyClass('cbat-stick-wide', …)` while the card is up or there is no
// room for the outer tracks. See the rule in src/main.css.

export default function CbatStickLayout({ stick, children }) {
  return (
    <div className="w-full flex flex-col items-center lg:grid lg:grid-cols-[19rem_minmax(0,28rem)_19rem] lg:justify-center lg:items-start lg:gap-5">
      <aside className="hidden lg:block" aria-label="Joystick setup">
        {stick}
      </aside>

      <div className="w-full flex flex-col items-center">
        {children}
      </div>

      {/* Deliberately empty. It is what keeps the card centred on the page
          instead of centring the card-plus-rail as a unit. */}
      <div className="hidden lg:block" aria-hidden="true" />
    </div>
  )
}
