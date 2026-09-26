/**
 * CaseFilesAdminStats — admin-only usage stats, shown in the Case Files page's
 * floating Admin tools window, so laid out for its ~20rem width and split into
 * folding AdminToolSections.
 *
 * Answers "is anyone playing this, and how far do they get?" from one call to
 * GET /api/admin/case-files/stats: headline tiles, 14 days of activity, a
 * per-chapter drop-off funnel and stage scores, the top runs, and interest in
 * the next chapter. Every chart is a single series in the brand blue, so it
 * needs no legend; values sit in text colours, never the bar colour.
 */

import { useCallback, useEffect, useState } from 'react'
import { authFetch } from '../../utils/authFetch'
import { stageTypeLabel } from '../../utils/caseFiles/scoringDisplay'
import { AdminToolSection } from '../AdminToolPanel'

const BAR = '#5baaff'
const pct = (n) => (n == null ? '–' : `${Math.round(n * 100)}%`)
const num = (n) => (n == null ? '–' : Math.round(n).toLocaleString('en'))
const mins = (n) => (n == null ? '–' : n < 1 ? '<1 min' : `${Math.round(n)} min`)
const shortDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

function Tile({ label, value, sub, testId }) {
  return (
    <div data-testid={testId} className="rounded-sm border border-slate-300/20 bg-surface-raised px-3 py-2.5 flex flex-col gap-0.5">
      <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-text-muted">{label}</span>
      <span className="text-xl font-black text-text tabular-nums leading-tight">{value}</span>
      {sub && <span className="text-[11px] text-text-muted leading-snug">{sub}</span>}
    </div>
  )
}

