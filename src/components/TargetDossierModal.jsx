import { useEffect, useRef } from 'react'

export default function TargetDossierModal({ keyword, clickX, clickY, scrollY = 0, onClose }) {
  const isMobile = window.innerWidth <= 600
  const ref = useRef(null)

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // Desktop: position:absolute in document space so dossier scrolls with the page.
  // clickX/clickY are viewport-relative; add scrollY to get document-relative top.
  const getStyle = () => {
    if (isMobile) return {}
    const panelW = 320
    const margin = 12
    const x = Math.min(clickX + margin, window.innerWidth - panelW - margin)
    const y = clickY + scrollY + margin
    return { position: 'absolute', left: x, top: y }
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

        <div className="dossier__footer">
          <span className="dossier__footer-text">SKYWATCH INTEL · CLASSIFIED</span>
        </div>
      </div>
    </>
  )
}
