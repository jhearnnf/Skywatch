import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import Overlay from './ui/Overlay'
import useUpdateNotification from '../hooks/useUpdateNotification'
import renderBodyWithLinks from '../utils/renderBodyWithLinks'

// Resolves what to render for the image given the notification's imageMode.
function resolveImageSrc(notif) {
  if (!notif) return null
  if (notif.imageMode === 'placeholder') return '/images/placeholder-brief.svg'
  if (notif.imageMode === 'custom')      return notif.imageUrl || null
  // 'upload' stores the Cloudinary URL in imageUrl, same shape as 'custom'.
  if (notif.imageMode === 'upload')      return notif.imageUrl || null
  return null
}

// Top-level update-notification renderer. Mounted once near the root (in App.jsx)
// alongside NotifLayer. Self-contained: opens whenever the hook hands us a
// "current" notification, lets the user browse the full history via prev/next,
// and acknowledges only when the modal closes on the current item (so browsing
// older ones doesn't accidentally mark them as seen).
export default function UpdateNotificationModal() {
  const { notification, history, dismiss } = useUpdateNotification()

  // viewingId tracks which doc is on-screen (may differ from `notification` when
  // the user navigates with Previous/Next). Defaults to the current notification.
  const [viewingId,      setViewingId]      = useState(null)
  const [responseDraft,  setResponseDraft]  = useState('')
  useEffect(() => {
    if (notification?._id) setViewingId(String(notification._id))
    setResponseDraft('')
  }, [notification?._id])

  const viewing = useMemo(() => {
    if (!viewingId) return notification
    return history.find(h => String(h._id) === viewingId) || notification
  }, [viewingId, history, notification])

  if (!notification || !viewing) return null

  const currentId = String(notification._id)
  const orderedIds = (history.length ? history : [notification]).map(h => String(h._id))
  const idx = orderedIds.indexOf(String(viewing._id))
  const total = orderedIds.length
  const onCurrent = String(viewing._id) === currentId
  // Responses are only collected on the current (unacked) item; browsing older
  // ones via Prev/Next is read-only.
  const showResponseInput = onCurrent && !!notification.responsesEnabled

  function goPrev() {
    // history is newest-first, so "previous in time" = next index in array.
    if (idx + 1 < total) setViewingId(orderedIds[idx + 1])
  }
  function goNext() {
    if (idx - 1 >= 0) setViewingId(orderedIds[idx - 1])
  }

  function close() {
    // Acknowledge only fires when the user dismisses on the truly-current
    // notification — browsing older ones via Previous/Next is read-only.
    // The response is sent only when typed AND on the current item.
    dismiss(currentId, showResponseInput ? responseDraft.trim() : '')
  }

  const imageSrc = resolveImageSrc(viewing)

  return (
    <Overlay
      zIndex={70}
      backdrop="rgba(8, 14, 30, 0.78)"
      lockBodyScroll
      onDismiss={close}
      className="backdrop-blur-sm flex items-center justify-center p-4"
      data-testid="update-notification-overlay"
    >
      <motion.div
        key={viewing._id}
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1,    y: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="relative bg-surface-raised border border-slate-300 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
          {imageSrc && (
            <img
              src={imageSrc}
              alt=""
              className="w-full max-h-48 object-cover rounded-t-2xl"
            />
          )}
          <div className="p-5 sm:p-6">
            <button
              aria-label="Close"
              onClick={close}
              className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 text-slate-600 hover:bg-slate-200"
            >
              ×
            </button>
            <h2 className="text-xl font-extrabold text-brand-700 pr-8">{viewing.title}</h2>
            <p className="mt-3 text-sm leading-relaxed text-text whitespace-pre-wrap">
              {renderBodyWithLinks(viewing.body)}
            </p>

            {showResponseInput && (
              <div className="mt-4">
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">
                  Have your say (optional)
                </label>
                <textarea
                  rows={3}
                  value={responseDraft}
                  onChange={e => setResponseDraft(e.target.value)}
                  placeholder="Type your thoughts…"
                  maxLength={2000}
                  data-testid="update-notification-response"
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm bg-surface text-text outline-none focus:ring-2 focus:ring-brand-600/40 resize-none"
                />
              </div>
            )}

            {total > 1 && (
              <div className="mt-5 flex items-center justify-between gap-2 border-t border-slate-200 pt-3">
                <button
                  onClick={goPrev}
                  disabled={idx + 1 >= total}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 disabled:opacity-40"
                >
                  ← Previous
                </button>
                <span className="text-[11px] text-slate-500">
                  {idx + 1} / {total}
                </span>
                <button
                  onClick={goNext}
                  disabled={idx - 1 < 0}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 disabled:opacity-40"
                >
                  Next →
                </button>
              </div>
            )}

            <button
              onClick={close}
              className="mt-5 w-full px-4 py-2.5 rounded-xl bg-brand-600 text-white font-bold text-sm hover:brightness-110"
            >
              {showResponseInput && responseDraft.trim() ? 'Submit & close' : 'Got it'}
            </button>
          </div>
      </motion.div>
    </Overlay>
  )
}
