import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

// Shared picker modal. Two modes:
//   'aptitudeSync' — fetches /api/briefs (user's accessible briefs) and
//                    navigates to /aptitude-sync/{briefId} on select.
//   'caseFiles'    — fetches /api/case-files (published cases) and navigates
//                    to the first chapter on select.

const API = import.meta.env.VITE_API_URL || ''

const MODE_CONFIG = {
  aptitudeSync: {
    title: 'Select a dossier',
    subtitle: 'Sit down and submit yourself to an AI debrief.',
    endpoint: '/api/briefs?limit=50',
    parse: (data) => (Array.isArray(data?.data?.briefs) ? data.data.briefs : Array.isArray(data) ? data : []).map(b => ({
      id: b._id ?? b.id,
      title: b.title,
      sub: b.category,
    })),
    routeFor: (item) => `/aptitude-sync/${item.id}`,
  },
  caseFiles: {
    title: 'Pin a case to the board',
    subtitle: 'Pick a case file and open the first chapter.',
    endpoint: '/api/case-files',
    parse: (data) => (Array.isArray(data) ? data : []).filter(c => c.status === 'published').map(c => ({
      id: c.slug,
      title: c.title,
      sub: c.affairLabel,
      chapterSlug: Array.isArray(c.chapterSlugs) ? c.chapterSlugs[0] : null,
    })),
    routeFor: (item) => item.chapterSlug ? `/case-files/${item.id}/${item.chapterSlug}` : null,
  },
}

export default function BriefPickerModal({ mode, onClose }) {
  const cfg = MODE_CONFIG[mode]
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!cfg) return
    let cancelled = false
    fetch(`${API}${cfg.endpoint}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => { if (!cancelled) setItems(cfg.parse(d)) })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [mode])

  if (!cfg) return null

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-bg/80 backdrop-blur-sm pointer-events-auto">
      <div className="bg-surface-raised border border-brand-300 rounded-xl p-6 max-w-md w-[92vw] max-h-[80vh] flex flex-col shadow-2xl">
        <h2 className="text-lg font-bold text-brand-800 mb-1">{cfg.title}</h2>
        <p className="text-xs text-slate-600 mb-3">{cfg.subtitle}</p>

        <div className="flex-1 overflow-y-auto min-h-[8rem]">
          {loading && <p className="text-sm text-slate-500 py-4">Loading…</p>}
          {error && <p className="text-sm text-amber-700 py-4">Couldn't load: {error}</p>}
          {!loading && !error && items.length === 0 && (
            <p className="text-sm text-slate-500 py-4">Nothing available right now.</p>
          )}
          <ul className="flex flex-col gap-1">
            {items.map(item => {
              const route = cfg.routeFor(item)
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    disabled={!route}
                    onClick={() => { if (route) { onClose(); navigate(route) } }}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-brand-50 disabled:opacity-50 disabled:cursor-not-allowed border border-transparent hover:border-brand-200 transition-colors"
                  >
                    <div className="text-sm font-semibold text-brand-800 truncate">{item.title}</div>
                    {item.sub && <div className="text-xs text-slate-500 truncate">{item.sub}</div>}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-3 px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
