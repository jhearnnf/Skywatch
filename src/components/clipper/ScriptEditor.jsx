import { useState, useEffect } from 'react'

// Script editor — the beat list for one video, plus the guardrail findings.
//
// Findings are shown, never auto-applied. A validator that silently rewrote
// copy would hide the fact that generation keeps reaching for a claim we do
// not allow, and that signal is worth more than the convenience.

function Finding({ finding }) {
  const isError = finding.severity === 'error'
  return (
    <li className={`text-xs rounded-lg px-2.5 py-1.5 border ${
      isError
        ? 'bg-rose-100 text-rose-700 border-rose-200'
        : 'bg-amber-100 text-amber-700 border-amber-200'
    }`}>
      <span className="font-bold uppercase tracking-wider mr-1.5">
        {isError ? 'Error' : 'Warn'}
      </span>
      {finding.message}
      {finding.beatId && <span className="opacity-70"> ({finding.beatId})</span>}
    </li>
  )
}

function BeatRow({ beat, index, onChange }) {
  return (
    <div className="border border-slate-200 rounded-xl bg-slate-50 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
          Beat {index + 1}
        </span>
        {index === 0 && (
          <span className="px-2 py-0.5 rounded-md bg-brand-100 text-brand-600 text-[11px] font-bold uppercase tracking-wider">
            Hook
          </span>
        )}
        {/* The beat that opens a new question part-way through, which is what
            keeps the second half from being the first half running down. */}
        {beat.rehook && (
          <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-700 text-[11px] font-bold uppercase tracking-wider">
            Re-hook
          </span>
        )}
        {beat.factKeys?.map(k => (
          <span key={k} className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[11px] font-mono">
            {k}
          </span>
        ))}
      </div>

      <textarea
        value={beat.text}
        onChange={e => onChange({ ...beat, text: e.target.value })}
        rows={2}
        className="w-full px-2.5 py-2 rounded-lg bg-slate-100 border border-slate-200 text-sm text-slate-800 resize-y"
      />

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        <span>
          <span className="font-semibold text-slate-600">Visual:</span>{' '}
          {beat.visual?.kind === 'capture'
            ? `capture / ${beat.visual.recipeId || '(no recipe)'}`
            : beat.visual?.query || '(none)'}
        </span>
        {beat.sfxCue  && <span><span className="font-semibold text-slate-600">SFX:</span> {beat.sfxCue}</span>}
        {beat.overlay && <span><span className="font-semibold text-slate-600">Overlay:</span> {beat.overlay}</span>}
      </div>
    </div>
  )
}

// The retention shape the writer committed to. Shown because it is a claim the
// script can be read against - a "counted list" with nothing counted out loud
// is worth spotting before the voice stage turns it into audio.
const FORMAT_LABELS = {
  list: 'Counted list',
  'myth-bust': 'Myth-bust',
  'one-mistake': 'One mistake',
}

export default function ScriptEditor({ script, subjects = [], onGenerate, onSave, onApprove, busy }) {
  const [beats, setBeats] = useState(script?.script?.beats ?? [])
  const [outro, setOutro] = useState(script?.outro?.copy ?? '')
  // What the video is promoting. Set here rather than only at creation because
  // it decides what the writer is told to say and show, so changing it is a
  // reason to regenerate rather than a cosmetic edit.
  const [subject, setSubject] = useState(script?.subject?.key ?? '')
  const [dirty, setDirty] = useState(false)

  // Re-sync when the server hands back a regenerated script.
  useEffect(() => {
    setBeats(script?.script?.beats ?? [])
    setOutro(script?.outro?.copy ?? '')
    setSubject(script?.subject?.key ?? '')
    setDirty(false)
  }, [script?._id, script?.updatedAt])

  if (!script) {
    return <p className="text-sm text-slate-500 py-6 text-center">Select or create a script.</p>
  }

  const updateBeat = (i, next) => {
    setBeats(bs => bs.map((b, j) => (j === i ? next : b)))
    setDirty(true)
  }

  const findings = script.validation?.findings ?? []
  const errors   = findings.filter(f => f.severity === 'error')
  const hasBeats = beats.length > 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <span className="font-semibold uppercase tracking-wider text-[11px] text-slate-500">Promoting</span>
          <select
            value={subject}
            onChange={e => { setSubject(e.target.value); setDirty(true) }}
            className="px-2 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-sm text-slate-800"
          >
            <option value="">Nothing in particular</option>
            {subjects.map(s => (
              <option key={s.key} value={s.key}>{s.spokenName}</option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={onGenerate}
          disabled={busy}
          className="px-3 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-500 transition-colors disabled:opacity-50"
        >
          {busy ? 'Writing…' : hasBeats ? 'Regenerate script' : 'Generate script'}
        </button>

        {dirty && (
          <button
            type="button"
            onClick={() => onSave({ beats, outro, subject })}
            disabled={busy}
            className="px-3 py-2 rounded-xl border border-brand-200 text-brand-600 text-sm font-semibold hover:bg-brand-100 transition-colors disabled:opacity-50"
          >
            Save changes
          </button>
        )}

        {hasBeats && !dirty && (
          <button
            type="button"
            onClick={onApprove}
            disabled={busy || errors.length > 0}
            title={errors.length > 0 ? 'Resolve the guardrail errors first' : undefined}
            className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500 transition-colors disabled:opacity-40"
          >
            Approve script
          </button>
        )}

        {hasBeats && (
          <span className="text-xs text-slate-500 ml-auto">
            {script.script.format && <>{FORMAT_LABELS[script.script.format] || script.script.format} &middot; </>}
            {script.script.wordCount} words &middot; ~{script.script.estDurationSec}s
          </span>
        )}
      </div>

      {findings.length > 0 && (
        <ul className="space-y-1.5">
          {findings.map((f, i) => <Finding key={i} finding={f} />)}
        </ul>
      )}

      {hasBeats && findings.length === 0 && script.validation?.checkedAt && (
        <p className="text-xs text-emerald-700 bg-emerald-100 border border-emerald-200 rounded-lg px-2.5 py-1.5">
          Passes all guardrails.
        </p>
      )}

      <div className="space-y-2">
        {beats.map((b, i) => (
          <BeatRow key={b.id || i} beat={b} index={i} onChange={next => updateBeat(i, next)} />
        ))}
      </div>

      {script.outro?.enabled && hasBeats && (
        <div className="border border-slate-200 rounded-xl bg-slate-50 p-3 space-y-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Outro</span>
          <textarea
            value={outro}
            onChange={e => { setOutro(e.target.value); setDirty(true) }}
            rows={2}
            className="w-full px-2.5 py-2 rounded-lg bg-slate-100 border border-slate-200 text-sm text-slate-800 resize-y"
          />
        </div>
      )}
    </div>
  )
}
