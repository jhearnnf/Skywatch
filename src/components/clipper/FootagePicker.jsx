import { useState } from 'react'

// Stage 2 — pick the filler clip that plays under each spoken beat.
//
// Candidates are shown per beat rather than in one big grid: a clip is only
// good or bad relative to the line being spoken over it, so the script text
// stays on screen next to the choices.

const PROVIDER_STYLE = {
  dvids:   'bg-emerald-100 text-emerald-700 border-emerald-200',
  pexels:  'bg-sky-100 text-sky-700 border-sky-200',
  pixabay: 'bg-violet-100 text-violet-700 border-violet-200',
}

function Candidate({ clip, chosen, onChoose }) {
  return (
    <button
      type="button"
      onClick={() => onChoose(chosen ? null : clip)}
      title={`${clip.title}\n${clip.licence}`}
      className={`shrink-0 w-36 text-left rounded-lg overflow-hidden border-2 transition-colors ${
        chosen ? 'border-brand-600' : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <div className="relative h-24 bg-slate-100">
        {clip.thumbUrl
          ? <img src={clip.thumbUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
          : <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs">no preview</div>}
        {clip.durationSec ? (
          <span className="absolute bottom-1 right-1 px-1 rounded bg-black/70 text-white text-[10px] font-mono">
            {Math.round(clip.durationSec)}s
          </span>
        ) : null}
      </div>
      <div className="p-1.5 space-y-1">
        <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wider ${PROVIDER_STYLE[clip.provider] || ''}`}>
          {clip.provider}
        </span>
        <p className="text-[11px] text-slate-600 leading-tight line-clamp-2">{clip.title}</p>
      </div>
    </button>
  )
}

