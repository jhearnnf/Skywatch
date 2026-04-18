import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import SEO from '../components/SEO'

const RANGE_PRESETS = [
  { id: 'today',    label: 'Today'    },
  { id: '7d',       label: 'Last 7d'  },
  { id: '30d',      label: 'Last 30d' },
  { id: 'all',      label: 'All time' },
]

const fmtUSD = (n) => {
  const v = typeof n === 'number' ? n : 0
  if (v >= 100) return `$${v.toFixed(2)}`
  if (v >= 1)   return `$${v.toFixed(3)}`
  return `$${v.toFixed(5)}`
}

const fmtNum = (n) => (n ?? 0).toLocaleString()

const fmtDateTime = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) +
    ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function rangeToIsoFrom(range) {
  const now = new Date()
  if (range === 'today') {
    const s = new Date(now); s.setHours(0, 0, 0, 0)
    return s.toISOString()
  }
  if (range === '7d')  return new Date(now.getTime() - 7  * 24 * 3600 * 1000).toISOString()
  if (range === '30d') return new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString()
  return null
}

function deriveRangeFromParams(params) {
  const from = params.get('from')
  if (!from) return 'all'
  const fromDate = new Date(from)
  const now = new Date()
  const today = new Date(now); today.setHours(0, 0, 0, 0)
  if (Math.abs(fromDate - today) < 60_000) return 'today'
  const diffDays = Math.round((now - fromDate) / (24 * 3600 * 1000))
  if (diffDays === 7)  return '7d'
  if (diffDays === 30) return '30d'
  return 'custom'
}

