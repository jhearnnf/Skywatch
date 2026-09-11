export const SUPPORT_LABEL = 'SkyWatch Support'

export function formatTime(ts) {
  try {
    const d = new Date(ts)
    return d.toLocaleString([], { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })
  } catch { return '' }
}

// A full, unambiguous stamp: date, year and clock time. Used where a message
// is a dated record rather than a line of conversation — an announcement is
// read weeks later, and "Aug 30" alone leaves the reader guessing the year.
export function formatStamp(ts) {
  try {
    const d = new Date(ts)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleString([], {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    })
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

// "Online now" / "Last online 12m ago" / "Last online 11 Sept, 17:45", for the
// admin's DM header. The three-minute cut matches the server's "here" presence
// window (PRESENCE_HERE_WINDOW_MS): heartbeats land every 30s while the tab is
// active, so anyone seen inside it is on the site as you read this.
export const ONLINE_NOW_MS = 3 * 60 * 1000

export function isOnlineNow(ts) {
  if (!ts) return false
  const then = new Date(ts).getTime()
  return !Number.isNaN(then) && Date.now() - then < ONLINE_NOW_MS
}

export function formatLastOnline(ts) {
  if (!ts) return 'Not been online yet'
  const then = new Date(ts).getTime()
  if (Number.isNaN(then)) return ''
  if (isOnlineNow(ts)) return 'Online now'
  const ms = Math.max(0, Date.now() - then)
  const secs = Math.round(ms / 1000)
  if (secs < 3600)   return `Last online ${Math.floor(secs / 60)}m ago`
  if (secs < 86400)  return `Last online ${Math.floor(secs / 3600)}h ago`
  if (secs < 604800) return `Last online ${Math.floor(secs / 86400)}d ago`
  return `Last online ${formatTime(ts)}`
}

// How to name a user in chat. Display names are required to post, so the agent
// number fallback only shows for accounts that have never posted (and for the
// odd historic message sent before the requirement existed).
export function agentLabel(user) {
  if (!user) return 'Unknown agent'
  return user.displayName || (user.agentNumber ? `Agent #${user.agentNumber}` : 'Unknown agent')
}
