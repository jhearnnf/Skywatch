// Per-user name colours, Discord-style.
//
// Assignment is deterministic from the user id, not random per render: a name
// that changed colour on every poll would be worse than no colour at all. The
// same agent is always the same colour, for everyone, on every device, with no
// state to store.
//
// The palette is hand-picked to sit on the dark surface (#0c1829) rather than
// generated from a hue wheel — an even hue spread produces blues that vanish
// into the brand colour and yellows that glare. Every entry here was chosen to
// clear roughly 7:1 contrast on the chat background, so names stay readable at
// the 13px they render at.
const PALETTE = [
  '#7dd3fc', // sky
  '#86efac', // green
  '#fca5a5', // salmon
  '#c4b5fd', // violet
  '#fcd34d', // amber
  '#5eead4', // teal
  '#f9a8d4', // pink
  '#a5b4fc', // indigo
  '#fdba74', // orange
  '#bef264', // lime
  '#67e8f9', // cyan
  '#d8b4fe', // purple
]

// FNV-1a. Cheap, well-distributed for short strings, and stable across
// engines — which a naive charCode sum is not once ids share a prefix, as
// consecutive ObjectIds do.
function hash(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function nameColour(userId) {
  if (!userId) return '#94a3b8'
  return PALETTE[hash(String(userId)) % PALETTE.length]
}

export { PALETTE }
