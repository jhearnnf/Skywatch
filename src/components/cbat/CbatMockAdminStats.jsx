/**
 * CbatMockAdminStats — admin-only usage stats for the Mock Assessment, shown in
 * the /cbat/mock page's floating Admin tools window, so laid out for its ~20rem
 * width and split into folding AdminToolSections.
 *
 * Answers "is anyone sitting the mock, do they finish it, and how do they do?"
 * from one call to GET /api/cbat-mock/admin/stats. Admins are left out of every
 * number server-side. Arrivals on the page are PostHog's job, not this panel's.
 *
 * The Started, Completed and Pass rate tiles each open a list of the players
 * behind the number, laid out like the chat's Seen by dialog. A player opens
 * their full results (score sheet + what to practise next) in the same window.
 */

import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MOCK_ROUTE, SIMULATED_MOCK_ID } from '../../lib/cbatMockSession'
import { REGIONS } from '../../data/cbatBatteries'
import { useAuth } from '../../context/AuthContext'
import { AdminToolSection } from '../AdminToolPanel'
import Overlay from '../ui/Overlay'
import CbatMockScoreSheet from './CbatMockScoreSheet'
import CbatMockPractiseNext from './CbatMockPractiseNext'

const BAR = '#5baaff'
const pct = (n) => (n == null ? '–' : `${Math.round(n * 100)}%`)
const num = (n) => (n == null ? '–' : Math.round(n).toLocaleString('en'))
const share = (part, whole) => (whole ? part / whole : null)
const shortDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const agentLabel = (p) => p.displayName || (p.agentNumber ? `Agent #${p.agentNumber}` : 'Unknown agent')

// A tile that opens the list of players behind its number.
function Tile({ label, value, sub, testId, onOpen, className = '' }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={testId}
      className={`text-left rounded-sm border border-slate-300/20 bg-surface-raised px-3 py-2.5 flex flex-col gap-0.5 hover:border-brand-600/50 transition-colors ${className}`}
    >
      <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-text-muted">{label}</span>
      <span className="text-xl font-black text-text tabular-nums leading-tight">{value}</span>
      {sub && <span className="text-[11px] text-text-muted leading-snug">{sub}</span>}
      <span className="text-[10px] font-semibold text-brand-600 mt-0.5">See players</span>
    </button>
  )
}

function BarRow({ label, fraction, right }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr_4.5rem] items-center gap-2 text-[11px]">
      <span className="text-text-muted truncate" title={label}>{label}</span>
      <div className="h-2.5 rounded-sm bg-slate-500/15 overflow-hidden">
        <div className="h-full rounded-r-[4px]" style={{ width: `${Math.max(0, Math.min(1, fraction ?? 0)) * 100}%`, background: BAR }} />
      </div>
      <span className="text-text tabular-nums text-right">{right}</span>
    </div>
  )
}

const LAST_STATUS = { active: 'in progress', abandoned: 'left early', expired: 'closed after 2h idle' }
const VERDICT = { pass: 'pass', fail: 'fail', none: 'no verdict' }

// Which players each tile lists. The server sends them most recently started first.
const LISTS = {
  started:   { title: 'Started a mock',  empty: 'Nobody has started a mock yet.',      pick: () => true },
  completed: { title: 'Finished a mock', empty: 'Nobody has finished a mock yet.',     pick: p => p.completed > 0 },
  passrate:  { title: 'Pass and fail',   empty: 'No finished mock has a verdict yet.', pick: p => p.pass + p.fail > 0 },
}

