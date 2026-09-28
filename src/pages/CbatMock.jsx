// Mock Assessment — /cbat/mock and /cbat/mock/:id
//
// One sitting of every test a role is scored on (or every role in a region), in a shuffled order,
// with a 10-minute break after about every 30 minutes of tests, and a score sheet at the end laid
// out like the real one. Three screens live here:
//
//   the START page — pick a role, see what it involves, agree to the rules, start
//   the RUNNER     — between tests: "Test 4 of 15", breaks, the finish estimate, the idle deadline
//   the SHEET      — /cbat/mock/:id, the score sheet for a finished sitting, with Print
//
// The tests themselves are the ordinary game pages. While a mock is active the site lock
// (components/cbat/CbatMockLock.jsx) keeps the player on this page and the test it is waiting for;
// each game's end screen hands back here (components/cbat/CbatMockGameOver.jsx).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useAppSettings } from '../context/AppSettingsContext'
import SEO from '../components/SEO'
import CbatMockScoreSheet from '../components/cbat/CbatMockScoreSheet'
import CbatMockPractiseNext from '../components/cbat/CbatMockPractiseNext'
import CbatMockAdminStats, { MockSimulateButtons, MockSimulatedNote } from '../components/cbat/CbatMockAdminStats'
import AdminToolPanel from '../components/AdminToolPanel'
import { useGameBodyClass } from '../hooks/useGameBodyClass'
import {
  BATTERY_BY_KEY, REGIONS, REGION_CODES, TESTS, batteryGroupsFor, gameTitle, normaliseRegion,
} from '../data/cbatBatteries'
import {
  MOCK_CONFIG, MOCK_ROUTE, useActiveMock, setActiveMock, refreshActiveMock, currentStep, nextGameKey,
  mockGamePath, hasTutorial, breakEndsAt, estimatedFinish, formatClock, formatDuration, mockUrl,
  requestLeaveMock, grantGamePath, SIMULATED_MOCK_ID,
} from '../lib/cbatMockSession'
import { captureEvent } from '../lib/posthog'

// ── Small shared pieces ──────────────────────────────────────────────────────────────────────

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

function stepName(codes) {
  const labels = [...new Set(codes.map(c => TESTS[c]?.label ?? c))]
  return labels[0] ?? ''
}

// What the player is about to sit: the test's name, or for Visualisation's two-part step, which
// half is next.
function nextTestName(mock) {
  const step = currentStep(mock)
  if (!step) return ''
  if (step.gameKeys.length > 1) {
    const next = nextGameKey(mock)
    const part = step.gameKeys.indexOf(next) + 1
    return `${gameTitle(next)} (part ${part} of ${step.gameKeys.length})`
  }
  return stepName(step.codes)
}

const isTouchOnly = () => {
  try { return window.matchMedia('(hover: none)').matches } catch { return false }
}

function Card({ children, className = '', ...rest }) {
  return (
    <div className={`bg-surface border border-slate-200 rounded-2xl p-4 sm:p-5 card-shadow ${className}`} {...rest}>
      {children}
    </div>
  )
}

// ── Start page ───────────────────────────────────────────────────────────────────────────────

function RegionButtons({ value, onChange }) {
  return (
    <div role="radiogroup" aria-label="Test you're sitting" className="grid grid-cols-3 gap-1.5 mb-3">
      {REGION_CODES.map(code => {
        const selected = code === value
        return (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(code)}
            data-testid={`mock-region-${code}`}
            className={`px-2 py-2 rounded-lg border text-center transition-colors ${
              selected
                ? 'border-brand-400 bg-brand-50 text-brand-700'
                : 'border-game-line bg-game-arena text-slate-600 hover:border-brand-300 hover:text-slate-800'
            }`}
          >
            <span className="block text-xs font-bold">{REGIONS[code].label}</span>
            <span className="block text-[10px] font-mono opacity-80">{REGIONS[code].testName}</span>
          </button>
        )
      })}
    </div>
  )
}

