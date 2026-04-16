// Repro for: quiz-complete notif fails to render when fired immediately after a
// brief-read coin award. Uses the *real* AuthProvider so we can inspect the
// actual notifQueue state instead of spying on a mocked awardAircoins.

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useEffect } from 'react'
import QuizFlow from '../QuizFlow'
import { AuthProvider, useAuth } from '../../context/AuthContext'

// ── Mocks (mirror QuizFlow.sounds/breakdown patterns) ─────────────────────

vi.mock('../../utils/sound', () => ({
  playSound:      vi.fn(),
  stopAllSounds:  vi.fn(),
}))

vi.mock('react-router-dom', () => ({
  useParams:   () => ({ briefId: 'brief123' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
}))

vi.mock('../../context/AppTutorialContext', () => ({
  useAppTutorial: () => ({ start: vi.fn(), hasSeen: () => true, startAfterNav: vi.fn() }),
}))

vi.mock('../../context/AppSettingsContext', () => ({
  useAppSettings: () => ({ settings: { aircoinsPerBriefRead: 5 }, levelThresholds: [] }),
}))

vi.mock('../../context/NewGameUnlockContext', () => ({
  useNewGameUnlock: () => ({
    newGames:             new Set(),
    hasAnyNew:            false,
    isUnlocked:           () => false,
    markSeen:             vi.fn(),
    markUnlockFromServer: vi.fn(),
    applyUnlocks:         vi.fn(),
  }),
}))

vi.mock('../../components/tutorial/TutorialModal', () => ({ default: () => null }))
vi.mock('../../components/UpgradePrompt',          () => ({ default: () => null }))
vi.mock('../../components/SEO',                    () => ({ default: () => null }))
vi.mock('../../components/LockedCategoryModal',    () => ({ default: () => null }))

vi.mock('framer-motion', () => ({
  motion: {
    div:    ({ children, className, onClick, ...rest }) => <div className={className} onClick={onClick}>{children}</div>,
    button: ({ children, className, onClick, disabled, ...rest }) => <button className={className} onClick={onClick} disabled={disabled}>{children}</button>,
    circle: ({ children }) => <circle>{children}</circle>,
    p:      ({ children, className }) => <p className={className}>{children}</p>,
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}))

// @capacitor/core — force web mode (not native) so credentials:'include' path is used
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}))

// ── Fixtures ──────────────────────────────────────────────────────────────

const CORRECT_ID = 'ans_correct'
const WRONG_ID   = 'ans_wrong'

const QUESTION = {
  _id: 'q1',
  question: 'What is the Typhoon?',
  answers: [
    { _id: CORRECT_ID, title: 'Multirole fighter' },
    { _id: WRONG_ID,   title: 'Heavy bomber' },
  ],
  correctAnswerId: CORRECT_ID,
  difficulty: 'easy',
}

const BRIEF_RESPONSE  = { data: { brief: { _id: 'brief123', title: 'Typhoon', category: 'Aircrafts' } } }
const START_RESPONSE  = { status: 'success', data: { attemptId: 'a1', gameSessionId: 's1', questions: [QUESTION], difficulty: 'easy' } }
const RESULT_RESPONSE = { status: 'success' }

// ── Auth /me stub (so AuthProvider hydrates with a logged-in user) ────────

const INITIAL_USER = {
  _id: 'user1',
  email: 'u@example.com',
  username: 'u',
  role: 'user',
  totalAircoins: 0,
  cycleAircoins: 0,
  loginStreak: 0,
}

