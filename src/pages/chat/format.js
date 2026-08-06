export const SUPPORT_LABEL = 'SkyWatch Support'

export function formatTime(ts) {
  try {
    const d = new Date(ts)
    return d.toLocaleString([], { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })
  } catch { return '' }
}

// Relative time for list rows, where an exact timestamp is noise.
export function formatRelative(ts) {
  if (!ts) return ''
  const then = new Date(ts).getTime()
  if (Number.isNaN(then)) return ''
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (secs < 60)    return 'now'
  if (secs < 3600)  return `${Math.floor(secs / 60)}m`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`
  if (secs < 604800) return `${Math.floor(secs / 86400)}d`
  return formatTime(ts)
}

// How to name a user in chat. Display names are required to post, so the agent
// number fallback only shows for accounts that have never posted (and for the
// odd historic message sent before the requirement existed).
export function agentLabel(user) {
  if (!user) return 'Unknown agent'
  return user.displayName || (user.agentNumber ? `Agent #${user.agentNumber}` : 'Unknown agent')
}
