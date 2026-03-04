export default function IntelBriefSummary({ brief, onClick, showDate = false, isRead = false, isLocked = false }) {
  const firstImage = brief.media?.find(m => m.mediaType === 'picture')
  const sourceSites = brief.sources?.map(s => s.siteName).filter(Boolean)

  const formatDate = (dateStr) => {
    if (!dateStr) return ''
    return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  const isBreakingNews = brief.category === 'News' && brief.dateAdded &&
    new Date(brief.dateAdded).toDateString() === new Date().toDateString()

  return (
    <article
      className={`brief-card${isLocked ? ' brief-card--locked' : ''}`}
      onClick={isLocked ? undefined : onClick}
      role={isLocked ? undefined : 'button'}
      tabIndex={isLocked ? undefined : 0}
      onKeyDown={isLocked ? undefined : (e) => e.key === 'Enter' && onClick?.()}
    >
      <div className="brief-card__image">
        {firstImage
          ? <img src={firstImage.mediaUrl} alt={brief.title} loading="lazy" />
          : <div className="brief-card__image-placeholder" />
        }
        <span className="brief-card__category">{brief.category}</span>
        {isBreakingNews && (
          <div className="brief-card__breaking">
            <span className="brief-card__breaking-text">NEW</span>
          </div>
        )}
        {isRead && (
          <div className="brief-card__read-badge">✓ READ</div>
        )}
      </div>

      <div className="brief-card__body">
        {sourceSites?.length > 0 && (
          <p className="brief-card__sources">{sourceSites.join(' · ')}</p>
        )}
        <h3 className="brief-card__title">{brief.title}</h3>
        {brief.subtitle && <p className="brief-card__subtitle">{brief.subtitle}</p>}
        {showDate && brief.category === 'News' && brief.dateAdded && (
          <p className="brief-card__date">{formatDate(brief.dateAdded)}</p>
        )}
      </div>

      {isLocked && (
        <div className="brief-card__locked-overlay">
          <div className="brief-card__locked-inner">
            <span className="brief-card__locked-icon">🔒</span>
            <span className="brief-card__locked-text">UPGRADE SUBSCRIPTION TO UNLOCK THIS CATEGORY</span>
          </div>
        </div>
      )}
    </article>
  )
}
