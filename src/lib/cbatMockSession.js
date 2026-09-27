// The Mock Assessment the signed-in player is sitting right now, held outside React so the parts
// of the app that are not components can read it too: the score outbox stamps `mockId` on a run,
// the theme hooks force Real CBAT, the mode row locks itself, and the site lock decides which
// routes are open.
//
// The server is the source of truth (GET /api/cbat-mock/current). This is only its last answer,
// refreshed on sign-in, on the runner page and after a run is claimed. It is null whenever no mock
// is active.

import { useSyncExternalStore } from 'react'
import mockConfig from '../../backend/constants/cbatMockAssessment.json'
import batteryData from '../../backend/constants/cbatBatteries.json'
import { gamePath } from '../data/cbatBatteries'

export const MOCK_CONFIG = mockConfig
export const MOCK_HTML_ATTR = 'data-cbat-mock'
export const MOCK_ROUTE = '/cbat/mock'

let active = null
const listeners = new Set()

function emit() {
  for (const cb of listeners) {
    try { cb() } catch { /* ignore */ }
  }
}

// Mark <html> while a mock is running. main.css hides the leaderboard links, the mode rows and the
// in-game Tutorial buttons under this attribute, so no game page has to know about the mock to
// look right in one.
function stampHtml() {
  if (typeof document === 'undefined') return
  if (active) document.documentElement.setAttribute(MOCK_HTML_ATTR, '')
  else document.documentElement.removeAttribute(MOCK_HTML_ATTR)
}

// ── Remembered across tabs ───────────────────────────────────────────────────────────────────
// The last answer is also kept in localStorage, for two reasons. A NEW tab opened mid-mock can
// lock from its first frame instead of waiting on the server (a tab that waited let a player
// click into another game before the answer landed). And every OTHER open tab hears about a mock
// starting or ending through the `storage` event, so tabs never disagree.
//
// Keyed to the account it belongs to, so a shared browser never locks the next person out. The
// account comes from the mock itself (the server stamps userId on it), not from anything this
// module has to be told first: an earlier version kept the owner in module state, and when that
// state was lost the mock was never written down, so a duplicated tab had to wait on the server.
export const MOCK_STORAGE_KEY = 'sw_cbat_mock_active'

function persist() {
  try {
    if (active?.userId) localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify({ userId: active.userId, mock: active }))
    else localStorage.removeItem(MOCK_STORAGE_KEY)
  } catch { /* storage unavailable: the server fetch still covers it */ }
}

// The remembered mock for this account, or null.
export function readRememberedMock(userId) {
  try {
    const saved = JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY))
    return saved && userId && saved.userId === userId && saved.mock?.status === 'active' ? saved.mock : null
  } catch {
    return null
  }
}

export function setActiveMock(mock, { remember = true } = {}) {
  const next = mock && mock.status === 'active' ? mock : null
  if (next === active) return
  active = next
  stampHtml()
  if (remember) persist()
  emit()
}

export function getActiveMock() {
  return active
}