function RoleButton({ selected, onClick, children, testId }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      data-testid={testId}
      className={`px-3 py-2.5 rounded-lg border text-left text-xs font-bold transition-colors ${
        selected
          ? 'border-brand-400 bg-brand-50 text-brand-700'
          : 'border-game-line bg-game-arena text-slate-800 hover:border-brand-300 hover:bg-game-panel'
      }`}
    >
      {children}
    </button>
  )
}

function Preview({ choice }) {
  const { apiFetch, API } = useAuth()
  const [state, setState] = useState({ loading: true, data: null })

  // Remounted per choice (keyed by the caller), so it always starts in the loading state.
  useEffect(() => {
    let cancelled = false
    const q = choice.battery === 'all'
      ? `?battery=all&region=${choice.region}`
      : `?battery=${encodeURIComponent(choice.battery)}`
    apiFetch(mockUrl(API, `/preview${q}`))
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) setState({ loading: false, data: d?.data ?? null }) })
      .catch(() => { if (!cancelled) setState({ loading: false, data: null }) })
    return () => { cancelled = true }
  }, [choice.battery, choice.region, apiFetch, API])

  if (state.loading) return <p className="text-xs text-slate-500 py-3">Working out what this involves…</p>
  const p = state.data
  if (!p) return <p className="text-xs text-slate-500 py-3">We could not load the test list. Check your connection.</p>

  const unplayed = p.steps.filter(s => !s.played)
  return (
    <div data-testid="mock-preview">
      <p className="text-sm font-bold text-slate-900 mb-1">
        {p.steps.length} tests, about {formatDuration(p.totalMinutes)}
        {p.breaks > 0 && ` including ${p.breaks} break${p.breaks === 1 ? '' : 's'}`}
      </p>
      <p className="text-[11px] text-slate-600 mb-3">The tests come in a random order, the same way they would on the day.</p>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 mb-3">
        {p.steps.map(s => (
          <li key={s.gameKeys.join('+')} className="flex items-center gap-2 text-xs text-slate-700 min-w-0">
            <span className="truncate">{s.gameKeys.length > 1 ? s.gameKeys.map(gameTitle).join(' + ') : stepName(s.codes)}</span>
            <span className="shrink-0 text-[10px] text-slate-500 font-mono">{formatDuration(s.minutes)}</span>
            {!s.played && <span className="shrink-0 text-[10px] font-bold text-amber-700">Not tried yet</span>}
          </li>
        ))}
      </ul>
      {unplayed.length > 0 && (
        <p className="text-[11px] text-slate-600 mb-2" data-testid="mock-readiness">
          You have not tried {unplayed.length} of these on Hard yet. You can still start: every test shows its
          instructions first, and the ones with a tutorial let you run through it before you begin. Trying them
          first will give you a fairer score.
        </p>
      )}
      {p.unsat.length > 0 && (
        <p className="text-[11px] text-slate-500">
          Not included: {p.unsat.join(', ')}. SkyWatch does not have a game for {p.unsat.length === 1 ? 'this test' : 'these tests'} yet, so the score sheet leaves {p.unsat.length === 1 ? 'it' : 'them'} out.
        </p>
      )}
    </div>
  )
}

