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
import { authFetch } from '../utils/authFetch'

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
  // { bestScore, completedCount } — drives the "personal best" line on the
  // score banner. Fetched separately from the scoring fallback below so it is
  // available on the happy path too, where scoring arrives via location.state.
  const [personalBest, setPersonalBest] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function loadBest() {
      try {
        const r = await authFetch(
          `${API}/api/case-files/${caseSlug}/chapters/${chapterSlug}/best`,
        )
        if (!r.ok) return
        const d = await r.json()
        const b = d?.data ?? d
        if (!cancelled && typeof b?.bestScore === 'number') setPersonalBest(b)
      } catch {
        // Best-effort flourish — the debrief is fine without it.
      }
    }
    loadBest()
    return () => { cancelled = true }
  }, [API, caseSlug, chapterSlug])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      try {
        // ── 1. Chapter (from state or re-fetched) ──────────────────────────
        let ch = chapter
        if (!ch) {
          const r = await authFetch(
            `${API}/api/case-files/${caseSlug}/chapters/${chapterSlug}`,
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
          const bestRes = await authFetch(
            `${API}/api/case-files/${caseSlug}/chapters/${chapterSlug}/best`,
          )

          if (bestRes.status === 404) {
            // No completed session for this chapter yet
            if (!cancelled) setNoSession(true)
            return
          }
          if (!bestRes.ok) throw new Error(`Failed to fetch best session (${bestRes.status})`)

          const bestData = await bestRes.json()
          const best = bestData?.data ?? bestData

          // No completed run for this chapter yet — /best answers 200 with
          // nulls rather than 404 when the user simply hasn't finished it.
          if (!best || (best.bestScore == null && !best.sessionId)) {
            if (!cancelled) setNoSession(true)
            return
          }

          // /best carries the scoring inline. Only fall back to fetching the
          // session when an older server hasn't sent it.
          let scored = best.scoring ?? null
          if (!scored && (best.sessionId ?? best._id)) {
            const sessRes = await authFetch(
              `${API}/api/case-files/sessions/${best.sessionId ?? best._id}`,
            )
            if (!sessRes.ok) throw new Error(`Failed to fetch session (${sessRes.status})`)
            const sessData = await sessRes.json()
            const sess = sessData?.data ?? sessData
            scored = sess.scoring ?? sess
          }
          if (cancelled) return

          setScoring(scored)
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
        <SEO title="Debrief" />
        <Spinner />
      </>
    )
  }

  // ── No completed session ─────────────────────────────────────────────────
  if (noSession) {
    return (
      <>
        <SEO title="Debrief" />
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
    chapterTitle: chapter?.title,
    sessionId:    null,
    priorResults: [],
  }

  return (
    <>
      <SEO title={`Debrief: ${chapter?.title ?? 'Chapter'}`} />
      <DebriefStage
        stage={debriefStage}
        sessionContext={sessionContext}
        onSubmit={handleClose}
        scoring={scoring}
        personalBest={personalBest}
        onReplay={() => navigate(`/case-files/${caseSlug}/${chapterSlug}`)}
      />
    </>
  )
}
