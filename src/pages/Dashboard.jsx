import IntelBriefSummary from '../components/IntelBriefSummary'
import { MOCK_BRIEFS } from '../data/mockData'

const newsBriefs = MOCK_BRIEFS.filter(b => b.category === 'News')

export default function Dashboard({ navigate }) {
  return (
    <main className="page dashboard-page">

      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="mission-control">
        <span className="mc-eyebrow">Mission Control</span>
        <h1 className="mc-title">Welcome to Skywatch</h1>
        <p className="mc-subtitle">
          Stay informed on the latest RAF intelligence. Test your knowledge
          retention and climb the ranks of the Intelligence Corps.
        </p>
      </section>

      {/* ── Today's News ─────────────────────────────────── */}
      <section className="dashboard-news">
        <div className="section-inner">
          <div className="section-header">
            <h2 className="section-title">Today&apos;s Briefs</h2>
            <button className="section-link" onClick={() => navigate('intel-feed')}>
              View all intel →
            </button>
          </div>

          {newsBriefs.length > 0 ? (
            <div className="brief-grid">
              {newsBriefs.map(brief => (
                <IntelBriefSummary
                  key={brief._id}
                  brief={brief}
                  showDate
                  onClick={() => navigate('intelligence-brief', { briefId: brief._id })}
                />
              ))}
            </div>
          ) : (
            <p className="empty-state">No briefs available today.</p>
          )}
        </div>
      </section>

    </main>
  )
}