function Rules({ agreed, onAgree }) {
  const { breakMinutes, breakAfterMinutes, idleLimitMinutes } = MOCK_CONFIG
  const hours = idleLimitMinutes / 60
  return (
    <div className="border border-game-line rounded-xl p-3 sm:p-4 bg-game-arena" data-testid="mock-rules">
      <p className="text-xs font-bold text-slate-900 mb-2">Before you start</p>
      <ul className="list-disc pl-4 space-y-1.5 text-[12px] text-slate-700 mb-3">
        <li>It is one sitting. You get a {breakMinutes} minute break after about every {breakAfterMinutes} minutes of tests, like the real day.</li>
        <li>
          <strong className="text-slate-900">Keep going within {hours} hours.</strong> If the next test is not started within {hours} hours,
          the assessment closes. Your scores so far are kept, but you would need to start again.
        </li>
        <li>The rest of SkyWatch is closed until you finish or choose to leave. Leaving keeps your scores, but ends the assessment.</li>
        <li>Every test is played on Hard, in the Real CBAT look. You will not see any scores until the end.</li>
        <li>At the end you get a score sheet laid out like the real one, which you can print.</li>
      </ul>
      <label className="flex items-start gap-2 text-[12px] text-slate-800 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={agreed}
          onChange={e => onAgree(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-brand-600"
          data-testid="mock-agree"
        />
        <span>I understand. I have about the time this needs, and I am ready to start.</span>
      </label>
    </div>
  )
}

function ClosedNotice({ closed }) {
  const { apiFetch, API } = useAuth()
  useEffect(() => {
    apiFetch(mockUrl(API, `/${closed.id}/notice-seen`), { method: 'POST' }).catch(() => {})
  }, [closed.id, apiFetch, API])
  return (
    <Card className="mb-5 border-amber-400" data-testid="mock-closed-notice">
      <p className="text-sm font-bold text-slate-900 mb-1">Your last assessment closed</p>
      <p className="text-xs text-slate-700 mb-3">
        It closed at {formatClock(closed.endedAt)} because the next test was not started within {MOCK_CONFIG.idleLimitMinutes / 60} hours.
        The scores from the {closed.testsDone} test{closed.testsDone === 1 ? '' : 's'} you finished are saved.
      </p>
      <Link to={`${MOCK_ROUTE}/${closed.id}`} className="text-xs font-bold text-brand-600 hover:text-brand-700">View its score sheet &rarr;</Link>
    </Card>
  )
}

function historyHeadline(m) {
  if (m.scope === 'role') {
    const r = m.results[0]
    if (!r || r.score == null) return 'Not scored'
    const verdict = r.status === 'pass' ? 'PASS' : r.status === 'fail' ? 'FAIL' : 'not judged'
    return `${r.score}/180, ${verdict}`
  }
  const passed = m.results.filter(r => r.status === 'pass').length
  return `Passed ${passed} of ${m.results.length} roles`
}

const HISTORY_STATUS = { completed: 'Finished', abandoned: 'Left early', expired: 'Closed' }

function History() {
  const { apiFetch, API } = useAuth()
  const [mocks, setMocks] = useState(null)
  useEffect(() => {
    let cancelled = false
    apiFetch(mockUrl(API, '/history'))
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) setMocks(d?.data?.mocks ?? []) })
      .catch(() => { if (!cancelled) setMocks([]) })
    return () => { cancelled = true }
  }, [apiFetch, API])

  if (!mocks?.length) return null
  return (
    <Card className="mt-5" data-testid="mock-history">
      <h2 className="text-sm font-extrabold text-slate-900 mb-1">Your score sheets</h2>
      <p className="text-[11px] text-slate-600 mb-3">Every sitting is kept, so you can print them and compare how you are doing over time.</p>
      <ul className="divide-y divide-[#12293f]">
        {mocks.map(m => (
          <li key={m.id}>
            <Link to={`${MOCK_ROUTE}/${m.id}`} className="flex items-center gap-3 py-2 text-xs hover:bg-game-panel -mx-2 px-2 rounded-lg">
              <span className="w-20 shrink-0 font-mono text-slate-600">
                {new Date(m.startedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </span>
              <span className="flex-1 min-w-0 truncate font-bold text-slate-800">
                {m.scope === 'role' ? m.batteryLabel : `All roles, ${REGIONS[m.region]?.label ?? m.region}`}
              </span>
              <span className="hidden sm:block shrink-0 text-slate-500">{HISTORY_STATUS[m.status]} · {m.testsDone}/{m.testsTotal} tests</span>
              <span className="shrink-0 font-bold text-slate-700">{historyHeadline(m)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function MockStart({ defaults, closed, requested = null }) {
  const { user, apiFetch, API } = useAuth()
  const { settings } = useAppSettings() ?? {}
  const target = BATTERY_BY_KEY[defaults?.targetBattery] ? defaults.targetBattery : null
  // A link can name the role (the Aptitude Report's "Sit a Mock Assessment for X"); otherwise the
  // player's own target role, otherwise every role in their region.
  const initial = BATTERY_BY_KEY[requested] ? requested : target
  const [region, setRegion] = useState(() => (initial ? BATTERY_BY_KEY[initial].region : normaliseRegion(defaults?.detectedRegion)))
  const [battery, setBattery] = useState(initial ?? 'all')
  const [agreed, setAgreed] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState(null)

  const switchedOff = settings?.cbatMockAssessmentEnabled === false && !user?.isAdmin
  const groups = useMemo(() => batteryGroupsFor(region), [region])

  const changeRegion = (code) => {
    setRegion(code)
    // A role belongs to one country; changing country resets to that country's full battery.
    if (battery !== 'all' && BATTERY_BY_KEY[battery]?.region !== code) setBattery('all')
  }

  const start = async () => {
    setStarting(true)
    setError(null)
    try {
      const res = await apiFetch(mockUrl(API, '/start'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(battery === 'all' ? { battery: 'all', region } : { battery }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok && res.status !== 409) throw new Error(body?.message || 'Could not start the assessment.')
      captureEvent('cbat_mock_started', { scope: battery === 'all' ? 'all' : 'role', battery, region })
      setActiveMock(body?.data?.mock ?? null)
    } catch (err) {
      setError(err.message)
    } finally {
      setStarting(false)
    }
  }

  return (
    <div data-testid="mock-start">
      <h1 className="text-2xl font-extrabold text-slate-900 mb-1">Mock Assessment</h1>
      <p className="text-sm text-slate-600 mb-5">
        Sit every test for a role in one go, with breaks, then get a score sheet laid out like the real one.
      </p>

      {closed && <ClosedNotice closed={closed} />}

      {switchedOff ? (
        <Card>
          <p className="text-sm text-slate-700">The Mock Assessment is switched off at the moment. Please check back soon.</p>
        </Card>
      ) : (
        <Card>
          <RegionButtons value={region} onChange={changeRegion} />
          <h2 className="text-base font-extrabold text-slate-900 mb-1">Which role are you sitting it for?</h2>
          <p className="text-[11px] text-slate-600 mb-3">
            Each role is scored on its own set of tests. Not sure yet? Sit every test for {REGIONS[region].label} and see where you stand for every role.
          </p>
          <div className="mb-3">
            <RoleButton selected={battery === 'all'} onClick={() => setBattery('all')} testId="mock-role-all">
              All roles in {REGIONS[region].label}
            </RoleButton>
          </div>
          {groups.map(group => (
            <div key={group.label} className="mb-3 last:mb-0">
              <p className="text-[10px] text-slate-500 uppercase tracking-wide font-bold mb-1.5">{group.label}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {group.batteries.map(b => (
                  <RoleButton key={b.key} selected={battery === b.key} onClick={() => setBattery(b.key)} testId={`mock-role-${b.key}`}>
                    {b.label}{b.key === target ? ' (your role)' : ''}
                  </RoleButton>
                ))}
              </div>
            </div>
          ))}

          <div className="border-t border-[#12293f] mt-4 pt-4 mb-4">
            <Preview key={`${battery}:${region}`} choice={{ battery, region }} />
          </div>

          {isTouchOnly() && (
            <p className="text-[11px] text-slate-600 mb-3">
              Best on a computer: some tests (SMA, RTT and DPT) are easier with a mouse or joystick than a touch screen.
            </p>
          )}

          <Rules agreed={agreed} onAgree={setAgreed} />

          {error && <p className="text-xs text-[#e58b85] mt-3">{error}</p>}
          <button
            type="button"
            onClick={start}
            disabled={!agreed || starting}
            data-testid="mock-start-button"
            className="w-full mt-4 px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {starting ? 'Starting…' : 'Start assessment'}
          </button>
        </Card>
      )}

      <History />
    </div>
  )
}

// ── Runner ───────────────────────────────────────────────────────────────────────────────────

function MockRunner({ mock, onRefresh }) {
  const { apiFetch, API } = useAuth()
  const navigate = useNavigate()
  // Set by the site lock when the player arrived somewhere else (a new tab, the back button).
  const returned = !!useLocation().state?.mockReturned
  const now = useNow(1000)
  const [going, setGoing] = useState(false)

  const ends = breakEndsAt(mock)
  const breakLeftMs = ends ? ends.getTime() - now.getTime() : 0
  const onBreak = !!ends
  const counting = onBreak && breakLeftMs > 0
  const finish = estimatedFinish(mock, now)
  const deadline = useMemo(() => (mock.deadline ? new Date(mock.deadline) : null), [mock.deadline])
  const next = nextGameKey(mock)
  const done = mock.testsDone
  const total = mock.testsTotal
  const partway = currentStep(mock)?.played?.length > 0

  // Past the deadline while the page sat open: ask the server, which closes it.
  useEffect(() => {
    if (deadline && now > deadline) onRefresh()
  }, [deadline, now, onRefresh])

  const go = async ({ tutorial = false } = {}) => {
    if (!next) return
    setGoing(true)
    try {
      const res = await apiFetch(mockUrl(API, `/${mock.id}/begin`), { method: 'POST' })
      const body = await res.json().catch(() => null)
      if (body?.data?.mock) setActiveMock(body.data.mock)
      if (!res.ok) { onRefresh(); return }
      const to = mockGamePath(next, { tutorial })
      grantGamePath(to.split('?')[0])
      navigate(to, { state: { mockGranted: true } })
    } catch {
      setGoing(false)
    }
  }

  const mm = String(Math.floor(Math.max(0, breakLeftMs) / 60000)).padStart(2, '0')
  const ss = String(Math.floor((Math.max(0, breakLeftMs) % 60000) / 1000)).padStart(2, '0')
  const title = mock.scope === 'role' ? mock.batteryLabel : `All roles, ${REGIONS[mock.region]?.label ?? mock.region}`

  return (
    <div className="max-w-xl mx-auto" data-testid="mock-runner">
      {returned && (
        <div className="mb-4 px-3 py-2.5 rounded-xl border border-brand-300 bg-brand-50 text-xs text-slate-800" data-testid="mock-in-progress">
          <strong className="text-slate-900">Your Mock Assessment is still in progress.</strong> The rest of SkyWatch is
          closed until you finish it. Continue below, or use Leave assessment at the bottom if you want to stop.
        </div>
      )}
      <p className="text-[11px] uppercase tracking-wide text-slate-500 font-bold mb-1">Mock Assessment · {title}</p>
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 h-2 bg-game-arena border border-game-line rounded-sm overflow-hidden">
          <div className="h-full bg-brand-600" style={{ width: `${(done / Math.max(1, total)) * 100}%` }} />
        </div>
        <span className="text-xs font-mono text-slate-600 shrink-0">{done} of {total} done</span>
      </div>

      <Card className="text-center">
        {onBreak ? (
          <div data-testid="mock-break">
            <h1 className="text-xl font-extrabold text-slate-900 mb-1">Break</h1>
            {counting ? (
              <>
                <p className="text-sm text-slate-600 mb-3">Take a few minutes away from the screen. The next test is ready when you are.</p>
                <p className="font-mono text-5xl font-extrabold text-slate-900 mb-2 tabular-nums" data-testid="mock-break-countdown">{mm}:{ss}</p>
              </>
            ) : (
              <p className="text-sm text-slate-600 mb-4">Your break is over. Continue when you are ready.</p>
            )}
            <p className="text-sm text-slate-700 mb-4">Estimated finish: <strong className="text-slate-900" data-testid="mock-finish">{formatClock(finish)}</strong></p>
            {counting ? (
              <button type="button" onClick={() => go()} disabled={going} data-testid="mock-continue"
                className="text-xs font-bold text-brand-600 hover:text-brand-700 underline underline-offset-2 disabled:opacity-50">
                Continue assessment now
              </button>
            ) : (
              <button type="button" onClick={() => go()} disabled={going} data-testid="mock-continue"
                className="w-full px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors disabled:opacity-50">
                Continue assessment
              </button>
            )}
            <p className="text-[11px] text-slate-500 mt-3">Next: {nextTestName(mock)}</p>
          </div>
        ) : (
          <div data-testid="mock-next">
            <p className="text-xs text-slate-500 font-bold mb-1">Test {Math.min(done + 1, total)} of {total}</p>
            <h1 className="text-xl font-extrabold text-slate-900 mb-1">{nextTestName(mock)}</h1>
            <p className="text-xs text-slate-600 mb-4">
              About {formatDuration(currentStep(mock)?.minutes ?? 0)}
              {partway ? '. Second part of this test.' : '. Read the instructions on the next screen, then press Start.'}
            </p>
            <button type="button" onClick={() => go()} disabled={going} data-testid="mock-continue"
              className="w-full px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors disabled:opacity-50">
              {done === 0 && !partway ? 'Start the first test' : 'Continue assessment'}
            </button>
            {next && hasTutorial(next) && !partway && (
              <button type="button" onClick={() => go({ tutorial: true })} disabled={going} data-testid="mock-tutorial-first"
                className="w-full mt-2 px-6 py-2.5 border border-game-line text-slate-700 hover:text-slate-900 font-bold rounded-xl text-sm transition-colors disabled:opacity-50">
                Tutorial first
              </button>
            )}
            <p className="text-sm text-slate-700 mt-4">Estimated finish: <strong className="text-slate-900" data-testid="mock-finish">{formatClock(finish)}</strong></p>
          </div>
        )}
      </Card>

      {deadline && (
        <p className="text-[11px] text-slate-600 text-center mt-3" data-testid="mock-deadline">
          Continue by <strong className="text-slate-800">{formatClock(deadline)}</strong> or this assessment will close. Your scores so far are kept.
        </p>
      )}

      <div className="text-center mt-6">
        <button type="button" onClick={() => requestLeaveMock('/cbat')} data-testid="mock-leave"
          className="text-[11px] text-slate-500 hover:text-slate-700 underline underline-offset-2">
          Leave assessment
        </button>
      </div>
    </div>
  )
}

// ── /cbat/mock ───────────────────────────────────────────────────────────────────────────────

export default function CbatMock() {
  const { user, apiFetch, API } = useAuth()
  const mock = useActiveMock()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const after = searchParams.get('after')
  const [state, setState] = useState({ loading: true, data: null, failed: false })

  const refresh = useCallback(() => {
    return refreshActiveMock({ apiFetch, API })
      .then(data => setState({ loading: false, data, failed: false }))
      .catch(() => setState(s => ({ ...s, loading: false, failed: true })))
  }, [apiFetch, API])

  useEffect(() => { refresh() }, [refresh])

  // Back from the last test: the mock has completed, so show its sheet.
  useEffect(() => {
    if (state.loading || mock || !after) return
    captureEvent('cbat_mock_finished', {})
    navigate(`${MOCK_ROUTE}/${after}`, { replace: true })
  }, [state.loading, mock, after, navigate])

  return (
    <div className="pb-8">
      <SEO title="Mock Assessment" description="Sit every CBAT-style test for a role in one go." noIndex />
      {state.loading && !mock && <p className="text-sm text-slate-500 py-10 text-center">Loading…</p>}
      {state.failed && !mock && (
        <Card><p className="text-sm text-slate-700">We could not reach SkyWatch. Check your connection and try again.</p></Card>
      )}
      {mock && <MockRunner mock={mock} onRefresh={refresh} />}
      {!mock && !state.loading && !state.failed && !after && (
        <MockStart defaults={state.data} closed={state.data?.closed ?? null} requested={searchParams.get('battery')} />
      )}
      {user?.isAdmin && (
        <AdminToolPanel title="Mock Assessment" wide>
          <CbatMockAdminStats />
        </AdminToolPanel>
      )}
    </div>
  )
}

// ── /cbat/mock/:id ───────────────────────────────────────────────────────────────────────────

// Also the admin tools' simulated pass / fail pages (id SIMULATED_MOCK_ID): the sheet comes from
// the simulate endpoint instead of a saved mock; everything else on the page is what a player sees.
export function CbatMockSheetPage() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const { user, apiFetch, API } = useAuth()
  const navigate = useNavigate()
  useGameBodyClass('cbat-mock-sheet')

  const simulated = id === SIMULATED_MOCK_ID
  const result = searchParams.get('result') === 'fail' ? 'fail' : 'pass'
  // Changed by every press of the admin tools' simulate buttons, so pressing again draws a fresh sheet.
  const draw = searchParams.get('draw')

  // Loading is "the answer held is for a different request", so a fresh draw shows Loading…
  // without resetting state inside the effect.
  const request = `${id}|${result}|${draw}`
  const [answer, setAnswer] = useState({ request: null, mock: null, failed: false })
  const state = answer.request === request ? { loading: false, ...answer } : { loading: true, mock: null, failed: false }

  useEffect(() => {
    let cancelled = false
    apiFetch(mockUrl(API, simulated ? `/admin/simulate?result=${result}` : `/${id}`))
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(d => {
        if (cancelled) return
        const mock = d?.data?.mock
        if (mock?.status === 'active') { navigate(MOCK_ROUTE, { replace: true }); return }
        setAnswer({ request, mock, failed: false })
      })
      .catch(() => { if (!cancelled) setAnswer({ request, mock: null, failed: true }) })
    return () => { cancelled = true }
  }, [request, id, simulated, result, apiFetch, API, navigate])

  return (
    <div className="pb-8">
      <SEO title="Mock Assessment score sheet" description="Your Mock Assessment score sheet." noIndex />
      <div className="flex items-center justify-between gap-3 mb-4 mock-sheet-chrome">
        <Link to={MOCK_ROUTE} className="text-xs font-bold text-brand-600 hover:text-brand-700">&larr; Mock Assessment</Link>
        {state.mock && (
          <button
            type="button"
            onClick={() => { if (!simulated) captureEvent('cbat_mock_printed', {}); window.print() }}
            data-testid="mock-print"
            className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg text-xs transition-colors"
          >
            Print score sheet
          </button>
        )}
      </div>
      {state.loading && <p className="text-sm text-slate-500 py-10 text-center">Loading…</p>}
      {state.failed && <Card><p className="text-sm text-slate-700">We could not find that score sheet.</p></Card>}
      {state.mock && (
        <>
          <CbatMockScoreSheet mock={state.mock} agentNumber={user?.agentNumber} />
          <CbatMockPractiseNext sheet={state.mock.sheet} />
        </>
      )}
      {simulated && user?.isAdmin && (
        <AdminToolPanel title="Mock Assessment">
          <MockSimulatedNote mock={state.mock} result={result} />
          <MockSimulateButtons />
        </AdminToolPanel>
      )}
    </div>
  )
}
