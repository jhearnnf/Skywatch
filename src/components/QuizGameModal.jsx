import { useEffect } from 'react'

export default function QuizGameModal({ briefId, onClose }) {
  // Close on Escape key
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // Lock body scroll while open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div className="modal-overlay" onClick={handleOverlayClick} role="dialog" aria-modal="true" aria-label="Knowledge Check">
      <div className="modal">
        <div className="modal__header">
          <div className="modal__header-left">
            <span className="modal__eyebrow">Knowledge Check</span>
            <h2 className="modal__title">Quiz Game</h2>
          </div>
          <button className="modal__close" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M2 2l14 14M16 2L2 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="modal__body modal__body--centered">
          <div className="game-placeholder">
            <span className="game-placeholder__icon">◎</span>
            <p className="game-placeholder__text">Game coming soon</p>
            <p className="game-placeholder__sub">Brief ID: <code>{briefId}</code></p>
          </div>
        </div>
      </div>
    </div>
  )
}
