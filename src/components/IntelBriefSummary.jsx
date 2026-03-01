export default function IntelBriefSummary({ brief, onClick, showDate = false }) {
  const firstImage = brief.media?.find(m => m.mediaType === 'picture')
  const sourceSites = brief.sources?.map(s => s.siteName).filter(Boolean)

  const formatDate = (dateStr) => {
    if (!dateStr) return ''
    return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  return (
    <article className="brief-card" onClick={onClick} role="button" tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.()}>
      <div className="brief-card__image">
        {firstImage
          ? <img src={firstImage.mediaUrl} alt={brief.title} loading="lazy" />
          : <div className="brief-card__image-placeholder" />
        }
        <span className="brief-card__category">{brief.category}</span>
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
    </article>
  )
}
