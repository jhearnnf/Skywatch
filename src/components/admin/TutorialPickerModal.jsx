import { useEffect, useRef, useState } from 'react'

// Element picker — opens the target page in an iframe with ?tutorialPicker=1
// so the in-page TutorialPickerOverlay enters select mode. Communicates back
// via window.message: { type: 'tutorial-picker:select', selector, page } or
// { type: 'tutorial-picker:cancel' }. Origin is verified before accepting.
export default function TutorialPickerModal({ route, onPick, onCancel }) {
  const [editableRoute, setEditableRoute] = useState(route || '/')
  const [iframeKey,     setIframeKey]     = useState(0) // bump to remount iframe on URL change
  const iframeRef = useRef(null)

  useEffect(() => {
    function onMessage(e) {
      if (e.origin !== window.location.origin) return
      if (!e.data || typeof e.data !== 'object') return
      if (e.data.type === 'tutorial-picker:select') {
        onPick({ selector: e.data.selector, page: e.data.page || editableRoute })
      } else if (e.data.type === 'tutorial-picker:cancel') {
        onCancel()
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onPick, onCancel, editableRoute])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const iframeSrc = appendPickerQuery(editableRoute)

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-surface rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-3">
          <h3 className="text-sm font-bold text-slate-800 shrink-0">🎯 Pick an element</h3>
          <input
            type="text"
            value={editableRoute}
            onChange={e => setEditableRoute(e.target.value)}
            onBlur={() => setIframeKey(k => k + 1)}
            onKeyDown={e => { if (e.key === 'Enter') setIframeKey(k => k + 1) }}
            placeholder="/play"
            className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-mono outline-none focus:ring-2 focus:ring-brand-200 bg-surface-raised text-slate-800"
          />
          <button
            type="button"
            onClick={() => setIframeKey(k => k + 1)}
            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-700 hover:bg-slate-600 text-white"
          >
            Reload
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700"
          >
            Cancel
          </button>
        </div>

        {/* Iframe — same-origin, cookies + auth flow naturally */}
        <div className="flex-1 bg-slate-900/30">
          <iframe
            key={iframeKey}
            ref={iframeRef}
            src={iframeSrc}
            title="Element picker"
            className="w-full h-[70vh] border-0"
          />
        </div>

        <div className="px-5 py-2 border-t border-slate-200 text-[11px] text-slate-400">
          Hover an element inside the preview, then click to lock it in. Or type a CSS selector by hand and press Cancel.
        </div>
      </div>
    </div>
  )
}

function appendPickerQuery(route) {
  const r = route || '/'
  const sep = r.includes('?') ? '&' : '?'
  return `${r}${sep}tutorialPicker=1`
}
