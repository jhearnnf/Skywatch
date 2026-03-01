const FOOTER_LINKS = [
  { id: 'contact', label: 'Contact' },
  { id: 'about',   label: 'About' },
  { id: 'report',  label: 'Report a Problem' },
]

export default function Footer({ navigate, currentPage }) {
  const handleReport = () => {
    // Pass the current page as context for the problem report
    navigate('report', { fromPage: currentPage })
  }

  return (
    <footer className="footer">
      <div className="footer-inner">
        {FOOTER_LINKS.map(({ id, label }, i) => (
          <>
            {i > 0 && <span key={`sep-${id}`} className="footer-sep" aria-hidden="true">·</span>}
            <button
              key={id}
              className="footer-link"
              onClick={() => id === 'report' ? handleReport() : navigate(id)}
            >
              {label}
            </button>
          </>
        ))}
      </div>
    </footer>
  )
}