export default function OpenRouterUsage() {
  const { user, loading: authLoading, API, apiFetch } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const keyFilter     = searchParams.get('key') || 'all'
  const featureFilter = useMemo(() => {
    const v = searchParams.get('feature')
    return v ? v.split(',').filter(Boolean) : []
  }, [searchParams])
  const rangeFilter   = deriveRangeFromParams(searchParams)

  const [rows,         setRows]         = useState([])
  const [totalCost,    setTotalCost]    = useState(0)
  const [totalCalls,   setTotalCalls]   = useState(0)
  const [totalTokens,  setTotalTokens]  = useState(0)
  const [features,     setFeatures]     = useState([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(null)
  const [nextCursor,   setNextCursor]   = useState(null)
  const [loadingMore,  setLoadingMore]  = useState(false)

  useEffect(() => {
    if (authLoading) return
    if (!user || !user.isAdmin) {
      navigate('/home', { replace: true })
    }
  }, [user, authLoading, navigate])

  const buildQuery = useCallback((cursor) => {
    const q = new URLSearchParams()
    if (keyFilter && keyFilter !== 'all') q.set('key', keyFilter)
    if (featureFilter.length)             q.set('feature', featureFilter.join(','))
    const from = searchParams.get('from')
    const to   = searchParams.get('to')
    if (from) q.set('from', from)
    if (to)   q.set('to',   to)
    q.set('limit', '100')
    if (cursor) q.set('cursor', cursor)
    return q.toString()
  }, [keyFilter, featureFilter, searchParams])

  const fetchPage = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res  = await apiFetch(`${API}/api/admin/openrouter/logs?${buildQuery(null)}`, { credentials: 'include' })
      const json = await res.json()
      if (!res.ok || json.status !== 'success') throw new Error(json.message || 'Failed to load logs')
      setRows(json.data.rows)
      setTotalCost(json.data.totalCost)
      setTotalCalls(json.data.totalCalls)
      setTotalTokens(json.data.totalTokens)
      setFeatures(json.data.features || [])
      setNextCursor(json.data.nextCursor)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [API, apiFetch, buildQuery])

  useEffect(() => { fetchPage() }, [fetchPage])

  const loadMore = async () => {
    if (!nextCursor) return
    setLoadingMore(true)
    try {
      const res  = await apiFetch(`${API}/api/admin/openrouter/logs?${buildQuery(nextCursor)}`, { credentials: 'include' })
      const json = await res.json()
      if (res.ok && json.status === 'success') {
        setRows(prev => [...prev, ...json.data.rows])
        setNextCursor(json.data.nextCursor)
      }
    } finally {
      setLoadingMore(false)
    }
  }

  const updateParams = (updates) => {
    const next = new URLSearchParams(searchParams)
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) next.delete(k)
      else next.set(k, Array.isArray(v) ? v.join(',') : v)
    }
    setSearchParams(next, { replace: true })
  }

  const setKey = (k) => updateParams({ key: k === 'all' ? null : k })
  const setRange = (r) => {
    const from = rangeToIsoFrom(r)
    updateParams({ from })
  }
  const toggleFeature = (f) => {
    const next = featureFilter.includes(f)
      ? featureFilter.filter(x => x !== f)
      : [...featureFilter, f]
    updateParams({ feature: next })
  }
  const clearFeatures = () => updateParams({ feature: null })

  return (
    <div className="max-w-5xl mx-auto px-4 pb-10">
      <SEO title="OpenRouter Usage" description="Admin view of OpenRouter API spend and call history." noIndex={true} />

      <div className="mb-5 pt-4">
        <button onClick={() => navigate('/admin')} className="text-sm text-slate-500 hover:text-slate-700 transition-colors mb-3 flex items-center gap-1">
          ← Admin
        </button>
        <h1 className="text-2xl font-extrabold text-slate-900">OpenRouter Usage</h1>
        <p className="text-sm text-slate-500 mt-0.5">Every AI call, tagged by feature, with $ cost.</p>
      </div>

      {/* Sticky total bar — updates with every filter change */}
      <div className="sticky top-0 z-10 -mx-4 px-4 py-3 mb-4 bg-surface border-b border-slate-200 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <div>
          <span className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Filtered Spend</span>
          <div className="text-3xl font-extrabold text-brand-700 leading-none">{fmtUSD(totalCost)}</div>
        </div>
        <div className="text-xs text-slate-500">
          <span className="font-semibold text-slate-700">{fmtNum(totalCalls)}</span> calls · <span className="font-semibold text-slate-700">{fmtNum(totalTokens)}</span> tokens
        </div>
      </div>

      {/* Filters */}
      <div className="bg-surface border border-slate-200 rounded-2xl p-4 mb-4 space-y-3">
        {/* Key */}
        <div>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">API Key</p>
          <div className="flex gap-2 flex-wrap">
            {['all', 'main', 'aptitude'].map(k => (
              <button
                key={k}
                onClick={() => setKey(k)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${keyFilter === k ? 'bg-brand-600 border-brand-600 text-white' : 'bg-surface border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                {k === 'all' ? 'All keys' : k === 'main' ? 'SkyWatch.main' : 'SkyWatch.aptitude'}
              </button>
            ))}
          </div>
        </div>

        {/* Date range */}
        <div>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Date Range</p>
          <div className="flex gap-2 flex-wrap">
            {RANGE_PRESETS.map(r => (
              <button
                key={r.id}
                onClick={() => setRange(r.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${rangeFilter === r.id ? 'bg-brand-600 border-brand-600 text-white' : 'bg-surface border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                {r.label}
              </button>
            ))}
            {rangeFilter === 'custom' && <span className="text-xs text-slate-400 self-center">(custom)</span>}
          </div>
        </div>

        {/* Features */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Feature</p>
            {featureFilter.length > 0 && (
              <button onClick={clearFeatures} className="text-xs text-slate-500 hover:text-slate-700">Clear ({featureFilter.length})</button>
            )}
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {features.length === 0 && <span className="text-xs text-slate-400">No features logged yet.</span>}
            {features.map(f => (
              <button
                key={f}
                onClick={() => toggleFeature(f)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${featureFilter.includes(f) ? 'bg-brand-600 border-brand-600 text-white' : 'bg-surface border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Log table */}
      {error && <p className="text-sm text-red-500 py-6 text-center">{error}</p>}
      {loading ? (
        <div className="py-8 text-center text-slate-400 text-sm animate-pulse">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="py-12 text-center text-slate-400 text-sm">No calls match the current filters.</div>
      ) : (
        <div className="bg-surface border border-slate-200 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">When</th>
                <th className="text-left px-3 py-2 font-semibold">Key</th>
                <th className="text-left px-3 py-2 font-semibold">Feature</th>
                <th className="text-left px-3 py-2 font-semibold hidden sm:table-cell">Model</th>
                <th className="text-right px-3 py-2 font-semibold">Tokens</th>
                <th className="text-right px-3 py-2 font-semibold">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r._id} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{fmtDateTime(r.createdAt)}</td>
                  <td className="px-3 py-2"><span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${r.key === 'aptitude' ? 'bg-amber-50 text-amber-700' : 'bg-brand-50 text-brand-700'}`}>{r.key}</span></td>
                  <td className="px-3 py-2 text-slate-700">{r.feature}</td>
                  <td className="px-3 py-2 text-slate-500 hidden sm:table-cell truncate max-w-[180px]">{r.model}</td>
                  <td className="px-3 py-2 text-right text-slate-600 tabular-nums">{fmtNum(r.totalTokens)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-slate-800 tabular-nums">{fmtUSD(r.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {nextCursor && (
            <div className="p-3 border-t border-slate-100 text-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="text-xs font-semibold text-brand-600 hover:text-brand-800 disabled:opacity-40"
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