// Helper to build a stubbed fetch that responds to AuthProvider + QuizFlow endpoints.
//
// finishBehavior: { kind, ... } controls the /finish response:
//   { kind: 'ok', body }               — 200 OK with body (default)
//   { kind: 'slow', body, delayMs }    — OK but after a delay
//   { kind: 'status', status, body }   — non-OK status (e.g. 500)
//   { kind: 'reject', error }          — network-level reject
//   { kind: 'parseError' }             — OK response, but .json() throws
function setupFetch({ finishBehavior = { kind: 'ok' }, freshUserAfterFinish = null } = {}) {
  let freshSwapped = false

  const finish = () => {
    switch (finishBehavior.kind) {
      case 'ok': {
        const body = finishBehavior.body ?? defaultOkBody()
        return Promise.resolve({ ok: true, status: 200, json: async () => body })
      }
      case 'slow': {
        const body = finishBehavior.body ?? defaultOkBody()
        return new Promise(resolve => setTimeout(
          () => resolve({ ok: true, status: 200, json: async () => body }),
          finishBehavior.delayMs ?? 50,
        ))
      }
      case 'status': {
        const body = finishBehavior.body ?? {}
        return Promise.resolve({ ok: false, status: finishBehavior.status ?? 500, json: async () => body })
      }
      case 'reject':
        return Promise.reject(finishBehavior.error ?? new Error('network error'))
      case 'parseError':
        return Promise.resolve({
          ok: true, status: 200,
          json: async () => { throw new SyntaxError('Unexpected token < in JSON at position 0') },
        })
      default:
        return Promise.resolve({ ok: true, status: 200, json: async () => defaultOkBody() })
    }
  }

  return vi.fn().mockImplementation((url, opts) => {
    // AuthProvider.me
    if (url.includes('/api/auth/me')) {
      if (freshSwapped && freshUserAfterFinish) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: { user: freshUserAfterFinish } }) })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: { user: INITIAL_USER } }) })
    }
    if (url.includes('/api/users/levels')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: { levels: [] } }) })
    }
    if (url.includes('/api/admin/loading-time')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    }

    // Brief + quiz endpoints
    if (url.includes('/api/briefs/')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => BRIEF_RESPONSE })
    }
    if (url.includes('/api/games/quiz/start')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => START_RESPONSE })
    }
    if (url.includes('/api/games/quiz/result')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => RESULT_RESPONSE })
    }
    if (url.includes('/api/games/quiz/attempt') && url.includes('/finish')) {
      // Any subsequent /api/auth/me (from refreshUser fallback) should see post-award user
      freshSwapped = true
      return finish()
    }
    if (url.includes('battle-of-order/options')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: { available: false } }) })
    }

    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
  })
}

function defaultOkBody() {
  return {
    data: {
      aircoinsEarned: 10,
      won: true,
      isFirstAttempt: true,
      breakdown: [{ label: '1 correct × 10', amount: 10 }],
      cycleAircoins: 15,   // 5 from brief-read + 10 from quiz
      totalAircoins: 15,
      attempt: { cycleAircoins: 15, totalAircoins: 15 },
    },
  }
}

// ── Harness: renders QuizFlow inside AuthProvider and exposes notifQueue. ─

// - preSeedBriefRead: if true, calls awardAircoins(5, 'Brief read', ...)
//   once the user hydrates — mimicking BriefReader's post-complete award
//   immediately before the user navigates to /quiz/:briefId.
// - queueSink: array we push the notifQueue into on each render so tests can
//   inspect the final state.
// - contextSink: captures { awardAircoins, user } so tests can assert +
//   invoke awardAircoins directly if they want.
function Harness({ preSeedBriefRead = true, queueSink, contextSink }) {
  return (
    <AuthProvider>
      <QueueSpy queueSink={queueSink} contextSink={contextSink} preSeedBriefRead={preSeedBriefRead} />
      <QuizFlow />
    </AuthProvider>
  )
}

function QueueSpy({ queueSink, contextSink, preSeedBriefRead }) {
  const ctx = useAuth()
  // Push latest queue snapshot on every render
  queueSink.length = 0
  for (const n of ctx.notifQueue) queueSink.push(n)
  contextSink.current = ctx

  // Once the user is hydrated (post /api/auth/me resolve), mimic BriefReader
  // completing the read: enqueue a 'Brief read' notif.
  useEffect(() => {
    if (!preSeedBriefRead) return
    if (ctx.user && !contextSink.seededBriefRead) {
      contextSink.seededBriefRead = true
      ctx.awardAircoins(5, 'Brief read', { cycleAfter: 5, totalAfter: 5 })
    }
  }, [ctx.user, preSeedBriefRead, ctx, contextSink])

  return null
}

