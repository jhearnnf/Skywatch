import { renderHook, act, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import useCaseFileSession from '../useCaseFileSession'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CHAPTER = {
  caseSlug:      'russia-ukraine',
  chapterSlug:   'ch1',
  title:         'Chapter 1: The Invasion',
  dateRangeLabel: 'Feb–Apr 2022',
  stages: [
    { id: 'stage-0', type: 'cold_open',   payload: {} },
    { id: 'stage-1', type: 'evidence_wall', payload: {} },
    { id: 'stage-2', type: 'debrief',     payload: {} },
  ],
}

const SESSION_RESPONSE = {
  sessionId:         'sess-abc-123',
  currentStageIndex: 0,
}

const PATCH_RESPONSE_NOT_LAST = {
  currentStageIndex: 1,
  totalStages:       3,
  isLastStage:       false,
}

const PATCH_RESPONSE_LAST = {
  currentStageIndex: 2,
  totalStages:       3,
  isLastStage:       true,
}

const COMPLETE_RESPONSE = {
  totalScore:  850,
  breakdown:   [{ stageIndex: 0, score: 100 }],
  completedAt: '2026-04-27T10:00:00Z',
}

const INTERROGATE_RESPONSE = {
  answer:             'No comment.',
  questionsRemaining: 2,
}

// ── Mock fetch ────────────────────────────────────────────────────────────────

function makeOkResponse(body) {
  return {
    ok:   true,
    json: async () => body,
  }
}

function makeErrorResponse(status, message) {
  return {
    ok:     false,
    status,
    json:   async () => ({ message }),
  }
}

const SLUG_ARGS = { caseSlug: 'russia-ukraine', chapterSlug: 'ch1' }

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useCaseFileSession', () => {
  it('initial fetch: loads chapter and creates session (happy path)', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeOkResponse(CHAPTER))          // GET chapter
      .mockResolvedValueOnce(makeOkResponse(SESSION_RESPONSE)) // POST sessions

    const { result } = renderHook(() => useCaseFileSession(SLUG_ARGS))

    // Initially loading
    expect(result.current.loading).toBe(true)

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.chapter).toEqual(CHAPTER)
    expect(result.current.sessionId).toBe('sess-abc-123')
    expect(result.current.currentStageIndex).toBe(0)
    expect(result.current.totalStages).toBe(3)
    expect(result.current.error).toBeNull()
    expect(result.current.isCompleted).toBe(false)
    expect(result.current.scoring).toBeNull()
    expect(result.current.priorResults).toEqual([])
  })

  it('submitStage advances currentStageIndex when not last stage', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeOkResponse(CHAPTER))
      .mockResolvedValueOnce(makeOkResponse(SESSION_RESPONSE))
      .mockResolvedValueOnce(makeOkResponse(PATCH_RESPONSE_NOT_LAST)) // PATCH stage 0

    const { result } = renderHook(() => useCaseFileSession(SLUG_ARGS))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.submitStage({ completed: true })
    })

    expect(result.current.currentStageIndex).toBe(1)
    expect(result.current.priorResults).toHaveLength(1)
    expect(result.current.priorResults[0].stageIndex).toBe(0)
    expect(result.current.priorResults[0].stageType).toBe('cold_open')
    expect(result.current.isCompleted).toBe(false)
    expect(result.current.scoring).toBeNull()
  })

  it('submitStage on last stage triggers complete and sets scoring', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeOkResponse(CHAPTER))
      .mockResolvedValueOnce(makeOkResponse(SESSION_RESPONSE))
      .mockResolvedValueOnce(makeOkResponse(PATCH_RESPONSE_NOT_LAST)) // stage 0 → 1
      .mockResolvedValueOnce(makeOkResponse({                          // stage 1 — last
        currentStageIndex: 2,
        totalStages:       3,
        isLastStage:       true,
      }))
      .mockResolvedValueOnce(makeOkResponse(COMPLETE_RESPONSE))         // POST complete

    const { result } = renderHook(() => useCaseFileSession(SLUG_ARGS))
    await waitFor(() => expect(result.current.loading).toBe(false))

    // Submit stage 0
    await act(async () => {
      await result.current.submitStage({ completed: true })
    })
    expect(result.current.currentStageIndex).toBe(1)

    // Submit stage 1 (last)
    await act(async () => {
      await result.current.submitStage({ choice: 'A' })
    })

    expect(result.current.isCompleted).toBe(true)
    expect(result.current.scoring).toEqual(COMPLETE_RESPONSE)
    expect(result.current.priorResults).toHaveLength(2)
  })

  it('sendQuestion calls /interrogate and returns the server body', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeOkResponse(CHAPTER))
      .mockResolvedValueOnce(makeOkResponse(SESSION_RESPONSE))
      .mockResolvedValueOnce(makeOkResponse(INTERROGATE_RESPONSE)) // POST interrogate

    const { result } = renderHook(() => useCaseFileSession(SLUG_ARGS))
    await waitFor(() => expect(result.current.loading).toBe(false))

    let response
    await act(async () => {
      response = await result.current.sendQuestion('actor-1', 'Who are you?')
    })

    expect(response).toEqual(INTERROGATE_RESPONSE)
    // Verify the right endpoint was called
    const interrogateCall = global.fetch.mock.calls[2]
    expect(interrogateCall[0]).toContain('/interrogate')
    const bodyParsed = JSON.parse(interrogateCall[1].body)
    expect(bodyParsed.actorId).toBe('actor-1')
    expect(bodyParsed.question).toBe('Who are you?')
  })

  it('network error on initial chapter fetch sets error and stops loading', async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network failure'))

    const { result } = renderHook(() => useCaseFileSession(SLUG_ARGS))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toMatch(/Network failure/)
    expect(result.current.chapter).toBeNull()
    expect(result.current.sessionId).toBeNull()
  })

  it('non-ok chapter response sets error', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(makeErrorResponse(500, 'Internal error'))

    const { result } = renderHook(() => useCaseFileSession(SLUG_ARGS))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBeTruthy()
    expect(result.current.error).toMatch(/500/)
  })

  it('403 chapter response sets gate.reason instead of error', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false, status: 403, json: async () => ({ reason: 'tier' }),
    })

    const { result } = renderHook(() => useCaseFileSession(SLUG_ARGS))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.gate).toEqual({ reason: 'tier' })
    expect(result.current.error).toBeNull()
  })

  it('429 session response surfaces gate.reason=limit with usedToday/limitToday', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeOkResponse(CHAPTER))
      .mockResolvedValueOnce({
        ok: false, status: 429,
        json: async () => ({ reason: 'limit', usedToday: 5, limitToday: 5 }),
      })

    const { result } = renderHook(() => useCaseFileSession(SLUG_ARGS))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.gate).toEqual({ reason: 'limit', usedToday: 5, limitToday: 5 })
    expect(result.current.sessionId).toBeNull()
  })

  it('non-ok session response sets error', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeOkResponse(CHAPTER))
      .mockResolvedValueOnce(makeErrorResponse(500, 'Internal error'))

    const { result } = renderHook(() => useCaseFileSession(SLUG_ARGS))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBeTruthy()
    expect(result.current.sessionId).toBeNull()
  })

  it('submitStage rejects when PATCH returns non-ok (error propagates to caller)', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeOkResponse(CHAPTER))
      .mockResolvedValueOnce(makeOkResponse(SESSION_RESPONSE))
      .mockResolvedValueOnce(makeErrorResponse(400, 'Bad stage data'))

    const { result } = renderHook(() => useCaseFileSession(SLUG_ARGS))
    await waitFor(() => expect(result.current.loading).toBe(false))

    let caughtError
    await act(async () => {
      try {
        await result.current.submitStage({ completed: true })
      } catch (e) {
        caughtError = e
      }
    })

    expect(caughtError).toBeDefined()
    // Stage index should NOT have advanced
    expect(result.current.currentStageIndex).toBe(0)
  })

  // A refresh used to throw the run away and spend another daily attempt. The
  // server now hands back the unfinished run; the hook has to adopt its stage
  // index AND its stage results, because phase_reveal rebuilds the player's
  // evidence-wall links from priorResults.
  describe('resuming an unfinished run', () => {
    it('seeds stage index and prior results from the resumed session', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce(makeOkResponse(CHAPTER))
        .mockResolvedValueOnce(makeOkResponse({
          sessionId:         'sess-resumed',
          currentStageIndex: 2,
          resumed:           true,
          stageResults: [
            { stageIndex: 0, stageType: 'cold_open',     payload: { completed: true } },
            { stageIndex: 1, stageType: 'evidence_wall', payload: { connections: [{ fromItemId: 'a', toItemId: 'b' }] } },
          ],
        }))

      const { result } = renderHook(() => useCaseFileSession(SLUG_ARGS))
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.sessionId).toBe('sess-resumed')
      expect(result.current.currentStageIndex).toBe(2)
      expect(result.current.resumed).toBe(true)
      expect(result.current.priorResults).toHaveLength(2)
      expect(result.current.priorResults[1].payload.connections).toEqual([
        { fromItemId: 'a', toItemId: 'b' },
      ])
    })

    it('reports a fresh session as not resumed', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce(makeOkResponse(CHAPTER))
        .mockResolvedValueOnce(makeOkResponse(SESSION_RESPONSE))

      const { result } = renderHook(() => useCaseFileSession(SLUG_ARGS))
      await waitFor(() => expect(result.current.loading).toBe(false))

      expect(result.current.resumed).toBe(false)
      expect(result.current.priorResults).toEqual([])
    })

    it('abandonSession posts to the abandon endpoint', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(makeOkResponse(CHAPTER))
        .mockResolvedValueOnce(makeOkResponse(SESSION_RESPONSE))
        .mockResolvedValueOnce(makeOkResponse({ abandoned: true }))
      global.fetch = fetchMock

      const { result } = renderHook(() => useCaseFileSession(SLUG_ARGS))
      await waitFor(() => expect(result.current.loading).toBe(false))

      await act(async () => { await result.current.abandonSession() })

      const [url, opts] = fetchMock.mock.calls[2]
      expect(url).toContain('/api/case-files/sessions/sess-abc-123/abandon')
      expect(opts.method).toBe('POST')
    })

    // "Give Up" means "start this case again", so the hook has to abandon the
    // old run (or the server would just hand it straight back) and then create
    // a fresh one, with none of the previous answers carried over.
    it('restartSession abandons the run then starts a new one at stage 1', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(makeOkResponse(CHAPTER))
        .mockResolvedValueOnce(makeOkResponse({
          sessionId: 'sess-old', currentStageIndex: 2, resumed: true,
          stageResults: [{ stageIndex: 0, stageType: 'cold_open', payload: { completed: true } }],
        }))
        .mockResolvedValueOnce(makeOkResponse({ abandoned: true }))   // abandon
        .mockResolvedValueOnce(makeOkResponse(CHAPTER))                // re-init
        .mockResolvedValueOnce(makeOkResponse({ sessionId: 'sess-new', currentStageIndex: 0 }))
      global.fetch = fetchMock

      const { result } = renderHook(() => useCaseFileSession(SLUG_ARGS))
      await waitFor(() => expect(result.current.currentStageIndex).toBe(2))

      await act(async () => { await result.current.restartSession() })
      await waitFor(() => expect(result.current.sessionId).toBe('sess-new'))

      expect(fetchMock.mock.calls[2][0]).toContain('/sessions/sess-old/abandon')
      expect(result.current.currentStageIndex).toBe(0)
      expect(result.current.resumed).toBe(false)
      expect(result.current.priorResults).toEqual([])
    })

    it('abandonSession swallows a failed request', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce(makeOkResponse(CHAPTER))
        .mockResolvedValueOnce(makeOkResponse(SESSION_RESPONSE))
        .mockRejectedValueOnce(new Error('offline'))

      const { result } = renderHook(() => useCaseFileSession(SLUG_ARGS))
      await waitFor(() => expect(result.current.loading).toBe(false))

      await act(async () => {
        await expect(result.current.abandonSession()).resolves.toBeUndefined()
      })
    })
  })

  it('handles server response wrapped in { data: ... } envelope', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeOkResponse({ data: CHAPTER }))           // chapter wrapped
      .mockResolvedValueOnce(makeOkResponse({ data: SESSION_RESPONSE }))  // session wrapped

    const { result } = renderHook(() => useCaseFileSession(SLUG_ARGS))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.chapter).toEqual(CHAPTER)
    expect(result.current.sessionId).toBe('sess-abc-123')
  })
})
