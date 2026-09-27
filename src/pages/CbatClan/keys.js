// CLAN's keyboard. Three tasks on one keyboard with no modes, because the
// three key sets never overlap: colours, the four options, and the digits
// with Backspace and Enter for the sum.
//
// The real test has dedicated coloured buttons and lettered keys on its
// keypad, so its colours and options each sit in their own cluster. R/Y/G and
// A-D ('letters') scatter the seven keys across the keyboard, so the default
// ('grouped') copies the real keypad instead: the colours are three keys in a
// row, in the bands' left-to-right order, and the options are a 2x2 block laid
// out like the four corner boxes. 'mirrored' swaps the hands for a player
// whose right hand wants the colours free of the numpad.
//
// The layout is an account setting (User.clanKeyLayout, PATCH
// /api/users/me/clan-keys). The key list is shared with the backend.

import { CLAN_KEY_LAYOUTS, DEFAULT_CLAN_KEY_LAYOUT } from '../../../backend/constants/clanKeyLayouts.json'

export { CLAN_KEY_LAYOUTS, DEFAULT_CLAN_KEY_LAYOUT }

// The name each option has on screen, whatever key picks it.
export const OPTION_NAMES = ['A', 'B', 'C', 'D']

// `colours` in red/yellow/green order, `options` in A/B/C/D order (A top-left,
// B top-right, C bottom-left, D bottom-right). `positional` layouts are about
// where the keys sit, so they match the physical key (e.code) and work the
// same on a non-QWERTY keyboard; 'letters' is about the letter itself.
export const CLAN_KEY_LAYOUT_DEFS = {
  grouped: {
    label: 'Grouped',
    hint: 'Colours on J K L, codes on Q W / A S',
    colours: { red: 'J', yellow: 'K', green: 'L' },
    options: ['Q', 'W', 'A', 'S'],
    positional: true,
  },
  mirrored: {
    label: 'Mirrored',
    hint: 'Colours on S D F, codes on I O / K L',
    colours: { red: 'S', yellow: 'D', green: 'F' },
    options: ['I', 'O', 'K', 'L'],
    positional: true,
  },
  letters: {
    label: 'Letters',
    hint: 'Colours on R Y G, codes on A B C D',
    colours: { red: 'R', yellow: 'Y', green: 'G' },
    options: ['A', 'B', 'C', 'D'],
    positional: false,
  },
}

// A stored key that isn't a known layout falls back to the default rather
// than leaving the run with no keys.
export function clanKeyLayout(key) {
  return CLAN_KEY_LAYOUT_DEFS[key] ?? CLAN_KEY_LAYOUT_DEFS[DEFAULT_CLAN_KEY_LAYOUT]
}

// The letter a keydown stands for under this layout. Positional layouts read
// the physical key when the event carries one.
function letterOf(e, layout) {
  if (layout.positional && /^Key[A-Z]$/.test(e.code ?? '')) return e.code.slice(3)
  return e.key && e.key.length === 1 ? e.key.toUpperCase() : ''
}

// Which sim action a key maps to, or null for a key the run ignores.
export function keyAction(e, layoutKey = DEFAULT_CLAN_KEY_LAYOUT) {
  if (e.altKey || e.ctrlKey || e.metaKey) return null
  const key = e.key
  if (key === 'Enter') return { kind: 'enter' }
  if (key === 'Backspace') return { kind: 'backspace' }
  if (/^[0-9]$/.test(key)) return { kind: 'digit', value: key }
  const layout = clanKeyLayout(layoutKey)
  const letter = letterOf(e, layout)
  if (!letter) return null
  const optionIndex = layout.options.indexOf(letter)
  if (optionIndex >= 0) return { kind: 'option', value: optionIndex }
  const colour = Object.keys(layout.colours).find(c => layout.colours[c] === letter)
  if (colour) return { kind: 'colour', value: colour }
  return null
}
