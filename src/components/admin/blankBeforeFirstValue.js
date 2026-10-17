// For `startAtFirstValue`: each key is nulled on every row before its first
// non-zero value — before then the thing it counts hadn't started, so a flat
// zero would mislead. Null leaves a gap (and drops out of the tooltip). A key
// that is never above zero is left as it is.
export function blankBeforeFirstValue(data, keys) {
  const first = Object.fromEntries(keys.map(k => [k, data.findIndex(row => row[k] > 0)]))
  return data.map((row, idx) => {
    const blank = keys.filter(k => first[k] > idx)
    if (!blank.length) return row
    const out = { ...row }
    for (const k of blank) out[k] = null
    return out
  })
}
