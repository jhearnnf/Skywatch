// Pure generators for CLAN's three tasks. Every function takes an `rng`
// (a Math.random-shaped function) so a seeded run reproduces exactly, which is
// what the sim tests lean on.

const rand = (rng, n) => Math.floor(rng() * n)
const randRange = (rng, lo, hi) => lo + rand(rng, hi - lo + 1)

// Consonants only, and none that look like each other at a glance on the real
// screen's serif face: no I (looks like L or 1), no O (0), no Q (O). A code
// built from these is remembered by its letters, not by which glyph was the
// ambiguous one.
export const CLAN_LETTER_POOL = 'BCDFGHJKLMNPRSTVWXYZ'

// A code of `length` distinct letters.
export function generateLetterCode(length, rng = Math.random) {
  const pool = CLAN_LETTER_POOL.split('')
  const out = []
  for (let i = 0; i < length; i++) {
    const idx = rand(rng, pool.length)
    out.push(pool[idx])
    pool.splice(idx, 1)
  }
  return out.join('')
}

// The four options the real screen puts in its corners differ from the code in
// exactly ONE position — XJNVP / XMNVP / XTNVP / XFNVP — so the only way to be
// sure is to have held the whole code, not its shape. The distractor letters
// at that position are distinct from the code's letter, from each other, and
// from every other letter in the code (so no option is a rearrangement).
// Returns `{ options, correctIndex }` with the options shuffled.
export function buildLetterOptions(code, rng = Math.random) {
  const letters = code.split('')
  const position = rand(rng, letters.length)
  const used = new Set(letters)
  const pool = CLAN_LETTER_POOL.split('').filter(l => !used.has(l))
  const distractors = []
  while (distractors.length < 3) {
    const idx = rand(rng, pool.length)
    distractors.push(pool[idx])
    pool.splice(idx, 1)
  }
  const options = [code, ...distractors.map(l => {
    const copy = letters.slice()
    copy[position] = l
    return copy.join('')
  })]
  // Fisher–Yates
  for (let i = options.length - 1; i > 0; i--) {
    const j = rand(rng, i + 1)
    ;[options[i], options[j]] = [options[j], options[i]]
  }
  return { options, correctIndex: options.indexOf(code), position }
}

// ── Sums ─────────────────────────────────────────────────────────────────────
// Three bands, the same shape as FLAG's maths bank but rng-driven. The answer
// is always a non-negative whole number, so a run never asks for a minus sign
// or a decimal on a numpad that has neither.

function ensurePositive(a, b) {
  return a >= b ? [a, b] : [b, a]
}

const sum = (question, answer) => ({ question, answer, expectedDigits: String(answer).length })

function generateEasy(rng) {
  const op = rand(rng, 2) === 0 ? '+' : '-'
  let a = randRange(rng, 1, 10)
  let b = randRange(rng, 1, 10)
  if (op === '-') [a, b] = ensurePositive(a, b)
  return sum(`${a} ${op} ${b}`, op === '+' ? a + b : a - b)
}

function generateMedium(rng) {
  const type = rand(rng, 3)
  if (type === 0) {
    // Times tables, both operands small — the real screen's "3 × 3 =".
    const a = randRange(rng, 2, 12)
    const b = randRange(rng, 2, 9)
    return sum(`${a} × ${b}`, a * b)
  }
  if (type === 1) {
    // Evenly divisible: pick the quotient first.
    const quotient = randRange(rng, 2, 12)
    const divisor = randRange(rng, 2, 9)
    return sum(`${quotient * divisor} ÷ ${divisor}`, quotient)
  }
  // Two-digit add/subtract.
  const a = randRange(rng, 11, 60)
  const b = randRange(rng, 11, 40)
  const op = rand(rng, 2) === 0 ? '+' : '-'
  const [x, y] = op === '-' ? ensurePositive(a, b) : [a, b]
  return sum(`${x} ${op} ${y}`, op === '+' ? x + y : x - y)
}

function generateHard(rng) {
  const roll = rng()
  if (roll < 0.5) {
    const a = randRange(rng, 100, 400)
    const b = randRange(rng, 11, 99)
    const op = rand(rng, 2) === 0 ? '+' : '-'
    return sum(`${a} ${op} ${b}`, op === '+' ? a + b : a - b)
  }
  if (roll < 0.85) {
    const a = randRange(rng, 11, 25)
    const b = randRange(rng, 3, 9)
    return sum(`${a} × ${b}`, a * b)
  }
  const quotient = randRange(rng, 6, 15)
  const divisor = randRange(rng, 4, 12)
  return sum(`${quotient * divisor} ÷ ${divisor}`, quotient)
}

export function generateClanMath(band, rng = Math.random) {
  if (band === 'easy') return generateEasy(rng)
  if (band === 'hard') return generateHard(rng)
  return generateMedium(rng)
}

// Which band the next sum comes from, by the difficulty's weights.
export function pickMathBand(weights, rng = Math.random) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0)
  const total = entries.reduce((acc, [, w]) => acc + w, 0)
  let roll = rng() * total
  for (const [key, w] of entries) {
    roll -= w
    if (roll <= 0) return key
  }
  return entries[entries.length - 1][0]
}

// Evenly-spaced trigger times for a run's sums, jittered so the cadence isn't
// metronomic. FLAG learned this the hard way: a per-tick random roll served
// one question in a whole run. A schedule delivers the count the tuning
// promises; the sim still defers a due sum while another is up.
export function buildMathSchedule(count, firstMs, spanMs, rng = Math.random) {
  const step = (spanMs - firstMs) / count
  const times = []
  for (let i = 0; i < count; i++) {
    times.push(Math.max(firstMs, firstMs + i * step + (rng() - 0.5) * step * 0.4))
  }
  return times.sort((a, b) => a - b)
}

// A small seedable rng for tests and demos (mulberry32).
export function seededRng(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