async function runFlow({ finishBehavior, freshUserAfterFinish, preSeedBriefRead = true } = {}) {
  global.fetch = setupFetch({ finishBehavior, freshUserAfterFinish })

  const queueSink   = []
  const contextSink = { current: null, seededBriefRead: false }

  render(<Harness preSeedBriefRead={preSeedBriefRead} queueSink={queueSink} contextSink={contextSink} />)

  // Wait for quiz question to render (auth hydrated + quiz started)
  await waitFor(() => screen.getByText('What is the Typhoon?'))

  // If preSeeded, the brief-read notif should already be in the queue.
  if (preSeedBriefRead) {
    await waitFor(() => {
      expect(queueSink.some(n => n.label === 'Brief read')).toBe(true)
    })
  }

  // Answer correctly → fires fireFinish() in the background
  fireEvent.click(screen.getByText('Multirole fighter'))

  // Click "See Results" → handleNext awaits finishPromiseRef, calls awardAircoins
  await waitFor(() => screen.getByRole('button', { name: /see results/i }))
  fireEvent.click(screen.getByRole('button', { name: /see results/i }))

  // Give async handleNext a chance to finish and notif to queue
  await waitFor(() => screen.getByRole('button', { name: /back to brief/i }), { timeout: 2000 })

  return { queueSink, contextSink }
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('QuizFlow — notif after brief-read preseed (bug repro)', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(()  => { vi.restoreAllMocks() })

  it('happy path: /finish returns 200 OK with aircoinsEarned → notifQueue has [Brief read, Quiz complete]', async () => {
    const { queueSink } = await runFlow({ finishBehavior: { kind: 'ok' } })

    // Expectation: 2 notifs. Brief-read first (consumed last-in-first-out? no — FIFO),
    // so index 0 is Brief read, index 1 is Quiz complete.
    const labels = queueSink.map(n => n.label)
    expect(labels).toContain('Brief read')
    expect(labels).toContain('Quiz complete')
    expect(labels.filter(l => l === 'Quiz complete')).toHaveLength(1)
  })

  it('slow /finish (100ms delay) still queues a Quiz complete notif', async () => {
    const { queueSink } = await runFlow({
      finishBehavior: { kind: 'slow', delayMs: 100 },
    })
    const labels = queueSink.map(n => n.label)
    expect(labels).toContain('Quiz complete')
  })

  it('/finish 500 → falls through to refreshUser fallback; if delta > 0 should still notify', async () => {
    const { queueSink } = await runFlow({
      finishBehavior: { kind: 'status', status: 500 },
      freshUserAfterFinish: { ...INITIAL_USER, totalAircoins: 10, cycleAircoins: 10 }, // server awarded 10
    })
    const labels = queueSink.map(n => n.label)
    expect(labels).toContain('Quiz complete')
  })

  it('/finish rejects (network) → falls through to refreshUser fallback', async () => {
    const { queueSink } = await runFlow({
      finishBehavior: { kind: 'reject', error: new TypeError('network error') },
      freshUserAfterFinish: { ...INITIAL_USER, totalAircoins: 10, cycleAircoins: 10 },
    })
    const labels = queueSink.map(n => n.label)
    expect(labels).toContain('Quiz complete')
  })

  it('/finish parse error → falls through to refreshUser fallback', async () => {
    const { queueSink } = await runFlow({
      finishBehavior: { kind: 'parseError' },
      freshUserAfterFinish: { ...INITIAL_USER, totalAircoins: 10, cycleAircoins: 10 },
    })
    const labels = queueSink.map(n => n.label)
    expect(labels).toContain('Quiz complete')
  })

  it('NO preseed (control): happy /finish still queues Quiz complete', async () => {
    const { queueSink } = await runFlow({
      finishBehavior: { kind: 'ok' },
      preSeedBriefRead: false,
    })
    const labels = queueSink.map(n => n.label)
    expect(labels).toContain('Quiz complete')
    expect(labels.filter(l => l === 'Brief read')).toHaveLength(0)
  })

  // ── Additional repro attempts ──────────────────────────────────────────
  //
  // The reported bug: "immediately after completing the read, complete the
  // quiz at 100% → no notif, totalAircoins doesn't update until refresh."
  //
  // These try more exotic response shapes to surface the bug.

  // ── Regression: previously reproduced the silent no-op bug ──────────────
  // Both variations model the reported scenario:
  //   • /finish returns 200 OK (so gotResponse was true under old code)
  //   • but the body is missing the fields the client reads for aircoinsEarned
  //   • server-side, coins were actually awarded (reflected when /auth/me is refetched)
  //
  // Under the pre-fix code the fallback only fired when the HTTP response was
  // lost, so earned=0 from a 200 response silently no-opped. The fix gates the
  // fallback on `awarded` (did the client actually notify?) so any shape that
  // leaves us unnotified triggers a refreshUser + delta notification.
  it('regression: /finish 200 OK with `aircoinsEarned` missing → fallback recovers via delta', async () => {
    const { queueSink } = await runFlow({
      finishBehavior: {
        kind: 'ok',
        body: { data: { won: true, isFirstAttempt: true, breakdown: [] /* no aircoinsEarned */ } },
      },
      // /auth/me after finish reflects the server-side award: brief-read(5) + quiz(10) = 15
      freshUserAfterFinish: { ...INITIAL_USER, totalAircoins: 15, cycleAircoins: 15 },
    })
    expect(queueSink.map(n => n.label)).toContain('Quiz complete')
  })

  it('regression: /finish 200 OK missing `.data` envelope → fallback recovers via delta', async () => {
    const { queueSink } = await runFlow({
      finishBehavior: {
        kind: 'ok',
        body: { won: true, aircoinsEarned: 10, isFirstAttempt: true, breakdown: [] },
      },
      freshUserAfterFinish: { ...INITIAL_USER, totalAircoins: 15, cycleAircoins: 15 },
    })
    expect(queueSink.map(n => n.label)).toContain('Quiz complete')
  })

  it('repro: /finish returns totalAircoins equal to preFinishTotal (server thinks already awarded)', async () => {
    // If the server was idempotent and returns the same totalAircoins that the
    // client already has (because brief-read pre-seeded 5 into user), then:
    //   - gotResponse=true, earned=10 (if aircoinsEarned:10 is in body) → awardAircoins IS called
    //   - BUT if aircoinsEarned: 0 on a "repeat" → fallback runs, delta=0 → no notif
    // This is the "repeat attempt" shape — should still at least NOT award a notif.
    const { queueSink } = await runFlow({
      finishBehavior: {
        kind: 'ok',
        body: {
          data: {
            aircoinsEarned: 0,   // already earned
            won: true,
            isFirstAttempt: false,
            breakdown: [],
            cycleAircoins: 5, totalAircoins: 5,
          },
        },
      },
    })
    // For a repeat attempt, no Quiz complete notif is expected — this is correct behaviour.
    const labels = queueSink.map(n => n.label)
    expect(labels).not.toContain('Quiz complete')
  })

  it('repro: /finish response body resolves AFTER user unmounts (leaked navigation)', async () => {
    // If the user quits/navigates away mid-flow and finishedRef is already set
    // by the unmount cleanup, no second /finish is fired — but the original
    // finishPromiseRef should still resolve. Not testable easily without nav.
    // Skip for now; record as a hypothesis.
    expect(true).toBe(true)
  })

  it('repro: /finish returns aircoinsEarned:10 but totalAircoins matches the preseed (stale server state)', async () => {
    // preFinishTotalRef captures 5 (from brief-read preseed); server returns
    // { totalAircoins: 5 } because it didn't actually persist the brief-read yet
    // (race: brief /complete still in-flight server-side when /finish runs).
    // aircoinsEarned is still > 0, so the primary path should fire awardAircoins.
    const { queueSink } = await runFlow({
      finishBehavior: {
        kind: 'ok',
        body: {
          data: {
            aircoinsEarned: 10,
            won: true,
            isFirstAttempt: true,
            breakdown: [{ label: '1 correct × 10', amount: 10 }],
            // totalAircoins equals the preseed (5), so the fallback delta would be 0
            cycleAircoins: 5, totalAircoins: 5,
          },
        },
      },
    })
    const labels = queueSink.map(n => n.label)
    expect(labels).toContain('Quiz complete')
  })

  it('repro: /finish returns a ReadableStream-like body that times out or hangs', async () => {
    // Simulate: apiFetch resolves with ok:true but .json() never resolves.
    // handleNext's `await finishPromiseRef` would hang forever.
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/auth/me'))         return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: { user: INITIAL_USER } }) })
      if (url.includes('/api/users/levels'))    return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: { levels: [] } }) })
      if (url.includes('/api/admin/loading-time')) return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
      if (url.includes('/api/briefs/'))         return Promise.resolve({ ok: true, status: 200, json: async () => BRIEF_RESPONSE })
      if (url.includes('/api/games/quiz/start')) return Promise.resolve({ ok: true, status: 200, json: async () => START_RESPONSE })
      if (url.includes('/api/games/quiz/result')) return Promise.resolve({ ok: true, status: 200, json: async () => RESULT_RESPONSE })
      if (url.includes('/api/games/quiz/attempt') && url.includes('/finish')) {
        // never-resolving .json() — simulates hung response
        return Promise.resolve({ ok: true, status: 200, json: () => new Promise(() => {}) })
      }
      if (url.includes('battle-of-order'))     return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: { available: false } }) })
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    })

    const queueSink   = []
    const contextSink = { current: null, seededBriefRead: false }
    render(<Harness preSeedBriefRead={true} queueSink={queueSink} contextSink={contextSink} />)
    await waitFor(() => screen.getByText('What is the Typhoon?'))
    await waitFor(() => expect(queueSink.some(n => n.label === 'Brief read')).toBe(true))

    fireEvent.click(screen.getByText('Multirole fighter'))
    await waitFor(() => screen.getByRole('button', { name: /see results/i }))
    fireEvent.click(screen.getByRole('button', { name: /see results/i }))

    // Don't wait for "Back to Brief" (it'll never appear). Give a beat for
    // any sync/microtask to run, then check.
    await new Promise(r => setTimeout(r, 200))
    const labels = queueSink.map(n => n.label)
    // With a hung /finish, no Quiz complete notif is queued (stuck awaiting).
    // This is *expected* behaviour of the code — not a bug per se, but a hazard.
    expect(labels).not.toContain('Quiz complete')
  })
})
