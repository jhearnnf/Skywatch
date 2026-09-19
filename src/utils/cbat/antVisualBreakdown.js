// HHMM is not decimal arithmetic. Break elapsed time at every hour boundary so
// 1455 → 1532 is taught as 5 + 32 minutes, never as column subtraction.
export function clockMinuteParts(start, end) {
  const parts = []
  let cursor = start
  while (cursor < end) {
    const nextHour = Math.floor(cursor / 60) * 60 + 60
    const stop = Math.min(nextHour, end)
    parts.push({ from: cursor, to: stop, minutes: stop - cursor })
    cursor = stop
  }
  return parts
}
