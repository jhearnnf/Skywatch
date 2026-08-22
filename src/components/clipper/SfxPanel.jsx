import { useState, useEffect, useRef } from 'react'

// Stage 5 — sound effects.
//
// The script writer already marked where a stinger belongs (`sfxCue` on each
// beat); this is where those get auditioned, moved, levelled or dropped. The
// catalogue is closed, so every suggestion resolves to something we can play.
//
// Audition happens in the browser against the same files the renderer uses, so
// what you hear here is what lands in the MP4.
//
// A cue can be placed on a WORD once the captions stage has aligned the
// narration. That is the difference between a stinger that punctuates the line
// and one that merely happens during it - and the timings were already being
// computed for the captions, so nothing new has to be measured. Before
// alignment exists the control falls back to a millisecond offset.

export default function SfxPanel({ script, library, sfxDir, onSave, onApprove, busy }) {
  const beats = script?.script?.beats ?? []
  const allWords = script?.captions?.words ?? []

  // One beat's narration, rebased to the beat's own start so the offsets match
  // what the renderer uses.
  const wordsFor = (beatId) => {
    const line = (script?.voice?.lines ?? []).find(l => l.beatId === beatId)
    const base = line?.startMs ?? 0
    return allWords
      .filter(w => w.beatId === beatId)
      .map(w => ({ text: w.text, startMs: Math.max(0, w.startMs - base) }))
  }
  const [rows, setRows] = useState([])
  const [dirty, setDirty] = useState(false)
  const audioRef = useRef(null)

  useEffect(() => {
    const saved = Array.isArray(script?.sfx) ? script.sfx : []
    if (saved.length) {
      setRows(saved)
    } else {
      // Seed from the script's cues, resolved by the server into catalogue ids.
      // Seeded on the same rule the renderer uses when no rows exist at all, so
      // opening this stage does not silently move every sound.
      setRows(beats
        .filter(b => b.sfxCue && b.resolvedSfxId)
        .map(b => {
          const words = wordsFor(b.id)
          const lands = (library ?? []).find(s => s.id === b.resolvedSfxId)?.placement === 'land'
          return {
            beatId: b.id, sfxId: b.resolvedSfxId, gain: 0.6, enabled: true,
            atMs: 0,
            atWord: (lands && words.length) ? words.length - 1 : null,
          }
        }))
    }
    setDirty(false)
  }, [script?._id, script?.updatedAt])

  // One audio element, reused: creating one per preview leaves a pile of
  // half-played sounds behind if you click quickly.
  const audition = (sfxId) => {
    const entry = library.find(s => s.id === sfxId)
    if (!entry) return
    if (!audioRef.current) audioRef.current = new Audio()
    const el = audioRef.current
    el.pause()
    el.src = `/${sfxDir}/${entry.file}`
    el.volume = 0.7
    el.play().catch(() => {})
  }

  useEffect(() => () => { audioRef.current?.pause() }, [])

  const rowFor = (beatId) => rows.find(r => r.beatId === beatId)

  const update = (beatId, patch) => {
    setRows(rs => rs.map(r => (r.beatId === beatId ? { ...r, ...patch } : r)))
    setDirty(true)
  }

  const add = (beatId) => {
    setRows(rs => [...rs, { beatId, sfxId: library[0]?.id, atMs: 0, gain: 0.6, enabled: true }])
    setDirty(true)
  }

  const remove = (beatId) => {
    setRows(rs => rs.filter(r => r.beatId !== beatId))
    setDirty(true)
  }

  if (beats.length === 0) {
    return <p className="text-sm text-slate-500 py-6 text-center">Write a script first.</p>
  }

  const active = rows.filter(r => r.enabled !== false).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {dirty ? (
          <button
            type="button"
            onClick={() => { onSave(rows); setDirty(false) }}
            disabled={busy}
            className="px-3 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-500 transition-colors disabled:opacity-50"
          >
            Save sound effects
          </button>
        ) : (
          <button
            type="button"
            onClick={onApprove}
            disabled={busy}
            className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500 transition-colors disabled:opacity-40"
          >
            Approve sound effects
          </button>
        )}
        <span className="text-xs text-slate-500 ml-auto">{active} active</span>
      </div>

      <p className="text-xs text-slate-500">
        Stingers sit under the voice by design. A reverse swoosh should lead <em>into</em> a cut,
        so give it a negative-feeling offset by placing it on the beat before.
        {allWords.length === 0
          ? ' Run the captions stage to place sounds on a word instead of a millisecond offset.'
          : ' Sounds are placed on a word, so they stay in step if the narration is re-recorded.'}
      </p>

      <div className="space-y-2">
        {beats.map((b, i) => {
          const row = rowFor(b.id)
          const entry = row ? library.find(s => s.id === row.sfxId) : null
          const words = wordsFor(b.id)
          return (
            <div key={b.id} className="border border-slate-200 rounded-xl bg-slate-50 p-3 space-y-2">
              <div className="flex items-start gap-3">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 shrink-0 mt-0.5">
                  Beat {i + 1}
                </span>
                <p className="text-sm text-slate-700 flex-1">{b.text}</p>
                {b.sfxCue && !row && (
                  <span className="text-[11px] text-slate-400 shrink-0">cue: {b.sfxCue}</span>
                )}
                {row ? (
                  <button type="button" onClick={() => remove(b.id)}
                    className="text-xs text-slate-500 hover:text-rose-700 shrink-0">Remove</button>
                ) : (
                  <button type="button" onClick={() => add(b.id)}
                    className="text-xs text-brand-600 font-semibold hover:underline shrink-0">Add sound</button>
                )}
              </div>

              {row && (
                <>
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto]">
                    <select
                      value={row.sfxId}
                      onChange={e => update(b.id, { sfxId: e.target.value })}
                      className="px-2 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-sm text-slate-800"
                    >
                      {library.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>

                    <button
                      type="button"
                      onClick={() => audition(row.sfxId)}
                      className="px-2.5 py-1.5 rounded-lg border border-brand-200 text-brand-600 text-xs font-semibold hover:bg-brand-100 transition-colors"
                    >
                      ▶ Play
                    </button>

                    {words.length > 0 ? (
                      <label className="flex items-center gap-1 text-xs text-slate-600">
                        on
                        <select
                          value={Number.isInteger(row.atWord) ? row.atWord : ''}
                          onChange={e => update(b.id, {
                            atWord: e.target.value === '' ? null : Number(e.target.value),
                          })}
                          className="px-2 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-sm text-slate-800"
                        >
                          <option value="">beat start</option>
                          {words.map((w, wi) => (
                            <option key={wi} value={wi}>
                              {w.text} ({(w.startMs / 1000).toFixed(1)}s)
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <label className="flex items-center gap-1 text-xs text-slate-600">
                        at
                        <input
                          type="number" min={0} step={100} value={row.atMs}
                          onChange={e => update(b.id, { atMs: Number(e.target.value) })}
                          className="w-20 px-2 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-slate-800"
                        />
                        ms
                      </label>
                    )}

                    <label className="flex items-center gap-1 text-xs text-slate-600">
                      vol
                      <input
                        type="range" min={0} max={0.9} step={0.05} value={row.gain}
                        onChange={e => update(b.id, { gain: Number(e.target.value) })}
                        className="w-24"
                      />
                    </label>

                    <label className="flex items-center gap-1.5 text-xs text-slate-600">
                      <input type="checkbox" checked={row.enabled !== false}
                        onChange={e => update(b.id, { enabled: e.target.checked })} />
                      on
                    </label>
                  </div>
                  {entry?.use && <p className="text-[11px] text-slate-500">{entry.use}</p>}
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
