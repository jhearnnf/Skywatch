// Three-column instructions layout for the games that can be flown on a stick —
// ACT, RTT and SMA.
//
// The joystick panel used to sit inside the instructions card. It is a tall
// panel (status, wake hint, axis bars, calibrate, raw readout, plus the game's
// own sensitivity slider) and it pushed everything below it off the bottom of a
// 1080p window. The card scrolled while the page had several hundred empty
// pixels either side of it.
//
// THE CARD STAYS DEAD CENTRE. That is the whole point of the grid rather than a
// flex row: a row of [rail, card] centres the PAIR, which shunts the card off
// to the right of the page and reads as broken. Three columns hold it where it
// has always been, with the joystick panel hanging off its left.
//
// The right column is optional. ACT puts its headphones notice there; RTT and
// SMA have nothing for it and it stays empty, which is what keeps their card
// centred. Either way the track is reserved, so a game growing a right-hand
// panel never shifts the card sideways.
//
// The centre column is `minmax(0, 28rem)`, so on a window that cannot afford
// all three tracks the card gives up width rather than the layout overflowing.
// The outer columns never shrink, so neither panel is clipped.
//
// BELOW `lg` NEITHER SIDE COLUMN IS RENDERED. A gamepad is a desktop thing, and
// on a narrow screen these panels would be back to pushing the card around,
// which is the problem this exists to solve. A game with something the player
// genuinely needs on a phone — ACT's headphones warning — renders it inside its
// own card at that size instead; see CbatAct.jsx.
//
// The shell caps every route at max-w-3xl, so a page using this also needs
// `useGameBodyClass('cbat-stick-wide', …)` while the card is up or there is no
// room for the outer tracks. See the rule in src/main.css.

export default function CbatStickLayout({ stick, aside = null, children }) {
  return (
    <div className="w-full flex flex-col items-center lg:grid lg:grid-cols-[19rem_minmax(0,28rem)_19rem] lg:justify-center lg:items-start lg:gap-5">
      <aside className="hidden lg:block" aria-label="Joystick setup">
        {stick}
      </aside>

      <div className="w-full flex flex-col items-center">
        {children}
      </div>

      {/* Reserved whether or not there is anything in it. An empty track is what
          keeps the card centred rather than centring card-plus-rail as a unit. */}
      <div className="hidden lg:block" aria-hidden={aside ? undefined : 'true'}>
        {aside}
      </div>
    </div>
  )
}
