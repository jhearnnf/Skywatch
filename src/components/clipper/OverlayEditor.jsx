import { useState, useEffect } from 'react'

// Stage 6 — on-screen text.
//
// Distinct from captions: captions are the spoken word, overlays are the
// callouts and stat cards that punctuate it. The script writer already proposed
// one per beat where it earns its place; this is where those get edited, moved
// or removed.
//
// Overlays are keyed by beat id rather than stored on the beat, so regenerating
// the script does not discard hand-tuned callouts.

const ANIMATIONS = ['pop', 'slide', 'none']

export default function OverlayEditor({ script, onSave, onApprove, busy }) {
  const beats = script?.script?.beats ?? []

  const [rows, setRows] = useState([])
  const [dirty, setDirty] = useState(false)

  // Seed from saved overlays, falling back to the script's suggestions so a
  // video that skipped this stage still has its callouts.
  useEffect(() => {
    const saved = Array.isArray(script?.overlays) ? script.overlays : []
    const seeded = beats
      .map(b => {
        const existing = saved.find(o => o.beatId === b.id)
        if (existing) return existing
        if (b.overlay) return { beatId: b.id, text: b.overlay, animation: 'pop', topPct: 16, fontSize: 62, color: '#ffffff' }
        return null
      })
      .filter(Boolean)
    setRows(seeded)
    setDirty(false)
  }, [script?._id, script?.updatedAt])

  const update = (beatId, patch) => {
    setRows(rs => rs.map(r => (r.beatId === beatId ? { ...r, ...patch } : r)))
    setDirty(true)
  }

  const add = (beatId) => {
    setRows(rs => [...rs, { beatId, text: '', animation: 'pop', topPct: 16, fontSize: 62, color: '#ffffff' }])
    setDirty(true)
  }

  const remove = (beatId) => {
    setRows(rs => rs.filter(r => r.beatId !== beatId))
    setDirty(true)
  }

  if (beats.length === 0) {
    return <p className="text-sm text-slate-500 py-6 text-center">Write a script first.</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {dirty && (
          <button
            type="button"
            onClick={() => { onSave(rows.filter(r => r.text.trim())); setDirty(false) }}
            disabled={busy}
            className="px-3 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-500 transition-colors disabled:opacity-50"
          >
            Save overlays
          </button>
        )}
        {!dirty && (
          <button
            type="button"
            onClick={onApprove}
            disabled={busy}
            className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500 transition-colors disabled:opacity-40"
          >
            Approve overlays
          </button>
        )}
        <span className="text-xs text-slate-500 ml-auto">
          {rows.filter(r => r.text.trim()).length} of {beats.length} beats have a callout
        </span>
      </div>

      <p className="text-xs text-slate-500">
        Three or four callouts across a video reads well. One on every beat competes with the captions.
      </p>

      <div className="space-y-2">
        {beats.map((b, i) => {
          const row = rows.find(r => r.beatId === b.id)
          return (
            <div key={b.id} className="border border-slate-200 rounded-xl bg-slate-50 p-3 space-y-2">
              <div className="flex items-start gap-3">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 shrink-0 mt-0.5">
                  Beat {i + 1}
                </span>
                <p className="text-sm text-slate-700 flex-1">{b.text}</p>
                {row ? (
                  <button type="button" onClick={() => remove(b.id)}
                    className="text-xs text-slate-500 hover:text-rose-700 shrink-0">Remove</button>
                ) : (
                  <button type="button" onClick={() => add(b.id)}
                    className="text-xs text-brand-600 font-semibold hover:underline shrink-0">Add callout</button>
                )}
              </div>

              {row && (
                <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
                  <input
                    value={row.text}
                    onChange={e => update(b.id, { text: e.target.value })}
                    placeholder="callout text"
                    className="px-2.5 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-sm text-slate-800"
                  />
                  <select
                    value={row.animation}
                    onChange={e => update(b.id, { animation: e.target.value })}
                    className="px-2 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-xs text-slate-800"
                  >
                    {ANIMATIONS.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                  <input
                    type="number" min={24} max={110} value={row.fontSize}
                    onChange={e => update(b.id, { fontSize: Number(e.target.value) })}
                    title="font size"
                    className="w-20 px-2 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-xs text-slate-800"
                  />
                  <input
                    type="color" value={row.color ?? '#ffffff'}
                    onChange={e => update(b.id, { color: e.target.value })}
                    title="text colour"
                    className="w-12 h-8 rounded-lg bg-slate-100 border border-slate-200"
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