function PeopleList({ rows, empty, onPick }) {
  if (rows.length === 0) return <p className="text-sm text-slate-400 py-4 text-center">{empty}</p>
  return (
    <ul className="divide-y divide-slate-200">
      {rows.map(p => (
        <li key={p.userId}>
          <button
            type="button"
            onClick={() => onPick(p)}
            data-testid="mock-people-row"
            className="w-full text-left py-2 flex flex-col gap-0.5 hover:bg-slate-100/60 transition-colors"
          >
            <span className="flex items-baseline gap-2 w-full">
              <span className="text-sm text-slate-700 truncate">{agentLabel(p)}</span>
              {p.pass + p.fail > 0 && (
                <span className="text-[11px] text-slate-700 font-bold tabular-nums shrink-0 ml-auto">
                  {pct(p.passRate)} pass
                </span>
              )}
            </span>
            <span className="text-[11px] text-slate-400">
              {p.started} started · {p.completed} finished
              {p.completed > 0 && ` · ${p.pass} passed · ${p.fail} failed`}
              {p.none > 0 && ` · ${p.none} no verdict`}
            </span>
            {p.last && (
              <span className="text-[11px] text-slate-400 truncate">
                Latest: {p.last.label}, {p.last.verdict ? VERDICT[p.last.verdict] : LAST_STATUS[p.last.status]}
                {p.last.score != null && ` (${num(p.last.score)}, cutoff ${num(p.last.cutoff)})`}
                {p.lastStartedAt && `, ${shortDate(p.lastStartedAt)}`}
              </span>
            )}
            {p.last?.underMinimum?.length > 0 && (
              <span className="text-[11px] text-red-600" data-testid="mock-people-minimum">
                Under the minimum: {p.last.underMinimum.map(d => `${d.label} ${d.stanine} (needs ${d.minStanine})`).join(', ')}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}

const SHEET_STATUS = { pass: 'Pass', fail: 'Fail', provisional: 'Provisional', unscored: 'Unscored' }

// A mock's headline for the switcher: its role (or "All roles") and its verdict.
function mockHeadline(m) {
  const title = m.scope === 'role' ? m.batteryLabel : `All roles (${m.region})`
  if (!m.sheet) return `${title}, ${LAST_STATUS[m.status] ?? m.status}`
  if (m.scope !== 'role') {
    const passed = m.sheet.batteries.filter(b => b.status === 'pass').length
    return `${title}, ${passed} of ${m.sheet.batteries.length} passed`
  }
  return `${title}, ${SHEET_STATUS[m.sheet.batteries[0]?.status] ?? '-'}`
}

// One player's results, as they see them: the full score sheet and the "What to practise next"
// card, for the mock picked in the switcher (the latest by default).
function PlayerMocks({ player }) {
  const { apiFetch, API } = useAuth()
  const [state, setState] = useState({ loading: true, data: null, error: null })
  const [pickedId, setPickedId] = useState(null)

  useEffect(() => {
    let cancelled = false
    apiFetch(`${API}/api/cbat-mock/admin/users/${player.userId}`)
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(d => { if (!cancelled) setState({ loading: false, data: d?.data ?? null, error: null }) })
      .catch(() => { if (!cancelled) setState({ loading: false, data: null, error: 'Could not load this player’s mocks.' }) })
    return () => { cancelled = true }
  }, [apiFetch, API, player.userId])

  if (state.loading) return <p className="text-sm text-slate-400 py-4 text-center">Loading…</p>
  if (state.error) return <p className="text-sm text-red-600 py-4 text-center">{state.error}</p>
  const mocks = state.data?.mocks ?? []
  if (!mocks.length) return <p className="text-sm text-slate-400 py-4 text-center">No mocks yet.</p>

  // Newest first from the server. Open on the latest one with a sheet, else the latest.
  const picked = mocks.find(m => m.id === pickedId) ?? mocks.find(m => m.sheet) ?? mocks[0]

  return (
    <div className="py-3 flex flex-col gap-3" data-testid="mock-player-results">
      {mocks.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Mocks sat">
          {mocks.map(m => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={m.id === picked.id}
              onClick={() => setPickedId(m.id)}
              data-testid="mock-player-mock"
              className={`text-left px-2.5 py-1.5 rounded-lg border text-[11px] transition-colors ${
                m.id === picked.id
                  ? 'border-brand-600 bg-brand-600/10 text-slate-800'
                  : 'border-slate-200 text-slate-500 hover:border-brand-600/50'
              }`}
            >
              <span className="block font-semibold">{mockHeadline(m)}</span>
              <span className="block text-[10px] text-slate-400">{shortDate(m.startedAt)} · {m.testsDone} of {m.testsTotal} tests</span>
            </button>
          ))}
        </div>
      )}

      {picked.sheet ? (
        <div data-testid="mock-people-sheet">
          <CbatMockScoreSheet mock={picked} agentNumber={player.agentNumber} />
          <CbatMockPractiseNext sheet={picked.sheet} />
        </div>
      ) : (
        <p className="text-sm text-slate-500 py-4 text-center" data-testid="mock-player-no-sheet">
          {mockHeadline(picked)}: {picked.testsDone} of {picked.testsTotal} tests sat. The score sheet appears once it ends.
        </p>
      )}
    </div>
  )
}

// The players behind a tile. A player opens their full results in this same window; Back returns
// to the list.
function PeopleDialog({ list, people, onClose }) {
  const { title, empty, pick } = LISTS[list]
  const rows = people.filter(pick)
  const [player, setPlayer] = useState(null)

  return (
    <Overlay onDismiss={onClose} className="flex items-center justify-center px-4">
      {/* A player's view is as wide as the sheet page (body.cbat-mock-sheet in main.css): the
          sheet table has a 720px floor and scrolls sideways in anything narrower. */}
      <div
        data-testid="mock-people-dialog"
        className={`w-full ${player ? 'max-w-[1040px]' : 'max-w-sm'} bg-surface rounded-2xl border border-slate-200 card-shadow overflow-hidden`}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200">
          {player && (
            <button type="button" onClick={() => setPlayer(null)} data-testid="mock-people-back"
              className="text-xs font-bold text-brand-600 hover:text-brand-700 shrink-0">
              &larr; Back
            </button>
          )}
          <p className="text-sm font-semibold text-slate-700 truncate">{player ? agentLabel(player) : title}</p>
          {player ? (
            <Link to={`/agent/${player.userId}`} onClick={onClose}
              className="text-[11px] font-semibold text-brand-600 hover:text-brand-700 ml-auto shrink-0">
              Agent profile
            </Link>
          ) : (
            <p className="text-[10px] text-slate-400 ml-auto shrink-0" data-testid="mock-people-count">
              {rows.length} {rows.length === 1 ? 'agent' : 'agents'}
            </p>
          )}
        </div>

        <div className={`${player ? 'max-h-[75vh]' : 'max-h-80'} overflow-y-auto px-4 pb-2`}>
          {player
            ? <PlayerMocks player={player} />
            : <PeopleList rows={rows} empty={empty} onPick={setPlayer} />}
        </div>

        <div className="px-4 py-3 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="w-full px-4 py-2 text-slate-600 hover:text-slate-700 border border-slate-200 hover:bg-slate-100 font-bold rounded-xl text-sm transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </Overlay>
  )
}

// Opens the end-of-mock score sheet page on a made-up finished mock that passed or failed (random
// region, role and scores, scored by the real sheet). `draw` changes every press, so pressing again
// on the simulated page itself draws a fresh one.
export function MockSimulateButtons() {
  const navigate = useNavigate()
  const open = (result) => navigate(`${MOCK_ROUTE}/${SIMULATED_MOCK_ID}?result=${result}&draw=${Date.now()}`)
  return (
    <div className="grid grid-cols-2 gap-1.5">
      <button type="button" onClick={() => open('pass')} data-testid="mock-simulate-pass"
        className="text-[11px] font-semibold px-2.5 py-1.5 rounded-sm border border-brand-600/40 text-brand-600 hover:bg-brand-600/10">
        Simulated pass page
      </button>
      <button type="button" onClick={() => open('fail')} data-testid="mock-simulate-fail"
        className="text-[11px] font-semibold px-2.5 py-1.5 rounded-sm border border-brand-600/40 text-brand-600 hover:bg-brand-600/10">
        Simulated fail page
      </button>
    </div>
  )
}

// What the simulated page is showing, so it is never mistaken for a real player's sheet.
export function MockSimulatedNote({ mock, result }) {
  const region = mock ? (REGIONS[mock.region]?.label ?? mock.region) : null
  return (
    <p className="text-[11px] text-text-muted mb-2" data-testid="mock-simulated-note">
      Simulated {result}{mock ? `: ${mock.batteryLabel}, ${region}` : ''}. Random scores, nothing saved.
      Press again for another.
    </p>
  )
}

export default function CbatMockAdminStats() {
  const { apiFetch, API } = useAuth()
  const [data, setData]       = useState(null)
  const [error, setError]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [list, setList]       = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await apiFetch(`${API}/api/cbat-mock/admin/stats`)
      if (!r.ok) throw new Error(String(r.status))
      const d = await r.json()
      setData(d?.data ?? null)
    } catch {
      setError('Could not load the stats.')
    } finally {
      setLoading(false)
    }
  }, [apiFetch, API])

  useEffect(() => { load() }, [load])

  const funnel = data && [
    { label: 'Started one', value: data.started.people },
    { label: 'Finished one', value: data.completed.people },
  ]

  return (
    <div data-testid="mock-admin-stats" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-text-muted">
          {data?.generatedAt
            ? `as of ${new Date(data.generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}, admins left out`
            : 'Mock Assessment usage'}
        </span>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          data-testid="mock-stats-refresh"
          className="text-[11px] font-semibold px-2.5 py-1 rounded-sm border border-brand-600/40 text-brand-600 hover:bg-brand-600/10 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {!data && loading && <p className="text-xs text-text-muted">Loading…</p>}

      {data && (
        <>
          <AdminToolSection title="Usage">
            <div className="grid grid-cols-2 gap-1.5">
              <Tile testId="mock-stat-started" label="Started" value={num(data.started.people)} onOpen={() => setList('started')}
                sub={`${num(data.started.mocks)} mocks · ${num(data.started.last7d)} people in 7 days`} />
              <Tile testId="mock-stat-completed" label="Completed" value={num(data.completed.people)} onOpen={() => setList('completed')}
                sub={`${num(data.completed.mocks)} mocks · ${pct(share(data.completed.mocks, data.started.mocks))} of those started`} />
              <Tile testId="mock-stat-passrate" label="Pass rate" value={pct(data.verdicts.passRate)} onOpen={() => setList('passrate')}
                className="col-span-2"
                sub={`${num(data.verdicts.pass)} passed · ${num(data.verdicts.fail)} failed${data.verdicts.none ? ` · ${num(data.verdicts.none)} no verdict` : ''}`} />
            </div>
            <p className="mt-2 text-[11px] text-text-muted">
              Pass rate counts finished mocks only. An all-roles mock is a pass if it cleared at least one role.
            </p>
          </AdminToolSection>

          <AdminToolSection title="People at each step">
            <div className="flex flex-col gap-1" data-testid="mock-stats-funnel">
              {funnel.map(f => (
                <BarRow key={f.label} label={f.label} fraction={share(f.value, data.started.people)}
                  right={`${num(f.value)} · ${pct(share(f.value, data.started.people))}`} />
              ))}
            </div>
            <p className="mt-2 text-[11px] text-text-muted">
              Mocks not finished: {num(data.byStatus.abandoned)} left, {num(data.byStatus.expired)} closed after 2h idle, {num(data.byStatus.active)} in progress now.
            </p>
          </AdminToolSection>

          <AdminToolSection title="Preview the end page">
            <p className="text-[11px] text-text-muted mb-2">
              The score sheet a player lands on after their last test, with a random role, region and scores.
            </p>
            <MockSimulateButtons />
          </AdminToolSection>

          <AdminToolSection title="Pass and fail by role" defaultOpen={false}>
            {data.roles.length === 0 ? (
              <p className="text-xs text-text-muted">Nobody has finished a mock yet.</p>
            ) : (
              <table className="w-full text-[12px]" data-testid="mock-stats-roles">
                <thead>
                  <tr className="font-mono text-[9px] uppercase tracking-widest text-text-muted text-left">
                    <th className="py-1 pr-2 font-normal">Role</th>
                    <th className="py-1 pr-2 font-normal text-right">Sat</th>
                    <th className="py-1 pr-2 font-normal text-right">Pass</th>
                    <th className="py-1 font-normal text-right">Fail</th>
                  </tr>
                </thead>
                <tbody>
                  {data.roles.map(r => (
                    <tr key={r.key} className="border-t border-slate-300/10">
                      <td className="py-1.5 pr-2 text-text truncate max-w-[9rem]" title={r.label}>
                        {r.label} <span className="text-[10px] text-text-muted">{r.region}</span>
                      </td>
                      <td className="py-1.5 pr-2 text-text-muted tabular-nums text-right">{num(r.sat)}</td>
                      <td className="py-1.5 pr-2 text-text font-bold tabular-nums text-right">{num(r.pass)}</td>
                      <td className="py-1.5 text-text tabular-nums text-right">{num(r.fail)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-2 text-[11px] text-text-muted">
              An all-roles mock counts once for every role on its sheet. A sat role that is neither a pass nor a fail was provisional.
            </p>
          </AdminToolSection>
        </>
      )}

      {list && data && <PeopleDialog list={list} people={data.people ?? []} onClose={() => setList(null)} />}
    </div>
  )
}
