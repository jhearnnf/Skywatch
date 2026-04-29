import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import CaseFileCard from '../components/caseFiles/CaseFileCard'
import CaseFilesGate from '../components/caseFiles/CaseFilesGate'
import LockedCategoryModal from '../components/LockedCategoryModal'
import SEO from '../components/SEO'

// Inline mock — used as fallback when the API is unreachable.
const MOCK_CASES = [
  {
    slug:          'russia-ukraine',
    title:         'Russia / Ukraine',
    affairLabel:   'Eastern Europe · Active Conflict',
    summary:
      'An ongoing full-scale invasion reshaping European security. Analyse force dispositions, supply corridors, and the evolving air-defence picture.',
    coverImageUrl: null,
    status:        'published',
    tags:          ['Russia', 'Ukraine', 'NATO', 'Air Defence'],
    chapterCount:  1,
    chapterSlugs:  ['road-to-invasion'],
  },
  {
    slug:          'israel-iran',
    title:         'Israel / Iran',
    affairLabel:   'Middle East · Emerging Flashpoint',
    summary:
      'Rising tension across the Levant and Persian Gulf, with proxy networks, missile exchanges, and naval posturing shaping the operational environment.',
    coverImageUrl: null,
    status:        'locked',
    tags:          ['Israel', 'Iran', 'Hormuz', 'Proxy'],
    chapterCount:  0,
    chapterSlugs:  [],
  },
]

function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-slate-200/30 bg-surface-raised overflow-hidden animate-pulse">
      {/* Cover placeholder */}
      <div className="w-full bg-slate-200/10" style={{ paddingBottom: '56.25%' }} />
      <div className="px-4 pt-3 pb-4 space-y-2">
        <div className="h-4 w-3/4 bg-slate-200/20 rounded" />
        <div className="h-3 w-1/2 bg-slate-200/10 rounded" />
        <div className="h-3 w-full bg-slate-200/10 rounded" />
        <div className="h-3 w-5/6 bg-slate-200/10 rounded" />
      </div>
    </div>
  )
}

export default function CaseFiles() {
  const navigate           = useNavigate()
  const { API, user }      = useAuth()

  const [cases,      setCases]      = useState([])
  const [loading,    setLoading]    = useState(true)
  // gate is { reason } when access is blocked; null otherwise
  const [gate,       setGate]       = useState(null)
  const [upsellCase, setUpsellCase] = useState(null)

  // Guests have no tier — playing requires an account. Locked cards open
  // the upsell modal, which surfaces sign-in for guests.
  const effectiveTier = user
    ? (user.subscriptionTier === 'trial'
        ? (user.isTrialActive ? 'silver' : 'free')
        : (user.subscriptionTier ?? 'free'))
    : null

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const r = await fetch(`${API}/api/case-files`, { credentials: 'include' })
        if (r.status === 403) {
          const body = await r.json().catch(() => ({}))
          if (!cancelled) setGate({ reason: body?.reason ?? 'disabled' })
          return
        }
        if (!r.ok) {
          // Network/server error — fall back to mock so the page is never blank
          if (!cancelled) setCases(MOCK_CASES)
          return
        }
        const d = await r.json()
        if (cancelled) return
        const list = Array.isArray(d) ? d : []
        setCases(list.length ? list : MOCK_CASES)
      } catch {
        if (!cancelled) setCases(MOCK_CASES)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [API])

  function handleCardClick(caseFile, tierLocked) {
    if (caseFile.status === 'locked') return
    if (tierLocked) {
      setUpsellCase(caseFile)
      return
    }
    const firstChapter = caseFile.chapterSlugs?.[0]
    if (!firstChapter) return // no playable chapter yet (unseeded)
    navigate(`/case-files/${caseFile.slug}/${firstChapter}`)
  }

  if (gate) {
    return <CaseFilesGate reason={gate.reason} />
  }

  return (
    <>
      <SEO title="Case Files — Skywatch" />

      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold text-slate-900 mb-1">Case Files</h1>
          <p className="text-sm text-slate-500">
            Investigate the world&#39;s biggest current affairs as an intelligence analyst.
          </p>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-[600px]:grid-cols-1">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : cases.length === 0 ? (
          <p className="text-slate-500 text-sm">No case files available yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-[600px]:grid-cols-1">
            {cases.map(cf => {
              const tiers      = Array.isArray(cf.tiers) ? cf.tiers : []
              // Guests + any non-admin user whose tier isn't in the allowlist see a padlock.
              const tierLocked = !user?.isAdmin && (!effectiveTier || !tiers.includes(effectiveTier))
              const minTier    = tiers.includes('silver') ? 'silver' : 'gold'
              return (
                <CaseFileCard
                  key={cf.slug}
                  caseFile={cf}
                  tierLocked={tierLocked}
                  minTier={minTier}
                  onClick={(c) => handleCardClick(c, tierLocked)}
                />
              )
            })}
          </div>
        )}
      </div>

      {upsellCase && (
        <LockedCategoryModal
          category="Case Files"
          tier={(Array.isArray(upsellCase.tiers) && upsellCase.tiers.includes('silver')) ? 'silver' : 'gold'}
          user={user}
          onClose={() => setUpsellCase(null)}
        />
      )}
    </>
  )
}