function BeatRow({ beat, index, entry, onSearch, onChoose, onCapture, job, agentOnline, busy }) {
  // A job only belongs to this row if it is a capture for this beat.
  const mine = job?.type === 'capture' && job.payload?.beatId === beat.id ? job : null
  const captureJob = mine && (mine.status === 'queued' || mine.status === 'claimed') ? mine : null
  const failedJob  = mine && mine.status === 'failed' ? mine : null

  const [term, setTerm] = useState(entry?.term ?? beat.visual?.query ?? '')
  const candidates = entry?.candidates ?? []
  const chosen = entry?.chosen ?? null

  const isCapture = beat.visual?.kind === 'capture'

  return (
    <div className="border border-slate-200 rounded-xl bg-slate-50 p-3 space-y-2">
      <div className="flex items-start gap-3">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 shrink-0 mt-0.5">
          Beat {index + 1}
        </span>
        <p className="text-sm text-slate-700 flex-1">{beat.text}</p>
        {chosen && (
          <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-emerald-700">
            ✓ chosen
          </span>
        )}
      </div>

      {isCapture ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-slate-500">
              Screen recording - recipe <code className="text-slate-600">{beat.visual.recipeId || '(none set)'}</code>
            </span>
            <button
              type="button"
              onClick={() => onCapture(beat.id)}
              disabled={busy || !beat.visual.recipeId || !agentOnline || Boolean(captureJob)}
              title={agentOnline ? undefined : 'The agent records the screen - start it first'}
              className="px-3 py-1.5 rounded-lg border border-brand-200 text-brand-600 text-xs font-semibold hover:bg-brand-100 transition-colors disabled:opacity-40"
            >
              {captureJob ? 'Recording…' : chosen ? 'Re-record' : 'Record'}
            </button>
            {chosen && !captureJob && (
              <span className="text-xs text-slate-500">
                {chosen.durationSec ? `${chosen.durationSec.toFixed(1)}s recorded` : 'recorded'}
              </span>
            )}
          </div>

          {/* Without this the button queued a job and appeared to do nothing —
              the work happens on another machine and takes tens of seconds. */}
          {captureJob && (
            <div className="space-y-1">
              <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full bg-brand-600 transition-all duration-500"
                  style={{ width: `${captureJob.progress || 0}%` }} />
              </div>
              <p className="text-xs text-slate-500">
                {captureJob.status === 'queued'
                  ? 'Queued - waiting for the agent to pick it up'
                  : captureJob.stepLabel || 'recording'}
              </p>
            </div>
          )}

          {failedJob && (
            <p className="text-xs text-rose-700 bg-rose-100 border border-rose-200 rounded-lg px-2.5 py-1.5">
              Recording failed: {failedJob.error}
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <input
              value={term}
              onChange={e => setTerm(e.target.value)}
              placeholder="stock search terms"
              className="flex-1 px-2.5 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-sm text-slate-800"
            />
            <button
              type="button"
              onClick={() => onSearch(beat.id, term)}
              disabled={busy || !term.trim()}
              className="px-3 py-1.5 rounded-lg border border-brand-200 text-brand-600 text-xs font-semibold hover:bg-brand-100 transition-colors disabled:opacity-50"
            >
              Search
            </button>
          </div>

          {candidates.length > 0 ? (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {candidates.map(c => (
                <Candidate
                  key={`${c.provider}:${c.providerId}`}
                  clip={c}
                  chosen={chosen?.provider === c.provider && chosen?.providerId === c.providerId}
                  onChoose={clip => onChoose(beat.id, clip)}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              {entry?.searchedAt ? 'No clips found for those terms.' : 'Not searched yet.'}
            </p>
          )}
        </>
      )}
    </div>
  )
}

export default function FootagePicker({ script, footage, providers, job, agentOnline, onSearchAll, onSearch, onChoose, onCapture, onApprove, busy }) {
  const beats = script?.script?.beats ?? []

  if (beats.length === 0) {
    return <p className="text-sm text-slate-500 py-6 text-center">Write a script first.</p>
  }

  const stockBeats = beats.filter(b => b.visual?.kind !== 'capture')
  const chosenCount = stockBeats.filter(b => footage?.[b.id]?.chosen).length
  const ready = stockBeats.length > 0 && chosenCount === stockBeats.length

  const off = Object.entries(providers || {}).filter(([, on]) => !on).map(([n]) => n)
  const hasCaptureBeats = beats.some(b => b.visual?.kind === 'capture')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onSearchAll}
          disabled={busy}
          className="px-3 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-500 transition-colors disabled:opacity-50"
        >
          {busy ? 'Searching…' : 'Search all beats'}
        </button>

        <button
          type="button"
          onClick={onApprove}
          disabled={busy || !ready}
          title={ready ? undefined : 'Choose a clip for every beat first'}
          className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500 transition-colors disabled:opacity-40"
        >
          Approve footage
        </button>

        <span className="text-xs text-slate-500 ml-auto">
          {chosenCount} of {stockBeats.length} chosen
        </span>
      </div>

      {hasCaptureBeats && !agentOnline && (
        <p className="text-xs text-amber-700 bg-amber-100 border border-amber-200 rounded-lg px-2.5 py-1.5">
          This script has screen-recording beats, but the agent is offline so nothing can record.
          Start it with <code>npm start</code> in <code>clipper-agent/</code>.
        </p>
      )}

      {off.length > 0 && (
        <p className="text-xs text-amber-700 bg-amber-100 border border-amber-200 rounded-lg px-2.5 py-1.5">
          Not configured, so skipped: {off.join(', ')}. Add the API keys to backend/.env for more choice.
        </p>
      )}

      <div className="space-y-2">
        {beats.map((b, i) => (
          <BeatRow
            key={b.id}
            beat={b}
            index={i}
            entry={footage?.[b.id]}
            onSearch={onSearch}
            onChoose={onChoose}
            onCapture={onCapture}
            job={job}
            agentOnline={agentOnline}
            busy={busy}
          />
        ))}
      </div>
    </div>
  )
}
