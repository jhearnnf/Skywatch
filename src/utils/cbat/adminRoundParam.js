// Admin-only "start at round N", via ?round=N on a CBAT game's URL.
//
// Why a URL parameter and not more typed cheat codes: the codes do not
// generalise. They are re-implemented per game, they collide with any game
// whose play input is digits (DPT has to intercept 555 before it becomes a
// bearing), and ACT disables them outright on touch devices — which is every
// Clipper capture, because the recording browser reports touch in order to get
// the mobile layout. A parameter has none of those problems: it is set before
// the game starts, needs no keyboard, and can never be mistaken for play input.
//
// It is strictly a debug affordance. Every caller flags the run so its score is
// never submitted, exactly as the typed codes do — the rounds before the jump
// did not happen, so the result is not a result.

// The requested round, or null if there isn't a usable one.
//
// Pure and exported so the validation can be tested without a router: the
// parsing is where an out-of-range or hand-mangled value has to be rejected,
// and that is worth more coverage than the wiring around it.
export function parseRoundParam(search, totalRounds) {
  const raw = new URLSearchParams(search || '').get('round');
  if (raw === null) return null;

  // Digits only, and deliberately not trimmed. Number() would take '5.9',
  // '0x5', '1e1' and ' 5 ' and hand back something that looks like a round —
  // and setCurrentIdx(5.9 - 1) indexes a rounds array with 4.9. Whitespace in a
  // query value means the URL is mangled, so there is nothing to be gained by
  // guessing what it meant.
  if (!/^\d+$/.test(raw)) return null;

  const round = Number(raw);
  if (round < 1 || round > totalRounds) return null;
  return round;
}
