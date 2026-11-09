import { useEffect, useRef, useState } from 'react'
import { canCapture } from '../../../lib/chatMedia'

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  )
}

// The paperclip and the small menu it opens. Gallery everywhere; camera and
// video recorder only where there is a camera app to hand off to. Our own
// popover rather than a native control, so it stays on the dark theme.
export function AttachButton({ disabled, offline, onFiles }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const pickRef = useRef(null)
  const photoRef = useRef(null)
  const videoRef = useRef(null)
  const capture = canCapture()

  useEffect(() => {
    if (!open) return
    const close = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc) }
  }, [open])

  const choose = (ref) => { setOpen(false); ref.current?.click() }
  const onChange = (e) => { onFiles(e.target.files); e.target.value = '' }

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={disabled || offline}
        title={offline ? 'You are offline. Photos and videos need a connection.' : 'Add a photo or video'}
        aria-label="Add a photo or video"
        aria-expanded={open}
        data-testid="attach-button"
        className="px-2.5 py-2 rounded-xl border border-slate-200 text-slate-500 hover:text-brand-600 hover:border-brand-400 disabled:opacity-50 transition-colors"
      >
        <PaperclipIcon />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 mb-2 w-60 bg-surface border border-slate-200 rounded-xl card-shadow p-1 z-20"
        >
          <button type="button" role="menuitem" onClick={() => choose(pickRef)}
            className="w-full text-left px-3 py-2 rounded-lg text-sm text-slate-700 hover:bg-slate-100">
            Choose a photo or video
          </button>
          {capture && (
            <>
              <button type="button" role="menuitem" onClick={() => choose(photoRef)}
                className="w-full text-left px-3 py-2 rounded-lg text-sm text-slate-700 hover:bg-slate-100">
                Take a photo
              </button>
              <button type="button" role="menuitem" onClick={() => choose(videoRef)}
                className="w-full text-left px-3 py-2 rounded-lg text-sm text-slate-700 hover:bg-slate-100">
                Record a video
              </button>
            </>
          )}
          <p className="px-3 pt-1 pb-2 text-[11px] text-slate-400">
            Please don't send ID documents or bank details. Videos can be up to 40MB.
          </p>
        </div>
      )}
      <input ref={pickRef} type="file" accept="image/*,video/*" multiple hidden onChange={onChange} data-testid="attach-input" />
      <input ref={photoRef} type="file" accept="image/*" capture="environment" hidden onChange={onChange} />
      <input ref={videoRef} type="file" accept="video/*" capture="environment" hidden onChange={onChange} />
    </div>
  )
}

// The row of files above the message box.
export function AttachmentTray({ tray }) {
  if (!tray.items.length && !tray.error) return null
  return (
    <div className="px-3 pt-2" data-testid="attachment-tray">
      {tray.items.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {tray.items.map(item => (
            <div key={item.id} className="relative shrink-0 w-20 h-20 rounded-lg overflow-hidden border border-slate-200 bg-slate-100">
              {item.kind === 'video' ? (
                <video src={item.previewUrl} muted playsInline preload="metadata" className="w-full h-full object-cover" />
              ) : (
                <img src={item.previewUrl} alt="" className="w-full h-full object-cover" />
              )}
              {item.kind === 'video' && (
                <span className="absolute left-1 bottom-1 text-[9px] font-bold px-1 rounded bg-black/60 text-white">Video</span>
              )}
              {item.status === 'uploading' && (
                <div className="absolute inset-x-0 bottom-0 h-1.5 bg-black/40" aria-label="Uploading">
                  <div className="h-full bg-brand-600 transition-[width]" style={{ width: `${Math.round(item.progress * 100)}%` }} />
                </div>
              )}
              {item.status === 'error' && (
                <button
                  type="button"
                  onClick={() => tray.retry(item.id)}
                  title={item.error}
                  className="absolute inset-0 grid place-items-center bg-black/60 text-[10px] font-bold text-white text-center px-1"
                >
                  Upload failed. Tap to retry
                </button>
              )}
              <button
                type="button"
                onClick={() => tray.remove(item.id)}
                aria-label="Remove this file"
                className="absolute top-0.5 right-0.5 w-5 h-5 grid place-items-center rounded-full bg-black/60 text-white text-[11px] leading-none"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      {tray.error && <p className="text-[11px] text-red-600 mt-1">{tray.error}</p>}
    </div>
  )
}
