export function tokenize(text) {
  if (!text) return []
  const stripped = text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^[-*•]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
  return stripped
    .split(/\s+/)
    .filter(w => w.length > 0)
    .map(word => {
      const last = word[word.length - 1]
      const dwellMultiplier =
        '.!?;'.includes(last) ? 1.6 :
        last === ','          ? 1.25 :
        1

      const focalIndex = Math.max(0, Math.min(4, Math.floor((word.length - 1) / 2.5)))

      return { word, dwellMultiplier, focalIndex }
    })
}

export function clampWpm(n) {
  return Math.max(100, Math.min(800, n))
}
