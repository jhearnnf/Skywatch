// "Android 1.2.34 (39)": what the reporter's client said it was running when
// they asked for help. Null on reports filed before this was captured, and on
// any client that could not name its build; the line is then simply absent.
// Shared by Admin › Reports and the support ticket's admin tools.
export function reportClientLabel(p) {
  if (!p?.clientPlatform) return null
  const os = { android: 'Android', ios: 'iOS', web: 'Web' }[p.clientPlatform] ?? p.clientPlatform
  return [os, p.clientVersion, p.clientBuild ? `(${p.clientBuild})` : null].filter(Boolean).join(' ')
}
