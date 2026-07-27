import { isCbatGameEnabled } from '../../utils/cbat/isCbatGameEnabled'

// The pool the landing page's live game wall draws from, and the rules for
// choosing one visit's worth of cards.
//
// Deliberately component-free — the game pages themselves are wired up in
// gameDemoRegistry.js — so the picking logic can be reasoned about (and tested)
// without dragging three.js and ten full game pages along with it.
//
// Fields:
//   gameKey          — backend leaderboard key, used for admin enable/disable
//   props            — passed to the page; `forcedMode` pins a multi-mode page
//                      so several cards can run different modes side by side
//   heavy            — mounts an R3F canvas; the picker rations these
//   answerIntervalMs — games that sit waiting on input need the driver to keep
//                      pressing; 0 means the game runs itself on a clock
export const GAME_DEMO_POOL = [
  { id: 'trace-2',          label: 'Trace 2',            gameKey: 'trace-2',          path: '/cbat/trace',         poster: '/images/Plane Turn.png',       props: { forcedMode: 'trace2' }, heavy: true,  answerIntervalMs: 3200 },
  { id: 'plane-turn-3d',    label: 'Trace Practise 3D',  gameKey: 'plane-turn-3d',    path: '/cbat/trace',         poster: '/images/Plane Turn.png',       props: { forcedMode: '3d' },     heavy: true,  answerIntervalMs: 1600 },
  { id: 'plane-turn-2d',    label: 'Trace Practise 2D',  gameKey: 'plane-turn-2d',    path: '/cbat/trace',         poster: '/images/Plane Turn.png',       props: { forcedMode: '2d' },     heavy: false, answerIntervalMs: 1600 },
  { id: 'visualisation-2d', label: 'Visualisation 2D',   gameKey: 'visualisation-2d', path: '/cbat/visualisation', poster: '/images/Visualisation 2D.png', props: { forcedMode: '2d' },     heavy: false, answerIntervalMs: 2800 },
  { id: 'sat',              label: 'SAT',                gameKey: 'sat',              path: '/cbat/sat',           poster: '/images/SAT.png',                                               heavy: false, answerIntervalMs: 0 },
  { id: 'cut',              label: 'CUT',                gameKey: 'cut',              path: '/cbat/cut',           poster: '/images/CUT.png',                                               heavy: false, answerIntervalMs: 1100 },
  { id: 'symbols',          label: 'Symbols',            gameKey: 'symbols',          path: '/cbat/symbols',       poster: '/images/Symbols.png',                                           heavy: false, answerIntervalMs: 1400 },
  { id: 'dpt',              label: 'DPT',                gameKey: 'dpt',              path: '/cbat/dpt',           poster: '/images/DPT.png',                                               heavy: true,  answerIntervalMs: 1800 },
  { id: 'flag',             label: 'FLAG',               gameKey: 'flag',             path: '/cbat/flag',          poster: '/images/FLAG.png',                                              heavy: true,  answerIntervalMs: 900  },
  { id: 'target',           label: 'Target',             gameKey: 'target',           path: '/cbat/target',        poster: '/images/Target.png',                                            heavy: true,  answerIntervalMs: 1500 },
  { id: 'act',              label: 'ACT',                gameKey: 'act',              path: '/cbat/act',           poster: '/images/ACT.png',                                               heavy: true,  answerIntervalMs: 0 },
  { id: 'instruments',      label: 'Instruments',        gameKey: 'instruments',      path: '/cbat/instruments',   poster: '/images/Instruments.png',                                       heavy: false, answerIntervalMs: 2400 },
]

// Fisher-Yates, on a copy.
function shuffle(list, rng) {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// Half the pool mounts an R3F canvas, so a nine-card grid can't avoid them —
// the goal is only to stop a visit landing on six at once. Take `count` games
// in the order given, skipping heavy ones past the cap; if that leaves gaps
// (which it will whenever count approaches the pool size) the skipped ones come
// back, because a hole in the grid looks worse than a busy frame.
export function takeWithHeavyCap(list, count, maxHeavy) {
  const taken = []
  const deferred = []
  let heavyUsed = 0

  for (const game of list) {
    if (taken.length >= count) break
    if (game.heavy && heavyUsed >= maxHeavy) { deferred.push(game); continue }
    if (game.heavy) heavyUsed += 1
    taken.push(game)
  }
  for (const game of deferred) {
    if (taken.length >= count) break
    taken.push(game)
  }
  return taken
}

/**
 * Pick the games for one visit.
 *
 * @param {object}   settings       AppSettings (only cbatGameEnabled is read)
 * @param {object}   opts
 * @param {number}   opts.count     how many cards to fill
 * @param {number}   opts.maxHeavy  preferred ceiling on canvas-backed games
 * @param {Function} opts.rng       injectable for tests
 */
export function pickGameDemos(settings, { count = 9, maxHeavy = 4, rng = Math.random } = {}) {
  const cbatGameEnabled = settings?.cbatGameEnabled ?? {}
  const available = GAME_DEMO_POOL.filter((g) => isCbatGameEnabled(cbatGameEnabled, g.gameKey))
  return takeWithHeavyCap(shuffle(available, rng), count, maxHeavy)
}
