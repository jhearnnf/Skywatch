/**
 * CaseFileDebrief — standalone debrief page.
 * Route: /case-files/:caseSlug/:chapterSlug/debrief
 *
 * CONTRACT-AMBIGUITY: Chapter data strategy.
 * We prefer location.state (passed by CaseFilePlay's navigate call) because:
 *   a) The player just finished the chapter — the data is always fresh.
 *   b) It avoids an extra GET /api/case-files/:caseSlug/chapters/:chapterSlug
 *      roundtrip on the happy path.
 * If location.state is absent (e.g. the user bookmarked the URL), we fall back
 * to re-fetching the chapter so the page still works standalone.
 *
 * Scoring strategy:
 * We also prefer location.state.scoring (set by the hook after POST /complete).
 * Fallback: fetch the best completed session via
 *   GET /api/case-files/:caseSlug/chapters/:chapterSlug/best
 * then
 *   GET /api/case-files/sessions/:sessionId
 * to retrieve the scoring object.
 */

import { useState, useEffect } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import DebriefStage from '../components/caseFiles/stages/DebriefStage'
import CaseFilesGate from '../components/caseFiles/CaseFilesGate'
import SEO from '../components/SEO'

const API_BASE = import.meta.env.VITE_API_URL || ''

// ── Tiny spinner (duplicated locally to keep page self-contained) ─────────────
function Spinner() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <div className="w-8 h-8 border-2 border-slate-300/30 border-t-brand-600 rounded-full animate-spin" />
      <p className="text-sm text-slate-500 tracking-wide">Loading debrief…</p>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CaseFileDebrief() {
  const { caseSlug, chapterSlug } = useParams()
  const navigate  = useNavigate()
  const location  = useLocation()
  const { API }   = useAuth()

  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [gate,     setGate]     = useState(null)
  const [chapter,  setChapter]  = useState(location.state?.chapter ?? null)
  const [scoring,  setScoring]  = useState(location.state?.scoring ?? null)
  const [noSession, setNoSession] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      try {
        // ── 1. Chapter (from state or re-fetched) ──────────────────────────
        let ch = chapter
        if (!ch) {
          const r = await fetch(
            `${API}/api/case-files/${caseSlug}/chapters/${chapterSlug}`,
            { credentials: 'include' },
          )
          if (r.status === 403) {
            const body = await r.json().catch(() => ({}))
            if (!cancelled) setGate({ reason: body?.reason ?? 'disabled' })
            return
          }
          if (!r.ok) throw new Error(`Failed to load chapter (${r.status})`)
          const d = await r.json()
          ch = d?.data ?? d
          if (cancelled) return
          setChapter(ch)
        }

        // ── 2. Scoring (from state or re-fetched via best session) ─────────
        if (!scoring) {
          const bestRes = await fetch(
            `${API}/api/case-files/${caseSlug}/chapters/${chapterSlug}/best`,
            { credentials: 'include' },
          )

          if (bestRes.status === 404) {
            // No completed session for this chapter yet
            if (!cancelled) setNoSession(true)
            return
          }
          if (!bestRes.ok) throw new Error(`Failed to fetch best session (${bestRes.status})`)

          const bestData = await bestRes.json()
          const best = bestData?.data ?? bestData

          // Fetch the full session for its scoring object
          const sessRes = await fetch(
            `${API}/api/case-files/sessions/${best.sessionId ?? best._id}`,
            { credentials: 'include' },
          )
          if (!sessRes.ok) throw new Error(`Failed to fetch session (${sessRes.status})`)
          const sessData = await sessRes.json()
          const sess = sessData?.data ?? sessData
          if (cancelled) return

          setScoring(sess.scoring ?? sess)
        }
      } catch (err) {
        if (!cancelled) setError(err.message ?? 'Failed to load debrief')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
    // Only run once (caseSlug/chapterSlug won't change for a given page mount)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleClose() {
    navigate('/case-files')
  }

  // ── Gated state (disabled / tier) ────────────────────────────────────────
  if (gate) {
    return <CaseFilesGate reason={gate.reason} />
  }

  // ── Error state ──────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-4">
        <p className="text-sm text-danger text-center">{error}</p>
        <Link to="/case-files" className="text-xs text-brand-600 hover:underline">
          ← Back to Case Files
        </Link>
      </div>
    )
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <>
        <SEO title="Debrief — Skywatch" />
        <Spinner />
      </>
    )
  }

  // ── No completed session ─────────────────────────────────────────────────
  if (noSession) {
    return (
      <>
        <SEO title="Debrief — Skywatch" />
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-4">
          <p className="text-sm text-slate-500 text-center">
            Complete the chapter first to view your debrief.
          </p>
          <Link
            to={`/case-files/${caseSlug}/${chapterSlug}`}
            className="text-xs text-brand-600 hover:underline"
          >
            Start chapter →
          </Link>
        </div>
      </>
    )
  }

  // ── Debrief stage ────────────────────────────────────────────────────────
  // Find the debrief stage in the chapter stages array
  const debriefStage = chapter?.stages?.find(s => s.type === 'debrief')
    ?? { id: 'debrief', type: 'debrief', payload: {} }

  const sessionContext = {
    caseSlug,
    chapterSlug,
    sessionId:    null,
    priorResults: [],
  }

  return (
    <>
      <SEO title={`Debrief: ${chapter?.title ?? 'Chapter'} — Skywatch`} />
      <DebriefStage
        stage={debriefStage}
        sessionContext={sessionContext}
        onSubmit={handleClose}
        scoring={scoring}
      />
    </>
  )
}
