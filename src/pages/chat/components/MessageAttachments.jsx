import { useEffect, useState } from 'react'
import Overlay from '../../../components/ui/Overlay'

// Full-screen view of one photo. Tap anywhere, or Escape, to close.
function Lightbox({ src, onClose }) {
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])
  return (
    <Overlay
      zIndex={100}
      backdrop="rgba(0, 0, 0, 0.9)"
      onDismiss={onClose}
      lockBodyScroll
      className="flex items-center justify-center p-4"
      data-testid="attachment-lightbox"
    >
      <img src={src} alt="" onClick={onClose} className="max-w-full max-h-full object-contain" />
      <button
        type="button"
        onClick={onClose}
        aria-label="Close photo"
        className="absolute top-4 right-4 w-9 h-9 grid place-items-center rounded-full bg-white/10 text-white text-lg"
      >
        ✕
      </button>
    </Overlay>
  )
}

// Photos and videos under a message. Thumbnails reserve their space from the
// stored width/height so the thread does not jump as they load.
export default function MessageAttachments({ attachments }) {
  const [open, setOpen] = useState(null)
  if (!attachments?.length) return null

  const box = (a) => {
    const w = a.width || 4
    const h = a.height || 3
    return { aspectRatio: `${w} / ${h}` }
  }

  return (
    <div className="mt-1 flex flex-wrap gap-2" data-testid="message-attachments">
      {attachments.map((a, i) => (a.kind === 'video' ? (
        <video
          key={i}
          src={a.url}
          poster={a.posterUrl || undefined}
          controls
          playsInline
          preload="metadata"
          style={box(a)}
          className="w-64 max-w-full max-h-80 rounded-lg border border-slate-200 bg-black"
        />
      ) : (
        <button
          key={i}
          type="button"
          onClick={() => setOpen(a.url)}
          aria-label="Open photo"
          style={box(a)}
          className="w-48 max-w-full max-h-72 rounded-lg overflow-hidden border border-slate-200 bg-slate-100"
        >
          <img src={a.thumbUrl || a.url} alt="" loading="lazy" className="w-full h-full object-cover" />
        </button>
      )))}
      {open && <Lightbox src={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
