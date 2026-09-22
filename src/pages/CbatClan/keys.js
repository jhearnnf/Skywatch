// CLAN's keyboard. R/Y/G for the colours, A to D for the four options, the
// digits, Backspace and Enter for the sum: three tasks on one keyboard with
// no modes, because none of the sets overlap.

export const OPTION_KEYS = ['A', 'B', 'C', 'D']
export const COLOUR_KEYS = { red: 'R', yellow: 'Y', green: 'G' }

// Which sim action a key maps to, or null for a key the run ignores.
export function keyAction(e) {
  if (e.altKey || e.ctrlKey || e.metaKey) return null
  const key = e.key
  if (key === 'Enter') return { kind: 'enter' }
  if (key === 'Backspace') return { kind: 'backspace' }
  if (/^[0-9]$/.test(key)) return { kind: 'digit', value: key }
  const upper = key.length === 1 ? key.toUpperCase() : ''
  const optionIndex = OPTION_KEYS.indexOf(upper)
  if (optionIndex >= 0) return { kind: 'option', value: optionIndex }
  const colour = Object.keys(COLOUR_KEYS).find(c => COLOUR_KEYS[c] === upper)
  if (colour) return { kind: 'colour', value: colour }
  return null
}
