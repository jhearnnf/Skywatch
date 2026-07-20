// Admin round-skip cheat codes for ACT.
//
// Same convention as DPT's numpad codes (see CbatDpt.jsx ADMIN_ROUND_CHEATS):
// type 111 for round 1, 222 for round 2, and so on. ACT has five rounds.
// Using one flags the run as a debug session — the score is never submitted.
//
// The matcher lives here rather than in CbatAct so the sliding-window/idle
// logic can be tested without standing up an R3F canvas.

export const ADMIN_ROUND_CHEATS = { 111: 1, 222: 2, 333: 3, 444: 4, 555: 5 }

// Digits typed more than this far apart start a fresh code rather than
// extending the previous one — otherwise a "1" typed minutes ago could combine
// with a later "11" into a jump the admin never asked for.
export const CHEAT_IDLE_MS = 1500

export const emptyCheatBuffer = () => ({ digits: '', at: 0 })

// Feed one keypress into the buffer. Returns the next buffer plus the round to
// jump to (null when the last three digits aren't a code). On a match the
// buffer is cleared so the digits can't also complete an overlapping code.
export function pushCheatDigit(buffer, key, now, codes = ADMIN_ROUND_CHEATS) {
  if (typeof key !== 'string' || key.length !== 1 || key < '0' || key > '9') {
    return { buffer, round: null }
  }
  const stale = now - (buffer?.at ?? 0) > CHEAT_IDLE_MS
  const digits = ((stale ? '' : buffer?.digits ?? '') + key).slice(-3)
  const round = codes[parseInt(digits, 10)] ?? null
  if (round != null) return { buffer: emptyCheatBuffer(), round }
  return { buffer: { digits, at: now }, round: null }
}
