const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'

function randomSymbol(exclude) {
  let s
  let attempts = 0
  do {
    const a = CHARS[Math.floor(Math.random() * CHARS.length)]
    const b = CHARS[Math.floor(Math.random() * CHARS.length)]
    s = a + b
    attempts++
  } while (exclude.has(s) && attempts < 200)
  return s
}

export function generateUniqueSymbols(count, exclude = new Set()) {
  const used = new Set(exclude)
  const result = []
  for (let i = 0; i < count; i++) {
    const s = randomSymbol(used)
    used.add(s)
    result.push(s)
  }
  return result
}
