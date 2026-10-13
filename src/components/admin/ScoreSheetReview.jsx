import { useState } from 'react'
import { testsToText, textToTests } from '../../utils/scoreSheetTests'

// The numbers read off one photographed score sheet, under the photo in the questionnaire results'
// sheet viewer. An admin presses Read, checks every row against the photo above, corrects what the
// model misread and confirms. Only confirmed sheets count anywhere (see models/CbatScoreSheet.js).

const numOrNull = v => (v === '' || v == null ? null : Number(v))
const dateInput = d => (d ? String(d).slice(0, 10) : '')

const STATUS_WORDS = { extracted: 'Draft, not checked yet', confirmed: 'Checked and confirmed', rejected: 'Not a score sheet' }
const VERDICTS = [null, 'pass', 'fail']

function NumberCell({ value, onChange, label, width = 'w-12' }) {
  return (
    <input
      type="number"
      aria-label={label}
      value={value ?? ''}
      onChange={e => onChange(numOrNull(e.target.value))}
      className={`${width} bg-surface border border-slate-200 rounded px-1 py-0.5 text-xs text-slate-800`}
    />
  )
}

function BatteryEditor({ battery, onChange }) {
  const set = (patch) => onChange({ ...battery, ...patch })
  const setDomain = (i, patch) => set({ domains: battery.domains.map((d, j) => (j === i ? { ...d, ...patch } : d)) })
  const nextVerdict = VERDICTS[(VERDICTS.indexOf(battery.verdict) + 1) % VERDICTS.length]
  return (
    <div className="border border-slate-200 rounded-lg p-2 space-y-1.5" data-testid="sheet-review-battery">
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Role as printed"
          value={battery.label}
          onChange={e => set({ label: e.target.value })}
          className="flex-1 min-w-40 bg-surface border border-slate-200 rounded px-1.5 py-0.5 text-xs font-semibold text-slate-800"
        />
        <span className={`text-[10px] ${battery.batteryKey ? 'text-slate-500' : 'text-amber-600'}`}>
          {battery.batteryKey ?? 'No matching role'}
        </span>
        <button
          type="button"
          onClick={() => set({ verdict: nextVerdict })}
          className={`text-[10px] font-bold px-2 py-0.5 rounded border ${battery.verdict === 'pass' ? 'border-emerald-500 text-emerald-600' : battery.verdict === 'fail' ? 'border-rose-500 text-rose-600' : 'border-slate-300 text-slate-500'}`}
        >
          {battery.verdict ? battery.verdict.toUpperCase() : 'No verdict'}
        </button>
        <label className="text-[10px] text-slate-500 flex items-center gap-1">Bar <NumberCell label="Side bar" value={battery.sideBar} onChange={v => set({ sideBar: v })} width="w-10" /></label>
        <label className="text-[10px] text-slate-500 flex items-center gap-1">Cutoff <NumberCell label="Cutoff" value={battery.cutoff} onChange={v => set({ cutoff: v })} /></label>
        <label className="text-[10px] text-slate-500 flex items-center gap-1">Score <NumberCell label="Score" value={battery.score} onChange={v => set({ score: v })} /></label>
      </div>
      <table className="w-full text-[11px] text-slate-700">
        <thead>
          <tr className="text-[10px] text-slate-500 text-left">
            <th className="font-semibold">Domain</th><th className="font-semibold">Weight</th><th className="font-semibold">Tests</th>
            <th className="font-semibold">Stanine</th><th className="font-semibold">Minimum</th><th className="font-semibold">Below min</th>
          </tr>
        </thead>
        <tbody>
          {battery.domains.map((d, i) => (
            <tr key={i}>
              <td><input aria-label="Domain" value={d.key} onChange={e => setDomain(i, { key: e.target.value })} className="w-20 bg-surface border border-slate-200 rounded px-1 py-0.5 text-xs text-slate-800" /></td>
              <td><NumberCell label="Weight" value={d.weight} onChange={v => setDomain(i, { weight: v })} /></td>
              <td>
                <input
                  aria-label="Tests"
                  defaultValue={testsToText(d.tests)}
                  onBlur={e => setDomain(i, { tests: textToTests(e.target.value) })}
                  className="w-full min-w-32 bg-surface border border-slate-200 rounded px-1 py-0.5 text-xs text-slate-800"
                />
              </td>
              <td><NumberCell label="Stanine" value={d.stanine} onChange={v => setDomain(i, { stanine: v })} width="w-10" /></td>
              <td><NumberCell label="Minimum" value={d.minStanine} onChange={v => setDomain(i, { minStanine: v })} width="w-10" /></td>
              <td><input type="checkbox" aria-label="Below minimum" checked={!!d.belowMinimum} onChange={e => setDomain(i, { belowMinimum: e.target.checked })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function ScoreSheetReview({ userId, imageId, sheet, API, apiFetch, onSaved }) {
  const [draft, setDraft]       = useState(sheet)
  const [busy, setBusy]         = useState('')
  const [error, setError]       = useState('')
  const [rereadArmed, setArmed] = useState(false)

  // A new sheet from the server (a read, a save, a different image) replaces the local edits.
  const [seen, setSeen] = useState(sheet)
  // Returning here lets React re-render straight away with the new draft, rather than drawing one
  // frame of the new sheet against the old draft.
  if (sheet !== seen) { setSeen(sheet); setDraft(sheet); setArmed(false); return null }

  const call = async (label, url, init) => {
    setBusy(label); setError('')
    try {
      const res = await apiFetch(url, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...init })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.message || 'Something went wrong')
      onSaved(body.data.sheet)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy('')
    }
  }

  const read = (force = false) => call('read', `${API}/api/admin/score-sheets/extract`, {
    method: 'POST', body: JSON.stringify({ userId, imageId, force }),
  })
  const save = (status) => call(status ?? 'save', `${API}/api/admin/score-sheets/${draft._id}`, {
    method: 'PATCH',
    body: JSON.stringify({ testDate: dateInput(draft.testDate) || null, board: draft.board, batteries: draft.batteries, ...(status ? { status } : {}) }),
  })

  const btn = 'text-xs px-3 py-1.5 rounded-lg border font-semibold transition-colors disabled:opacity-50'

  if (!sheet) {
    return (
      <div className="mt-3 rounded-xl bg-surface border border-slate-200 p-3 flex items-center justify-between gap-3" data-testid="sheet-review">
        <p className="text-xs text-slate-600">Not read yet. Reading turns this photo into numbers we can search and compare.</p>
        <button type="button" disabled={!!busy} onClick={() => read()} className={`${btn} border-brand-600 text-brand-600 shrink-0`}>
          {busy ? 'Reading…' : 'Read this sheet'}
        </button>
        {error && <p className="text-xs text-rose-600">{error}</p>}
      </div>
    )
  }

  return (
    <div className="mt-3 rounded-xl bg-surface border border-slate-200 p-3 space-y-2" data-testid="sheet-review">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs font-semibold text-slate-800" data-testid="sheet-review-status">{STATUS_WORDS[draft.status] ?? draft.status}</p>
        <label className="text-[10px] text-slate-500 flex items-center gap-1">
          Test date
          <input
            type="date"
            value={dateInput(draft.testDate)}
            onChange={e => setDraft({ ...draft, testDate: e.target.value || null })}
            className="bg-surface border border-slate-200 rounded px-1 py-0.5 text-xs text-slate-800"
          />
        </label>
        <label className="text-[10px] text-slate-500 flex items-center gap-1">
          Board
          <input
            value={draft.board ?? ''}
            onChange={e => setDraft({ ...draft, board: e.target.value })}
            className="w-14 bg-surface border border-slate-200 rounded px-1 py-0.5 text-xs text-slate-800"
          />
        </label>
        <p className="text-[10px] text-slate-400 ml-auto">Check every row against the photo before confirming.</p>
      </div>

      {draft.batteries.map((b, i) => (
        <BatteryEditor
          key={`${draft._id}-${draft.extractedAt}-${i}`}
          battery={b}
          onChange={nb => setDraft({ ...draft, batteries: draft.batteries.map((x, j) => (j === i ? nb : x)) })}
        />
      ))}
      {draft.status !== 'rejected' && draft.batteries.length === 0 && (
        <p className="text-xs text-slate-500">No roles were read from this photo.</p>
      )}

      {error && <p className="text-xs text-rose-600">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!!busy} onClick={() => save('confirmed')} className={`${btn} border-emerald-500 text-emerald-600`}>
          {busy === 'confirmed' ? 'Saving…' : 'Confirm'}
        </button>
        <button type="button" disabled={!!busy} onClick={() => save()} className={`${btn} border-slate-300 text-slate-600`}>
          {busy === 'save' ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" disabled={!!busy} onClick={() => save('rejected')} className={`${btn} border-slate-300 text-slate-600`}>
          Not a score sheet
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => (draft.status === 'confirmed' && !rereadArmed ? setArmed(true) : read(draft.status === 'confirmed'))}
          className={`${btn} ${rereadArmed ? 'border-rose-500 text-rose-600' : 'border-slate-300 text-slate-600'}`}
        >
          {busy === 'read' ? 'Reading…' : rereadArmed ? 'Press again to replace the checked numbers' : 'Read again'}
        </button>
      </div>
    </div>
  )
}
