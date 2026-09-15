// Whether an Enter keypress in a chat box should send the message.
//
// On a physical keyboard Enter sends and Shift+Enter starts a new line. On a
// phone the on-screen keyboard has no Shift+Enter, so Enter is the only way
// to break a line; there it must insert a newline and leave sending to the
// Send button.
export function enterShouldSend(e) {
  if (e.key !== 'Enter' || e.shiftKey) return false
  return !(typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches)
}
