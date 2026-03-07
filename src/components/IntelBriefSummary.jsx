export default function IntelBriefSummary({ brief, onClick, showDate = false, isRead = false, isLocked = false, quizPassed = false }) {
  const images      = brief.media?.filter(m => m.mediaType === 'picture' && m.showOnSummary !== false) ?? []
  const firstImage  = images[0]
  const sourceSites = brief.sources?.map(s => s.siteName).filter(Boolean)

  const formatDate = (dateStr) => {
    if (!dateStr) return ''
    return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  const isBreakingNews = brief.category === 'News' && brief.dateAdded &&
    new Date(brief.dateAdded).toDateString() === new Date().toDateString()

  return (
    <article
      className={`brief-card${isLocked ? ' brief-card--locked' : ''}${isRead ? ' brief-card--read' : ''}`}
      onClick={isLocked ? undefined : onClick}
      role={isLocked ? undefined : 'button'}
      tabIndex={isLocked ? undefined : 0}
      onKeyDown={isLocked ? undefined : (e) => e.key === 'Enter' && onClick?.()}
    >
      {/* Corner bracket decorations */}
      <span className="brief-card__corner brief-card__corner--tl" aria-hidden="true" />
      <span className="brief-card__corner brief-card__corner--br" aria-hidden="true" />

      {/* Image */}
      <div className="brief-card__image">
        {images.length > 1
          ? (
            <div className="brief-card__image-strips">
              {images.slice(0, 4).map((img, i) => (
                <div key={i} className="brief-card__image-strip">
                  <img src={img.mediaUrl} alt="" loading="lazy" />
                </div>
              ))}
            </div>
          )
          : firstImage
            ? <img src={firstImage.mediaUrl} alt={brief.title} loading="lazy" />
            : <div className="brief-card__image-placeholder" />
        }
        <div className="brief-card__image-overlay" aria-hidden="true" />
        <span className="brief-card__category">[ {brief.category} ]</span>
        {isBreakingNews && (
          <div className="brief-card__breaking" aria-label="Breaking news">
            <span className="brief-card__breaking-dot" aria-hidden="true" />
            LIVE
          </div>
        )}
      </div>

      {/* Body */}
      <div className="brief-card__body">
        <div className="brief-card__meta">
          {sourceSites?.length > 0 && (
            <span className="brief-card__sources">{sourceSites.join(' · ')}</span>
          )}
          {showDate && brief.category === 'News' && brief.dateAdded && (
            <span className="brief-card__date">{formatDate(brief.dateAdded)}</span>
          )}
        </div>

        <h3 className="brief-card__title">{brief.title}</h3>
        {brief.subtitle && <p className="brief-card__subtitle">{brief.subtitle}</p>}

        <div className="brief-card__footer">
          {isRead
            ? <span className="brief-card__status brief-card__status--read">◉ ACCESSED</span>
            : <span className="brief-card__status brief-card__status--unread">◎ UNREAD</span>
          }
          <span className="brief-card__action">OPEN BRIEF →</span>
        </div>
      </div>

      {/* Quiz passed stamp */}
      {quizPassed && (
        <>
          <div className="brief-card__mission-grey" aria-hidden="true" />
          <div className="brief-card__mission-stamp" aria-label="Quiz passed">
            <span className="brief-card__mission-stamp-inner">✦ MISSION COMPLETE ✦</span>
          </div>
        </>
      )}

      {/* Locked overlay */}
      {isLocked && (
        <div className="brief-card__locked-overlay">
          <div className="brief-card__locked-inner">
            <svg className="brief-card__locked-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="3" y="11" width="18" height="11" rx="2" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <span className="brief-card__locked-text">UPGRADE TO UNLOCK</span>
          </div>
        </div>
      )}
    </article>
  )
}