// ── Daily activity: runs started per day, hover for the detail ──────────────
function ActivityChart({ daily }) {
  const [hover, setHover] = useState(null)
  const max = Math.max(1, ...daily.map((d) => d.starts))
  const h = 96
  const active = hover != null ? daily[hover] : null

  return (
    <div className="relative" data-testid="cf-stats-activity">
      <div className="flex items-end gap-[2px] border-b border-slate-300/20" style={{ height: h }} onMouseLeave={() => setHover(null)}>
        {daily.map((d, i) => (
          <div
            key={d.date}
            className="relative flex-1 h-full flex items-end cursor-default"
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            tabIndex={0}
            aria-label={`${shortDate(d.date)}: ${d.starts} started, ${d.completions} finished, ${d.players} players`}
          >
            <div
              className="w-full rounded-t-[4px] transition-opacity"
              style={{
                height: d.starts ? `${Math.max(4, (d.starts / max) * (h - 8))}px` : '0px',
                background: BAR,
                opacity: hover == null || hover === i ? 1 : 0.45,
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-1 font-mono text-[9px] text-text-muted">
        <span>{shortDate(daily[0].date)}</span>
        <span>peak {max} a day</span>
        <span>today</span>
      </div>
      {active && (
        <div
          role="tooltip"
          className="absolute -top-2 -translate-y-full pointer-events-none rounded-sm border border-slate-300/30 bg-[#06101e] px-2 py-1.5 text-[11px] shadow-lg whitespace-nowrap"
          style={{ left: `clamp(0px, calc(${((hover + 0.5) / daily.length) * 100}% - 60px), calc(100% - 130px))` }}
        >
          <p className="font-semibold text-text">{shortDate(active.date)}</p>
          <p className="text-text-muted">{active.starts} started · {active.completions} finished</p>
          <p className="text-text-muted">{active.players} player{active.players === 1 ? '' : 's'}</p>
        </div>
      )}
      {/* The same numbers as a table, for screen readers. */}
      <table className="sr-only">
        <caption>Case Files runs per day</caption>
        <thead><tr><th>Date</th><th>Started</th><th>Finished</th><th>Players</th></tr></thead>
        <tbody>
          {daily.map((d) => <tr key={d.date}><td>{d.date}</td><td>{d.starts}</td><td>{d.completions}</td><td>{d.players}</td></tr>)}
        </tbody>
      </table>
    </div>
  )
}

// ── Horizontal bar row, used by the funnel and the stage scores ─────────────
function BarRow({ label, value, fraction, right }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr_3.5rem] items-center gap-2 text-[11px]">
      <span className="text-text-muted truncate">{label}</span>
      <div className="h-2.5 rounded-sm bg-slate-500/15 overflow-hidden" title={`${label}: ${value}`}>
        <div className="h-full rounded-r-[4px]" style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%`, background: BAR }} />
      </div>
      <span className="text-text tabular-nums text-right">{right}</span>
    </div>
  )
}

function ChapterBlock({ ch }) {
  const starts = ch.funnel[0]?.reached || ch.starts || 0
  return (
    <div data-testid={`cf-stats-chapter-${ch.chapterSlug}`} className="rounded-sm border border-slate-300/20 bg-surface-raised p-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-bold text-text">{ch.title}</p>
        <p className="font-mono text-[10px] text-text-muted">
          {ch.starts} runs · {ch.players} players · {pct(ch.completionRate)} finish
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <span className="text-text-muted">Median score <b className="text-text">{num(ch.medianScore)}</b>{ch.maxScore ? <span> / {num(ch.maxScore)}</span> : null}</span>
        <span className="text-text-muted">Best <b className="text-text">{num(ch.bestScore)}</b></span>
        <span className="text-text-muted">Median time <b className="text-text">{mins(ch.medianMinutes)}</b></span>
        <span className="text-text-muted">Questions asked <b className="text-text">{ch.avgQuestions == null ? '–' : ch.avgQuestions.toFixed(1)}</b></span>
      </div>

      {ch.funnel.length > 0 && starts > 0 && (
        <div>
          <p className="font-mono text-[9px] uppercase tracking-widest text-text-muted mb-1.5">Runs reaching each stage</p>
          <div className="flex flex-col gap-1">
            {ch.funnel.map((f) => (
              <BarRow
                key={f.stageIndex}
                label={`${f.stageIndex + 1}. ${stageTypeLabel(f.stageType)}`}
                value={f.reached}
                fraction={f.reached / starts}
                right={`${f.reached} · ${pct(f.reached / starts)}`}
              />
            ))}
          </div>
        </div>
      )}

      {ch.stageScores.length > 0 && (
        <div>
          <p className="font-mono text-[9px] uppercase tracking-widest text-text-muted mb-1.5">Average share of marks, finished runs</p>
          <div className="flex flex-col gap-1">
            {ch.stageScores.map((s) => (
              <BarRow key={s.stageType} label={stageTypeLabel(s.stageType)} value={pct(s.avgPct)} fraction={s.avgPct} right={pct(s.avgPct)} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function CaseFilesAdminStats({ API }) {
  const [data, setData]       = useState(null)
  const [error, setError]     = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await authFetch(`${API}/api/admin/case-files/stats`)
      if (!r.ok) throw new Error(String(r.status))
      const d = await r.json()
      setData(d?.data ?? null)
    } catch {
      setError('Could not load the stats.')
    } finally {
      setLoading(false)
    }
  }, [API])

  useEffect(() => { load() }, [load])

  const t = data?.totals

  return (
    <div data-testid="case-files-admin-stats" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-text-muted">
          {data?.generatedAt
            ? `as of ${new Date(data.generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
            : 'Case Files usage'}
        </span>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          data-testid="cf-stats-refresh"
          className="text-[11px] font-semibold px-2.5 py-1 rounded-sm border border-brand-600/40 text-brand-600 hover:bg-brand-600/10 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {!data && loading && <p className="text-xs text-text-muted">Loading…</p>}

      {t && (
        <>
          <AdminToolSection title="Usage">
            <div className="grid grid-cols-2 gap-1.5">
              <Tile testId="cf-stat-players" label="Players" value={num(t.players)} sub={`${num(t.playersLast7d)} in the last 7 days`} />
              <Tile testId="cf-stat-runs" label="Runs started" value={num(t.runsStarted)} sub={`${num(t.runsLast7d)} in the last 7 days`} />
              <Tile testId="cf-stat-completion" label="Finished" value={pct(t.completionRate)} sub={`${num(t.runsCompleted)} done · ${num(t.runsAbandoned)} restarted · ${num(t.runsInProgress)} open`} />
              <Tile testId="cf-stat-playtime" label="Median playtime" value={mins(t.medianMinutes)} sub={t.longRuns ? `${t.longRuns} left open 3h+ not counted` : 'start to finish'} />
              <Tile testId="cf-stat-repeat" label="Came back" value={num(t.repeatPlayers)} sub={`of ${num(t.finishers)} who finished a case`} />
              <Tile testId="cf-stat-interest" label="Want the next one" value={num(t.interested)} sub="registered interest" />
            </div>
          </AdminToolSection>

          <AdminToolSection title={`Runs started, last ${data.days} days`}>
            <ActivityChart daily={data.daily} />
          </AdminToolSection>

          <AdminToolSection title="By chapter" defaultOpen={false}>
            <div className="flex flex-col gap-2">
              {data.chapters.length === 0
                ? <p className="text-xs text-text-muted">No chapters yet.</p>
                : data.chapters.map((ch) => <ChapterBlock key={`${ch.caseSlug}/${ch.chapterSlug}`} ch={ch} />)}
            </div>
          </AdminToolSection>

          <AdminToolSection title="Top runs" defaultOpen={false}>
            {data.topScores.length === 0 ? (
              <p className="text-xs text-text-muted">Nobody has finished a case yet.</p>
            ) : (
              <table className="w-full text-[12px]" data-testid="cf-stats-top">
                <thead>
                  <tr className="font-mono text-[9px] uppercase tracking-widest text-text-muted text-left">
                    <th className="py-1 pr-2 font-normal">#</th>
                    <th className="py-1 pr-2 font-normal">Agent</th>
                    <th className="py-1 pr-2 font-normal text-right">Score</th>
                    <th className="py-1 font-normal text-right">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topScores.map((r, i) => (
                    <tr key={`${r.userId}-${r.chapterSlug}`} className="border-t border-slate-300/10 align-top">
                      <td className="py-1.5 pr-2 text-text-muted tabular-nums">{i + 1}</td>
                      <td className="py-1.5 pr-2">
                        <p className="text-text truncate max-w-[9rem]">
                          {r.displayName ?? (r.agentNumber ? `Agent ${r.agentNumber}` : 'Agent')}
                        </p>
                        {/* Chapter and date, under the name: the window has no
                            room for them as columns. */}
                        <p className="text-[10px] text-text-muted truncate max-w-[9rem]">
                          {r.chapterSlug} · {new Date(r.completedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </p>
                      </td>
                      <td className="py-1.5 pr-2 text-text font-bold tabular-nums text-right">{num(r.score)}</td>
                      <td className="py-1.5 text-text-muted tabular-nums text-right">{mins(r.minutes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </AdminToolSection>

          <AdminToolSection title="Interest in the next chapter" defaultOpen={false}>
            <div data-testid="cf-stats-interest">
              {data.interest.length === 0 ? (
                <p className="text-xs text-text-muted">No one has registered interest yet.</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {data.interest.map((row) => (
                    <div key={`${row.caseSlug}/${row.chapterSlug}`} className="flex flex-wrap items-baseline gap-x-3 text-[12px]">
                      <span className="text-text font-semibold">{row.teaserTitle || row.chapterSlug}</span>
                      <span className="text-text font-bold tabular-nums">{row.interested} interested</span>
                      {row.withdrawn > 0 && <span className="text-text-muted">{row.withdrawn} changed their mind</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </AdminToolSection>
        </>
      )}
    </div>
  )
}
