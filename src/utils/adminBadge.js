// The Admin nav dot, in one place so the sidebar and the bottom nav light up on
// exactly the same thing the Admin panel's Intel tab does. Anything that puts a
// dot on Intel — an unsolved user report, an unresolved system log — has to put
// one on the nav entry as well, or the only way to find out is to open Admin.

export const hasAdminAlerts = (unsolvedCount = 0, unresolvedSystemLogs = 0) =>
  unsolvedCount > 0 || unresolvedSystemLogs > 0

// Names each queue separately rather than summing them: "3 items" tells you
// nothing about where to look, and reports and system logs live on different
// Intel sub-tabs.
export const adminBadgeLabel = (unsolvedCount = 0, unresolvedSystemLogs = 0) => {
  const parts = []
  if (unsolvedCount > 0) parts.push(`${unsolvedCount} unsolved report${unsolvedCount !== 1 ? 's' : ''}`)
  if (unresolvedSystemLogs > 0) parts.push(`${unresolvedSystemLogs} unresolved system log${unresolvedSystemLogs !== 1 ? 's' : ''}`)
  return parts.join(', ')
}
