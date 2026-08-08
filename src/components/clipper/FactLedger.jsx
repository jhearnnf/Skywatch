import { useState } from 'react'

// Fact ledger — the ingested reference guide, and how often each finding has
// already been used in a video.
//
// The grade column is load-bearing rather than decorative: green facts may be
// stated flatly, amber must be hedged in the script, and red is never offered
// to generation at all. Showing it here is how the admin understands why a
// script hedges the way it does.

const GRADE_STYLES = {
  green: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  amber: 'bg-amber-100 text-amber-700 border-amber-200',
  red:   'bg-rose-100 text-rose-700 border-rose-200',
}

const GRADE_HINT = {
  green: 'Stated directly',
  amber: 'Must be hedged',
  red:   'Excluded from scripts',
}

function GradePill({ grade }) {
  return (
    <span
      title={GRADE_HINT[grade]}
      className={`inline-block px-2 py-0.5 rounded-md border text-[11px] font-bold uppercase tracking-wider ${GRADE_STYLES[grade] || ''}`}
    >
      {grade}
    </span>
  )
}

function FactRow({ fact, onRetire }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="border border-slate-200 rounded-xl bg-slate-50 overflow-hidden">
      <div className="flex items-start gap-3 p-3">
        <GradePill grade={fact.grade} />

        <div className="flex-1 min-w-0">
          <p className={`text-sm text-slate-800 ${fact.retired ? 'line-through opacity-50' : ''}`}>
            {fact.text}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-slate-500">
            {fact.containerAbbr || fact.containerName ? (
              <span className="font-semibold">{fact.containerAbbr || fact.containerName}</span>
            ) : null}
            {fact.tag ? <span>{fact.tag}</span> : null}
            <span>{fact.refCount} source{fact.refCount === 1 ? '' : 's'}</span>
            <span className={fact.useCount > 0 ? 'text-brand-600 font-semibold' : ''}>
              used {fact.useCount}x
            </span>
            <button
              type="button"
              onClick={() => setOpen(o => !o)}
              className="text-brand-600 font-semibold hover:underline"
            >
              {open ? 'Hide' : 'Why'}
            </button>
            <button
              type="button"
              onClick={() => onRetire(fact.factKey, !fact.retired)}
              className="text-slate-500 hover:text-slate-800"
            >
              {fact.retired ? 'Restore' : 'Retire'}
            </button>
          </div>
        </div>
      </div>

      {open && (
        <div className="px-3 pb-3 pt-0 space-y-2">
          {fact.why && (
            <p className="text-xs text-slate-600 bg-slate-100 rounded-lg p-2">{fact.why}</p>
          )}
          {(fact.anglesUsed || []).length > 0 && (
            <div className="text-xs text-slate-600">
              <p className="font-semibold text-slate-700 mb-1">Angles already used</p>
              <ul className="space-y-0.5">
                {fact.anglesUsed.map((a, i) => (
                  <li key={i}>&ldquo;{a.hook}&rdquo; &mdash; {a.angle}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function FactLedger({ facts, counts, ingested, onIngest, onRetire, busy }) {
  const [gradeFilter, setGradeFilter] = useState('all')
  const [unusedOnly,  setUnusedOnly]  = useState(false)

  const shown = facts.filter(f => {
    if (gradeFilter !== 'all' && f.grade !== gradeFilter) return false
    if (unusedOnly && f.useCount > 0) return false
    return true
  })

  // The guide lives in APPLICATION_INFO/, which Railway does not deploy, so in
  // production the source has to be handed over from the browser.
  const handleFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => onIngest(String(reader.result || ''))
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="px-3 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold cursor-pointer hover:bg-brand-500 transition-colors">
          Upload guide
          <input type="file" accept=".html,.htm,.txt" onChange={handleFile} className="hidden" disabled={busy} />
        </label>
        <button
          type="button"
          onClick={() => onIngest(null)}
          disabled={busy}
          className="px-3 py-2 rounded-xl border border-brand-200 text-brand-600 text-sm font-semibold hover:bg-brand-100 transition-colors disabled:opacity-50"
        >
          Re-ingest from server file
        </button>
        {ingested && (
          <span className="text-xs text-slate-500">
            {counts.green} green &middot; {counts.amber} amber &middot; {counts.red} red
          </span>
        )}
      </div>

      {!ingested ? (
        <p className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-4">
          No reference guide ingested yet. Upload <code>public/cbat-guide.html</code> to
          extract its findings, or re-ingest from the server file if you are running locally.
          Use the public edition, never the private one - anything ingested here can end up
          quoted in a published video.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {['all', 'green', 'amber', 'red'].map(g => (
              <button
                key={g}
                type="button"
                onClick={() => setGradeFilter(g)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                  gradeFilter === g
                    ? 'bg-brand-100 text-brand-600 border-brand-200'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {g === 'all' ? 'All' : g}
              </button>
            ))}
            <label className="flex items-center gap-1.5 text-xs text-slate-600 ml-2">
              <input type="checkbox" checked={unusedOnly} onChange={e => setUnusedOnly(e.target.checked)} />
              Unused only
            </label>
            <span className="text-xs text-slate-500 ml-auto">{shown.length} shown</span>
          </div>

          <div className="space-y-2">
            {shown.map(f => (
              <FactRow key={f.factKey} fact={f} onRetire={onRetire} />
            ))}
            {shown.length === 0 && (
              <p className="text-sm text-slate-500 py-6 text-center">Nothing matches those filters.</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
