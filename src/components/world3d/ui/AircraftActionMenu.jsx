import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

// Modal that opens when the agent inspects an aircraft. We don't know the
// briefId at scene-build time (the .glb filenames are derived from the
// virtual manifest), so the first thing this modal does is fetch the
// aircraft-cutouts list, find a brief whose title slug matches the model
// slug, and offer the brief-reader + Where's-That-Aircraft entry points.

const API = import.meta.env.VITE_API_URL || ''

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9\-]+/g, ' ').trim()
}

export default function AircraftActionMenu({ slug, title, onClose }) {
  const navigate = useNavigate()
  const [briefId, setBriefId] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(`${API}/api/briefs/aircraft-cutouts`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled) return
        const cutouts = data?.data?.cutouts ?? []
        const target = slugify(slug)
        const match = cutouts.find(c => slugify(c.title) === target)
        setBriefId(match?.briefId ?? null)
      })
      .catch(() => { if (!cancelled) setBriefId(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [slug])

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-bg/80 backdrop-blur-sm pointer-events-auto">
      <div className="bg-surface-raised border border-brand-300 rounded-xl p-6 max-w-sm w-[90vw] shadow-2xl">
        <h2 className="text-lg font-bold text-brand-800 mb-1">{title}</h2>
        <p className="text-xs text-slate-600 mb-4">Inspect this airframe</p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={loading || !briefId}
            onClick={() => { if (briefId) { onClose(); navigate(`/brief/${briefId}`) } }}
            className="px-4 py-2 rounded-lg bg-brand-500 text-white font-semibold hover:bg-brand-600 disabled:bg-slate-300 disabled:text-slate-500 transition-colors"
          >
            {loading ? 'Loading…' : briefId ? 'Read brief' : 'No brief available'}
          </button>
          <button
            type="button"
            disabled={!briefId}
            onClick={() => { if (briefId) { onClose(); navigate(`/wheres-that-aircraft/${briefId}`) } }}
            className="px-4 py-2 rounded-lg border border-brand-300 text-brand-700 font-semibold hover:bg-brand-50 disabled:border-slate-300 disabled:text-slate-500 transition-colors"
          >
            Where's That Aircraft
          </button>
          <button
            type="button"
            onClick={onClose}
            className="mt-1 px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
