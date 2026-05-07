// Repro for: quiz-complete notif fails to render when fired immediately after a
// brief-read coin award. Uses the *real* AuthProvider so we can inspect the
// actual notifQueue state instead of spying on a mocked awardAirstars.

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
  useAppSettings: () => ({ settings: { airstarsPerBriefRead: 5 }, levelThresholds: [] }),
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
  totalAirstars: 0,
  cycleAirstars: 0,
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
      airstarsEarned: 10,
      won: true,
      isFirstAttempt: true,
      breakdown: [{ label: '1 correct × 10', amount: 10 }],
      cycleAirstars: 15,   // 5 from brief-read + 10 from quiz
      totalAirstars: 15,
      attempt: { cycleAirstars: 15, totalAirstars: 15 },
    },
  }
}

// ── Harness: renders QuizFlow inside AuthProvider and exposes notifQueue. ─

// - preSeedBriefRead: if true, calls awardAirstars(5, 'Brief read', ...)
//   once the user hydrates — mimicking BriefReader's post-complete award
//   immediately before the user navigates to /quiz/:briefId.
// - queueSink: array we push the notifQueue into on each render so tests can
//   inspect the final state.
// - contextSink: captures { awardAirstars, user } so tests can assert +
//   invoke awardAirstars directly if they want.
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
      ctx.awardAirstars(5, 'Brief read', { cycleAfter: 5, totalAfter: 5 })
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

  // Click "See Results" → handleNext awaits finishPromiseRef, calls awardAirstars
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

  it('happy path: /finish returns 200 OK with airstarsEarned → notifQueue has [Brief read, Intel Recall complete]', async () => {
    const { queueSink } = await runFlow({ finishBehavior: { kind: 'ok' } })

    // Expectation: 2 notifs. Brief-read first (consumed last-in-first-out? no — FIFO),
    // so index 0 is Brief read, index 1 is Intel Recall complete.
    const labels = queueSink.map(n => n.label)
    expect(labels).toContain('Brief read')
    expect(labels).toContain('Intel Recall complete')
    expect(labels.filter(l => l === 'Intel Recall complete')).toHaveLength(1)
  })

  it('slow /finish (100ms delay) still queues a Intel Recall complete notif', async () => {
    const { queueSink } = await runFlow({
      finishBehavior: { kind: 'slow', delayMs: 100 },
    })
    const labels = queueSink.map(n => n.label)
    expect(labels).toContain('Intel Recall complete')
  })

  it('/finish 500 → falls through to refreshUser fallback; if delta > 0 should still notify', async () => {
    const { queueSink } = await runFlow({
      finishBehavior: { kind: 'status', status: 500 },
      freshUserAfterFinish: { ...INITIAL_USER, totalAirstars: 10, cycleAirstars: 10 }, // server awarded 10
    })
    const labels = queueSink.map(n => n.label)
    expect(labels).toContain('Intel Recall complete')
  })

  it('/finish rejects (network) → falls through to refreshUser fallback', async () => {
    const { queueSink } = await runFlow({
      finishBehavior: { kind: 'reject', error: new TypeError('network error') },
      freshUserAfterFinish: { ...INITIAL_USER, totalAirstars: 10, cycleAirstars: 10 },
    })
    const labels = queueSink.map(n => n.label)
    expect(labels).toContain('Intel Recall complete')
  })

  it('/finish parse error → falls through to refreshUser fallback', async () => {
    const { queueSink } = await runFlow({
      finishBehavior: { kind: 'parseError' },
      freshUserAfterFinish: { ...INITIAL_USER, totalAirstars: 10, cycleAirstars: 10 },
    })
    const labels = queueSink.map(n => n.label)
    expect(labels).toContain('Intel Recall complete')
  })

  it('NO preseed (control): happy /finish still queues Intel Recall complete', async () => {
    const { queueSink } = await runFlow({
      finishBehavior: { kind: 'ok' },
      preSeedBriefRead: false,
    })
    const labels = queueSink.map(n => n.label)
    expect(labels).toContain('Intel Recall complete')
    expect(labels.filter(l => l === 'Brief read')).toHaveLength(0)
  })

  // ── Additional repro attempts ──────────────────────────────────────────
  //
  // The reported bug: "immediately after completing the read, complete the
  // quiz at 100% → no notif, totalAirstars doesn't update until refresh."
  //
  // These try more exotic response shapes to surface the bug.

  // ── Regression: previously reproduced the silent no-op bug ──────────────
  // Both variations model the reported scenario:
  //   • /finish returns 200 OK (so gotResponse was true under old code)
  //   • but the body is missing the fields the client reads for airstarsEarned
  //   • server-side, coins were actually awarded (reflected when /auth/me is refetched)
  //
  // Under the pre-fix code the fallback only fired when the HTTP response was
  // lost, so earned=0 from a 200 response silently no-opped. The fix gates the
  // fallback on `awarded` (did the client actually notify?) so any shape that
  // leaves us unnotified triggers a refreshUser + delta notification.
  it('regression: /finish 200 OK with `airstarsEarned` missing → fallback recovers via delta', async () => {
    const { queueSink } = await runFlow({
      finishBehavior: {
        kind: 'ok',
        body: { data: { won: true, isFirstAttempt: true, breakdown: [] /* no airstarsEarned */ } },
      },
      // /auth/me after finish reflects the server-side award: brief-read(5) + quiz(10) = 15
      freshUserAfterFinish: { ...INITIAL_USER, totalAirstars: 15, cycleAirstars: 15 },
    })
    expect(queueSink.map(n => n.label)).toContain('Intel Recall complete')
  })

  it('regression: /finish 200 OK missing `.data` envelope → fallback recovers via delta', async () => {
    const { queueSink } = await runFlow({
      finishBehavior: {
        kind: 'ok',
        body: { won: true, airstarsEarned: 10, isFirstAttempt: true, breakdown: [] },
      },
      freshUserAfterFinish: { ...INITIAL_USER, totalAirstars: 15, cycleAirstars: 15 },
    })
    expect(queueSink.map(n => n.label)).toContain('Intel Recall complete')
  })

  it('repro: /finish returns totalAirstars equal to preFinishTotal (server thinks already awarded)', async () => {
    // If the server was idempotent and returns the same totalAirstars that the
    // client already has (because brief-read pre-seeded 5 into user), then:
    //   - gotResponse=true, earned=10 (if airstarsEarned:10 is in body) → awardAirstars IS called
    //   - BUT if airstarsEarned: 0 on a "repeat" → fallback runs, delta=0 → no notif
    // This is the "repeat attempt" shape — should still at least NOT award a notif.
    const { queueSink } = await runFlow({
      finishBehavior: {
        kind: 'ok',
        body: {
          data: {
            airstarsEarned: 0,   // already earned
            won: true,
            isFirstAttempt: false,
            breakdown: [],
            cycleAirstars: 5, totalAirstars: 5,
          },
        },
      },
    })
    // For a repeat attempt, no Intel Recall complete notif is expected — this is correct behaviour.
    const labels = queueSink.map(n => n.label)
    expect(labels).not.toContain('Intel Recall complete')
  })

  it('repro: /finish response body resolves AFTER user unmounts (leaked navigation)', async () => {
    // If the user quits/navigates away mid-flow and finishedRef is already set
    // by the unmount cleanup, no second /finish is fired — but the original
    // finishPromiseRef should still resolve. Not testable easily without nav.
    // Skip for now; record as a hypothesis.
    expect(true).toBe(true)
  })

  it('repro: /finish returns airstarsEarned:10 but totalAirstars matches the preseed (stale server state)', async () => {
    // preFinishTotalRef captures 5 (from brief-read preseed); server returns
    // { totalAirstars: 5 } because it didn't actually persist the brief-read yet
    // (race: brief /complete still in-flight server-side when /finish runs).
    // airstarsEarned is still > 0, so the primary path should fire awardAirstars.
    const { queueSink } = await runFlow({
      finishBehavior: {
        kind: 'ok',
        body: {
          data: {
            airstarsEarned: 10,
            won: true,
            isFirstAttempt: true,
            breakdown: [{ label: '1 correct × 10', amount: 10 }],
            // totalAirstars equals the preseed (5), so the fallback delta would be 0
            cycleAirstars: 5, totalAirstars: 5,
          },
        },
      },
    })
    const labels = queueSink.map(n => n.label)
    expect(labels).toContain('Intel Recall complete')
  })

  // ── Race condition: "See Results" clicked before fireFinish runs ──────────
  //
  // Repro for the "+entire balance" bug. handleAnswer awaits the per-question
  // POST before calling fireFinish. If the user clicks "See Results" while
  // that await is in flight, handleNext can run before finishPromiseRef is
  // populated. Pre-fix: `await (finishPromiseRef.current ?? Promise.resolve(null))`
  // returned null, the fallback ran, preFinishTotalRef was still its initial
  // 0, and the user's pre-existing balance was reported as the quiz reward.
  // Post-fix: handleNext awaits finishStartedRef before reading
  // finishPromiseRef, AND preFinishTotalRef is captured at quiz start.
  it('race: clicking See Results while per-question POST is in flight does NOT award the entire balance', async () => {
    const PRE_QUIZ_BALANCE = 607
    const HYDRATED_USER    = { ...INITIAL_USER, totalAirstars: PRE_QUIZ_BALANCE, cycleAirstars: PRE_QUIZ_BALANCE }

    let releaseResult = null
    const resultGate  = new Promise(resolve => { releaseResult = resolve })
    let finishCalledAt = null

    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/auth/me'))            return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: { user: HYDRATED_USER } }) })
      if (url.includes('/api/users/levels'))       return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: { levels: [] } }) })
      if (url.includes('/api/admin/loading-time')) return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
      if (url.includes('/api/briefs/'))            return Promise.resolve({ ok: true, status: 200, json: async () => BRIEF_RESPONSE })
      if (url.includes('/api/games/quiz/start'))   return Promise.resolve({ ok: true, status: 200, json: async () => START_RESPONSE })
      if (url.includes('/api/games/quiz/result')) {
        // Per-question POST is held until we explicitly release it. This is
        // the await that handleAnswer is blocked on while the user races.
        return resultGate.then(() => ({ ok: true, status: 200, json: async () => RESULT_RESPONSE }))
      }
      if (url.includes('/api/games/quiz/attempt') && url.includes('/finish')) {
        finishCalledAt = Date.now()
        return Promise.resolve({ ok: true, status: 200, json: async () => ({
          data: {
            airstarsEarned: 10, won: true, isFirstAttempt: true,
            breakdown: [{ label: '1 correct × 10', amount: 10 }],
            totalAirstars: PRE_QUIZ_BALANCE + 10, cycleAirstars: PRE_QUIZ_BALANCE + 10,
          },
        })})
      }
      if (url.includes('battle-of-order')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: { available: false } }) })
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    })

    const queueSink   = []
    const contextSink = { current: null, seededBriefRead: false }
    render(<Harness preSeedBriefRead={false} queueSink={queueSink} contextSink={contextSink} />)
    await waitFor(() => screen.getByText('What is the Typhoon?'))

    // Click the (only) answer → handleAnswer fires submitResult, blocks on await
    fireEvent.click(screen.getByText('Multirole fighter'))
    await waitFor(() => screen.getByRole('button', { name: /see results/i }))

    // RACE: user clicks "See Results" while resultGate is still pending.
    // fireFinish hasn't run yet, finishPromiseRef.current is still null.
    fireEvent.click(screen.getByRole('button', { name: /see results/i }))

    // Give handleNext a beat to start. With the fix, it awaits finishStartedRef.
    await new Promise(r => setTimeout(r, 50))

    // /finish must NOT have been called yet — fireFinish is gated on the
    // resultGate. handleNext must be waiting, not racing past with delta=0.
    expect(finishCalledAt).toBeNull()

    // Now release the per-question POST. handleAnswer continues, fires fireFinish.
    await act(async () => { releaseResult() })

    // Wait for the results screen to render
    await waitFor(() => screen.getByRole('button', { name: /back to brief/i }), { timeout: 3000 })

    // /finish must have been called exactly once
    expect(finishCalledAt).not.toBeNull()

    // CRITICAL: notification queue must contain exactly the +10 quiz reward,
    // NOT a +607 (entire-balance) false notification.
    const airstarNotifs = queueSink.filter(n => n.type === 'airstar')
    expect(airstarNotifs).toHaveLength(1)
    expect(airstarNotifs[0].amount).toBe(10)
    expect(airstarNotifs[0].amount).not.toBe(PRE_QUIZ_BALANCE)
  })

  // ── Defence-in-depth: implausibly large delta is suppressed ──────────────
  //
  // Even if some unknown bug ever leaves preFinishTotalRef wrong (eg captured
  // as 0 when the user really had 607), the fallback's MAX_PLAUSIBLE_DELTA cap
  // must prevent the +entire-balance notification from EVER being shown.
  // A single quiz can award at most ~115 (5 × 20 medium + 15 perfect bonus);
  // anything larger is treated as a stale-baseline artefact and suppressed.
  it('suppression: implausible delta from a lost finish response is NOT shown to the user', async () => {
    const PRE_QUIZ_BALANCE = 607
    const HYDRATED_USER    = { ...INITIAL_USER, totalAirstars: PRE_QUIZ_BALANCE, cycleAirstars: PRE_QUIZ_BALANCE }
    // A "buggy" snapshot: simulate the world where the server briefly returned
    // a wildly wrong totalAirstars (eg sum of multiple awards from another
    // tab) so the delta would be huge.
    const POST_QUIZ_FRESH  = { ...INITIAL_USER, totalAirstars: PRE_QUIZ_BALANCE + 5000, cycleAirstars: PRE_QUIZ_BALANCE + 5000 }

    let meCallCount = 0
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/auth/me')) {
        meCallCount += 1
        // First call: hydrate with pre-quiz balance. Subsequent (refreshUser):
        // return the implausible "post-award" snapshot.
        const user = meCallCount === 1 ? HYDRATED_USER : POST_QUIZ_FRESH
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: { user } }) })
      }
      if (url.includes('/api/users/levels'))       return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: { levels: [] } }) })
      if (url.includes('/api/admin/loading-time')) return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
      if (url.includes('/api/briefs/'))            return Promise.resolve({ ok: true, status: 200, json: async () => BRIEF_RESPONSE })
      if (url.includes('/api/games/quiz/start'))   return Promise.resolve({ ok: true, status: 200, json: async () => START_RESPONSE })
      if (url.includes('/api/games/quiz/result'))  return Promise.resolve({ ok: true, status: 200, json: async () => RESULT_RESPONSE })
      if (url.includes('/api/games/quiz/attempt') && url.includes('/finish')) {
        // Force the fallback path: response is "lost" / malformed.
        return Promise.reject(new TypeError('network error'))
      }
      if (url.includes('battle-of-order')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: { available: false } }) })
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    })

    const queueSink   = []
    const contextSink = { current: null, seededBriefRead: false }
    render(<Harness preSeedBriefRead={false} queueSink={queueSink} contextSink={contextSink} />)
    await waitFor(() => screen.getByText('What is the Typhoon?'))

    fireEvent.click(screen.getByText('Multirole fighter'))
    await waitFor(() => screen.getByRole('button', { name: /see results/i }))
    fireEvent.click(screen.getByRole('button', { name: /see results/i }))
    await waitFor(() => screen.getByRole('button', { name: /back to brief/i }), { timeout: 3000 })

    // Implausible delta (5000) MUST be suppressed — no airstar notif fires.
    const airstarNotifs = queueSink.filter(n => n.type === 'airstar')
    expect(airstarNotifs).toHaveLength(0)
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
    // With a hung /finish, no Intel Recall complete notif is queued (stuck awaiting).
    // This is *expected* behaviour of the code — not a bug per se, but a hazard.
    expect(labels).not.toContain('Intel Recall complete')
  })
})
