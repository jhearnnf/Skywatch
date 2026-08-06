import { useState } from 'react'

// Idea generator — a batch of one-liner premises, each tied to the reference
// facts it draws on. Picking one promotes it to a script project.
//
// Ideas are deduped server-side against every script already written, so a
// batch cannot restate something we have covered. The angle line is what the
// ledger records, and what the next generation is told to avoid repeating.

const MODES = [
  { id: null,       label: 'Any'     },
  { id: 'tips',     label: 'Tips'    },
  { id: 'feature',  label: 'Feature' },
]

export default function IdeaGenerator({ ideas, onGenerate, onPick, busy, pickingId }) {
  const [mode,  setMode]  = useState(null)
  const [count, setCount] = useState(6)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => onGenerate({ mode, count })}
          disabled={busy}
          className="px-3 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-500 transition-colors disabled:opacity-50"
        >
          {busy ? 'Generating…' : 'Generate ideas'}
        </button>

        <div className="flex items-center gap-1">
          {MODES.map(m => (
            <button
              key={m.label}
              type="button"
              onClick={() => setMode(m.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                mode === m.id
                  ? 'bg-brand-100 text-brand-600 border-brand-200'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          Count
          <input
            type="number"
            min={1}
            max={12}
            value={count}
            onChange={e => setCount(Number(e.target.value))}
            className="w-14 px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 text-slate-800"
          />
        </label>
      </div>

      {ideas.length === 0 ? (
        <p className="text-sm text-slate-500 py-6 text-center">
          No ideas yet. Generate a batch to get started.
        </p>
      ) : (
        <div className="space-y-2">
          {ideas.map((idea, i) => (
            <div key={i} className="border border-slate-200 rounded-xl bg-slate-50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{idea.oneLiner}</p>
                  {idea.hook && (
                    <p className="text-xs text-brand-600 mt-1">Hook: &ldquo;{idea.hook}&rdquo;</p>
                  )}
                  {idea.angle && (
                    <p className="text-xs text-slate-600 mt-0.5">Angle: {idea.angle}</p>
                  )}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[11px] font-semibold uppercase tracking-wider">
                      {idea.mode}
                    </span>
                    {idea.factKeys.map(k => (
                      <span key={k} className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[11px] font-mono">
                        {k}
                      </span>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onPick(idea)}
                  disabled={Boolean(pickingId)}
                  className="shrink-0 px-3 py-1.5 rounded-lg border border-brand-200 text-brand-600 text-xs font-semibold hover:bg-brand-100 transition-colors disabled:opacity-50"
                >
                  {pickingId === idea.oneLiner ? 'Creating…' : 'Use this'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
