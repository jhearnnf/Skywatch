// Helpers for the one-time push opt-in prompt (components/PushOptInPrompt.jsx).

const SEEN_KEY = 'skywatch:pushPromptSeen'

// Per device, not per account: it is THIS device's permission being asked for.
export function hasSeenPushPrompt() {
  try { return localStorage.getItem(SEEN_KEY) === '1' } catch { return false }
}

export function markPushPromptSeen() {
  try { localStorage.setItem(SEEN_KEY, '1') } catch { /* blocked storage: asks again next start */ }
}

// Something else is already asking for attention. Every app modal goes through
// ui/Overlay, which locks the page by fixing <body> while it is open; the rest
// mark themselves as dialogs. Either one means wait.
export function anotherDialogIsOpen(doc = document) {
  if (doc.body?.style?.position === 'fixed') return true
  return Boolean(doc.querySelector('[role="dialog"], [aria-modal="true"]'))
}