export function subscribeActiveMock(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useActiveMock() {
  return useSyncExternalStore(subscribeActiveMock, getActiveMock, () => null)
}

// The step the mock is waiting on, and the game within it still to play (Visualisation's step has
// two). Null once every step is done.
export function currentStep(mock) {
  if (!mock) return null
  return mock.steps[mock.currentStep] ?? null
}

export function nextGameKey(mock) {
  const step = currentStep(mock)
  if (!step) return null
  return step.gameKeys.find(g => !step.played.includes(g)) ?? null
}

// The mockId a finished run should carry: only when that run is the one the mock is waiting on.
// A run of anything else is posted as an ordinary run.
export function mockIdFor(gameKey) {
  const step = currentStep(active)
  return step && step.gameKeys.includes(gameKey) ? active.id : null
}

// Where each board is played. Most follow the Aptitude Report's own link (which already carries
// ?difficulty=hard for a split game); the multi-mode pages also need ?mode= to open on the right
// board, since the mode row is hidden during a mock.
const MODE_LINKS = {
  'trace-1':          '/cbat/trace?mode=trace1',
  'trace-2':          '/cbat/trace?mode=trace2',
  'visualisation-2d': '/cbat/visualisation?mode=2d',
  'visualisation-3d': '/cbat/visualisation?mode=3d',
  instruments:        '/cbat/instruments?mode=reading',
}

export function mockGamePath(gameKey, { tutorial = false } = {}) {
  const base = MODE_LINKS[gameKey] ?? gamePath(gameKey)
  if (!tutorial) return base
  return `${base}${base.includes('?') ? '&' : '?'}tutorial=1`
}

// The pathname a board is played on, for the site lock's allowlist.
export function mockGamePathname(gameKey) {
  return mockGamePath(gameKey).split('?')[0]
}

// Games whose page has a Tutorial the between-tests screen can offer (CBAT_TUTORIAL_GAME_KEYS on
// the backend, in their Hard form).
const TUTORIAL_GAMES = new Set(['target', 'ant-hard', 'flag', 'sat', 'cut', 'dpt-hard'])
export function hasTutorial(gameKey) {
  return TUTORIAL_GAMES.has(gameKey)
}

// ── Time ─────────────────────────────────────────────────────────────────────────────────────

const MIN = 60 * 1000

// When the current break's countdown ends, or null when not on a break.
export function breakEndsAt(mock) {
  if (!mock?.breakStartedAt) return null
  return new Date(new Date(mock.breakStartedAt).getTime() + MOCK_CONFIG.breakMinutes * MIN)
}

// The estimated finish: every test still to sit, every break still to come, and whatever is left
// of the break the player is on now.
export function estimatedFinish(mock, now = new Date()) {
  if (!mock) return null
  const remainingTests = mock.steps.slice(mock.currentStep).reduce((a, s) => a + (s.minutes ?? 0), 0)
  const breaksToCome = mock.breakAfter.filter(i => i >= mock.currentStep && i < mock.steps.length - 1).length
  const ends = breakEndsAt(mock)
  const breakLeft = ends ? Math.max(0, ends.getTime() - now.getTime()) : 0
  return new Date(now.getTime() + breakLeft + (remainingTests + breaksToCome * MOCK_CONFIG.breakMinutes) * MIN)
}

export function formatClock(date) {
  if (!date) return ''
  return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// "1 hr 5 min", "45 min".
export function formatDuration(minutes) {
  const m = Math.max(0, Math.round(minutes))
  const h = Math.floor(m / 60)
  const r = m % 60
  if (!h) return `${r} min`
  return r ? `${h} hr ${r} min` : `${h} hr`
}

// ── Server ───────────────────────────────────────────────────────────────────────────────────

export const mockUrl = (API, path = '') => `${API}/api/cbat-mock${path}`

// Ask the server for the active mock and store it. Returns the whole payload so the runner page
// can read `closed` and the start-page defaults from the same request.
export async function refreshActiveMock({ apiFetch, API }) {
  const res = await apiFetch(mockUrl(API, '/current'))
  if (!res.ok) throw new Error(`mock current ${res.status}`)
  const body = await res.json()
  setActiveMock(body.data?.mock ?? null)
  return body.data
}

// ── Leaving ──────────────────────────────────────────────────────────────────────────────────
// A "Leave assessment" button anywhere asks through the one dialog the site lock owns
// (components/cbat/CbatMockLock.jsx), so leaving always reads and behaves the same.
const leaveListeners = new Set()

export function requestLeaveMock(to = null) {
  for (const cb of leaveListeners) {
    try { cb(to) } catch { /* ignore */ }
  }
}

export function onLeaveRequest(cb) {
  leaveListeners.add(cb)
  return () => leaveListeners.delete(cb)
}

// ── Size of a role's mock, for the /cbat card ────────────────────────────────────────────────
// How many tests a role's mock holds and roughly how long it takes, worked out here from the same
// two JSON files the server plans from, so the card can say "9 tests, about 45 min" without a
// request. The server (backend/utils/cbatMockPlan.js) stays the authority on the real plan; this
// mirrors its rules: codes with no game drop out, codes sharing a game are sat once, and the
// breaks are counted in order (the real plan is shuffled, so the break count can differ by one).
function batteryCodes(key) {
  const uk = batteryData.batteries.find(b => b.key === key)
  if (uk) return uk.domains.flatMap(d => d.tests.map(t => t.code))
  const spec = batteryData.derivedBatteries.find(b => b.key === key)
  const base = spec && batteryData.batteries.find(b => b.key === spec.basedOn)
  if (!base) return []
  const drop = new Set(spec.drop ?? [])
  return base.domains.flatMap(d => d.tests.map(t => spec.swap?.[t.code] ?? t.code)).filter(c => !drop.has(c))
}

export function mockSummary(batteryKey) {
  const sets = new Map()
  for (const code of batteryCodes(batteryKey)) {
    const games = batteryData.tests[code]?.games ?? []
    if (games.length) sets.set(games.join('+'), games)
  }
  const steps = [...sets.values()].map(games => games.reduce((a, g) => a + (MOCK_CONFIG.minutes[g] ?? 0), 0))
  if (!steps.length) return null
  let since = 0
  let breaks = 0
  steps.forEach((m, i) => {
    since += m
    if (since >= MOCK_CONFIG.breakAfterMinutes && i < steps.length - 1) { breaks += 1; since = 0 }
  })
  return { tests: steps.length, minutes: steps.reduce((a, m) => a + m, 0) + breaks * MOCK_CONFIG.breakMinutes }
}

// ── Which tab is sitting the test ────────────────────────────────────────────────────────────
// The test the mock is waiting on is open only to the tab that pressed Continue (or Tutorial
// first) on the assessment screen. Any other tab reaching that page (a duplicated tab, a
// middle-click, a restored session) is sent to the assessment screen instead; otherwise a second
// tab could sit the test, or replay it, without ever passing through the assessment.
//
// Held per tab in memory, and also written into the history entry (`mockGranted`) so a refresh of
// the granted tab keeps its place.
let grantedPath = null

export function grantGamePath(pathname) {
  grantedPath = pathname
}

export function isGrantedGamePath(pathname, locationState) {
  if (locationState?.mockGranted) grantedPath = pathname
  return grantedPath === pathname
}

export function clearGrantedGamePath() {
  grantedPath = null
}
