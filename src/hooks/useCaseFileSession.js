/**
 * useCaseFileSession — orchestration hook for the Case Files chapter-play flow.
 *
 * Responsibilities:
 *   1. On mount: GET chapter metadata, then POST sessions to create a session.
 *   2. submitStage(payload) — PATCH the current stage; if last stage, auto-calls
 *      POST complete and stores scoring.
 *   3. sendQuestion(actorId, question) — POST interrogate; returns server response.
 *   4. Accumulates priorResults locally (no extra roundtrip to the server).
 *
 * CONTRACT-AMBIGUITY: priorResults is built from the local accumulator inside
 * this hook as each stage is submitted. It is NOT re-fetched from the server —
 * this avoids an extra roundtrip and keeps the client state authoritative for
 * stage-to-stage hand-offs.
 */

import { useState, useEffect, useCallback, useRef } from 'react'

const API_BASE = import.meta.env.VITE_API_URL || ''

export default function useCaseFileSession({ caseSlug, chapterSlug }) {
  const [loading,           setLoading]           = useState(true)
  const [error,             setError]             = useState(null)
  // gate is { reason, usedToday?, limitToday? } when access is blocked, else null
  const [gate,              setGate]              = useState(null)
  const [chapter,           setChapter]           = useState(null)
  const [sessionId,         setSessionId]         = useState(null)
  const [currentStageIndex, setCurrentStageIndex] = useState(0)
  const [totalStages,       setTotalStages]       = useState(0)
  const [priorResults,      setPriorResults]      = useState([])
  const [scoring,           setScoring]           = useState(null)
  const [isCompleted,       setIsCompleted]       = useState(false)

  // Keep a ref to sessionId so submitStage/sendQuestion closures always see
  // the latest value without needing it in their dependency arrays.
  const sessionIdRef         = useRef(null)
  const currentStageIndexRef = useRef(0)
  const chapterRef           = useRef(null)

  useEffect(() => { sessionIdRef.current         = sessionId },         [sessionId])
  useEffect(() => { currentStageIndexRef.current = currentStageIndex }, [currentStageIndex])
  useEffect(() => { chapterRef.current           = chapter },           [chapter])

  // ── Initial fetch: GET chapter, then POST session ─────────────────────────
  useEffect(() => {
    if (!caseSlug || !chapterSlug) return

    let cancelled = false

    async function init() {
      setLoading(true)
      setError(null)
      setGate(null)

      try {
        // 1. Fetch chapter metadata
        const chapterRes = await fetch(
          `${API_BASE}/api/case-files/${caseSlug}/chapters/${chapterSlug}`,
          { credentials: 'include' },
        )
        if (chapterRes.status === 403) {
          const body = await chapterRes.json().catch(() => ({}))
          if (!cancelled) setGate({ reason: body?.reason ?? 'disabled', minTier: body?.minTier })
          return
        }
        if (!chapterRes.ok) throw new Error(`Failed to load chapter (${chapterRes.status})`)
        const chapterData = await chapterRes.json()
        const ch = chapterData?.data ?? chapterData  // tolerate both { data: {...} } and raw object
        if (cancelled) return

        setChapter(ch)
        setTotalStages(ch.stages?.length ?? 0)

        // 2. Create a session
        const sessionRes = await fetch(
          `${API_BASE}/api/case-files/${caseSlug}/chapters/${chapterSlug}/sessions`,
          {
            method:      'POST',
            credentials: 'include',
            headers:     { 'Content-Type': 'application/json' },
          },
        )
        if (sessionRes.status === 403 || sessionRes.status === 429) {
          const body = await sessionRes.json().catch(() => ({}))
          if (!cancelled) setGate({
            reason:     body?.reason ?? (sessionRes.status === 429 ? 'limit' : 'disabled'),
            usedToday:  body?.usedToday,
            limitToday: body?.limitToday,
            minTier:    body?.minTier,
          })
          return
        }
        if (!sessionRes.ok) throw new Error(`Failed to start session (${sessionRes.status})`)
        const sessionData = await sessionRes.json()
        const sd = sessionData?.data ?? sessionData
        if (cancelled) return

        setSessionId(sd.sessionId)
        setCurrentStageIndex(sd.currentStageIndex ?? 0)
      } catch (err) {
        if (!cancelled) setError(err.message ?? 'Failed to load case file')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    init()
    return () => { cancelled = true }
  }, [caseSlug, chapterSlug])

  // ── submitStage ───────────────────────────────────────────────────────────
  const submitStage = useCallback(async (payload) => {
    const sid   = sessionIdRef.current
    const idx   = currentStageIndexRef.current
    const ch    = chapterRef.current
    const stage = ch?.stages?.[idx]

    if (!sid || !stage) throw new Error('No active session or stage')

    // PATCH the current stage
    const patchRes = await fetch(
      `${API_BASE}/api/case-files/sessions/${sid}/stages/${idx}`,
      {
        method:      'PATCH',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ stageType: stage.type, payload }),
      },
    )
    if (!patchRes.ok) {
      const body = await patchRes.json().catch(() => ({}))
      throw new Error(body?.message ?? `Stage submit failed (${patchRes.status})`)
    }
    const patchData = await patchRes.json()
    const pd = patchData?.data ?? patchData

    // Accumulate result locally
    setPriorResults(prev => [
      ...prev,
      { stageIndex: idx, stageType: stage.type, payload },
    ])

    if (pd.isLastStage) {
      // Auto-complete the session
      const completeRes = await fetch(
        `${API_BASE}/api/case-files/sessions/${sid}/complete`,
        {
          method:      'POST',
          credentials: 'include',
          headers:     { 'Content-Type': 'application/json' },
        },
      )
      if (!completeRes.ok) {
        const body = await completeRes.json().catch(() => ({}))
        throw new Error(body?.message ?? `Complete failed (${completeRes.status})`)
      }
      const completeData = await completeRes.json()
      const scoring = completeData?.data ?? completeData

      setScoring(scoring)
      setIsCompleted(true)
      // Leave currentStageIndex where it is; the page will navigate away.
    } else {
      setCurrentStageIndex(pd.currentStageIndex)
    }
  }, [])

  // ── sendQuestion ──────────────────────────────────────────────────────────
  const sendQuestion = useCallback(async (actorId, question) => {
    const sid = sessionIdRef.current
    const idx = currentStageIndexRef.current

    if (!sid) throw new Error('No active session')

    const res = await fetch(
      `${API_BASE}/api/case-files/sessions/${sid}/interrogate`,
      {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ stageIndex: idx, actorId, question }),
      },
    )
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.message ?? `Interrogate failed (${res.status})`)
    }
    const data = await res.json()
    return data?.data ?? data
  }, [])

  return {
    loading,
    error,
    gate,
    chapter,
    sessionId,
    currentStageIndex,
    totalStages,
    priorResults,
    scoring,
    isCompleted,
    submitStage,
    sendQuestion,
  }
}
