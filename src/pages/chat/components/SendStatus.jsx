import { useEffect, useState } from 'react'

// How long a send may take before it is worth saying it is still going. Most
// land well inside this, and an indicator that flashed up on every message
// would be noise.
export const SENDING_INDICATOR_DELAY_MS = 2_000

// Under a message you have sent that the server has not confirmed yet, in the
// Community thread and the CBAT Lounge alike. Nothing for the first couple of
// seconds, then a small spinner with "Sending…" (the queue keeps retrying
// behind it, see lib/chatOutbox.js); on failure, the reason and what you can
// do about it.
export default function SendStatus({ message, onRetry, onDiscard, compact = false }) {
  const [slow, setSlow] = useState(false)
  const sending = message.localState === 'sending'
  // Not reset when a send fails: a retry of one that was already slow shows
  // the spinner straight away, which is the honest answer.
  useEffect(() => {
    if (!sending) return
    const id = setTimeout(() => setSlow(true), SENDING_INDICATOR_DELAY_MS)
    return () => clearTimeout(id)
  }, [sending])

  const text = compact ? 'text-[10px]' : 'text-[11px]'

  if (sending) {
    if (!slow) return null
    return (
      <p
        role="status"
        aria-label="Sending message"
        data-testid="message-sending"
        className={`mt-0.5 flex items-center gap-1.5 ${text} text-slate-500`}
      >
        <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full border-[1.5px] border-slate-400/40 border-t-brand-600 animate-spin" />
        Sending…
      </p>
    )
  }

  return (
    <p className={`mt-0.5 ${text} text-red-600`} data-testid="message-failed">
      Not sent.
      {onRetry && (
        <button type="button" onClick={() => onRetry(message)} className="ml-1.5 font-bold underline underline-offset-2 hover:text-red-700">
          Try again
        </button>
      )}
      {onDiscard && (
        <button type="button" onClick={() => onDiscard(message)} className="ml-1.5 font-bold underline underline-offset-2 hover:text-red-700">
          Delete
        </button>
      )}
    </p>
  )
}
