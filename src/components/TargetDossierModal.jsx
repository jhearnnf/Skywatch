import { useEffect, useRef } from 'react'

export default function TargetDossierModal({ keyword, clickX, clickY, scrollY = 0, descRect, descScrollY = 0, onClose }) {
  const isMobile = window.innerWidth <= 600
  const ref = useRef(null)

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // Desktop: position:absolute in document space so dossier scrolls with the page.
  // Horizontally: to the right of the click, clamped to screen edge.
  // Vertically: centred on the description area's midpoint via transform.
  const getStyle = () => {
    if (isMobile) return {}
    const panelW  = 320
    const margin  = 12
    const x = Math.min(clickX + margin, window.innerWidth - panelW - margin)

    // If we have the desc rect, centre the modal on it; otherwise fall back to click position
    const y = descRect
      ? descRect.top + descScrollY + descRect.height / 2
      : clickY + scrollY + margin

    return {
      position: 'absolute',
      left: x,
      top: y,
      transform: descRect ? 'translateY(-50%)' : 'none',
    }
  }

  return (
    <>
      <div className="dossier-backdrop" onClick={onClose} />
      <div
        ref={ref}
        className={`target-dossier ${isMobile ? 'target-dossier--mobile' : ''}`}
        style={getStyle()}
        role="dialog"
        aria-label="Target Dossier"
      >
        <div className="dossier__header">
          <div className="dossier__status">
            <span className="dossier__dot" />
            <span className="dossier__status-text">TARGET ACQUIRED</span>
          </div>
          <button className="dossier__close" onClick={onClose} aria-label="Close dossier">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="dossier__keyword-line">
          <span className="dossier__lock-icon">⊕</span>
          <span className="dossier__keyword">{keyword?.keyword}</span>
        </div>

        <p className="dossier__subtitle">Sights locked on · Intel retrieved</p>

        <div className="dossier__content">
          <p className="dossier__ai-text">
            {keyword?.generatedDescription || 'No intel available for this target.'}
          </p>
        </div>

        <div className="dossier__footer" style={isMobile ? { paddingBottom: 'max(env(safe-area-inset-bottom), 0.5rem)' } : undefined}>
          <span className="dossier__footer-text">SKYWATCH INTEL · CLASSIFIED</span>
        </div>
      </div>
    </>
  )
}
