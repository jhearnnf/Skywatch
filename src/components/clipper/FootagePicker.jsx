import { useState } from 'react'
import TrimScrubber from './TrimScrubber'
import { toPreviewUrl } from '../../utils/clipperPreview'
import { beatWindow } from '../../utils/clipperTrim'

// Stage 2 — pick the filler clip that plays under each spoken beat, and choose
// which part of it plays.
//
// Candidates are shown per beat rather than in one big grid: a clip is only
// good or bad relative to the line being spoken over it, so the script text
// stays on screen next to the choices.
//
// Picking a clip is only half the job. A beat is a couple of seconds long and
// takes those seconds from the start of the clip unless told otherwise, which
// is how a screen recording contributed nothing but its loading spinner. The
// trim scrubber under each chosen clip is where that gets fixed.

const PROVIDER_STYLE = {
  dvids:   'bg-emerald-100 text-emerald-700 border-emerald-200',
  pexels:  'bg-sky-100 text-sky-700 border-sky-200',
  pixabay: 'bg-violet-100 text-violet-700 border-violet-200',
  // Ours, so it gets the brand colour - when a curated clip and a stock one
  // are side by side the curated one should be the obvious pick.
  library: 'bg-brand-100 text-brand-600 border-brand-200',
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

// The trim control for whichever clip this beat ended up with. Shared by the
// stock and capture branches — where the footage came from makes no difference
// to which part of it you want.
function BeatTrim({ beat, chosen, trim, window: win, mediaBaseUrl, onTrim }) {
  const src = toPreviewUrl(chosen.playbackUrl || chosen.downloadUrl || null, mediaBaseUrl)

  return (
    <div className="pt-2 border-t border-slate-200">
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
        Trim &mdash; which {(win.ms / 1000).toFixed(1)}s of this clip plays
      </p>
      <TrimScrubber
        src={src}
        clipDurationMs={chosen.durationSec ? chosen.durationSec * 1000 : null}
        windowMs={win.ms}
        estimated={win.estimated}
        inMs={Number(trim?.inMs) || 0}
        onChange={inMs => onTrim(beat.id, inMs)}
        emptyMessage={chosen.provider === 'capture'
          ? 'Start the agent to preview and trim this recording - it serves the file.'
          : 'This provider gives no direct video file, so the clip cannot be previewed or trimmed here.'}
      />
    </div>
  )
}

// Recordings of this game that already exist.
//
// A recording of a game is not specific to the beat that asked for it: twenty
// seconds of FLAG being played is twenty seconds of FLAG being played, whatever
// line is spoken over it. Re-recording for every script costs a minute of
// browser automation to reproduce a file we already had - and the agent has to
// be running to do it.
//
// Only takes of THIS beat's recipe are offered. Filming a different game while
// the voice talks about this one is worse than stock footage, because it looks
// deliberate.
function CaptureLibrary({ recipeId, onList, onReuse, onForget, busy }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')

  const load = async () => {
    setError('')
    try {
      setRows(await onList(recipeId))
    } catch (err) {
      setError(err.message || 'Could not read the recording library')
      setRows([])
    }
  }

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next) await load()
  }

  const forget = async (id) => {
    await onForget(id)
    await load()
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={toggle}
        disabled={!recipeId}
        className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-100 transition-colors disabled:opacity-40"
      >
        {open ? 'Hide existing recordings' : 'Use an existing recording'}
      </button>

      {open && (
        <div className="rounded-lg border border-slate-200 bg-white p-2 space-y-1.5">
          {error && <p className="text-xs text-rose-700">{error}</p>}

          {rows === null && <p className="text-xs text-slate-500">Reading the library…</p>}

          {rows?.length === 0 && !error && (
            <p className="text-xs text-slate-500">
              Nothing recorded for <code className="text-slate-600">{recipeId}</code> yet. Record once and
              every later script can reuse it.
            </p>
          )}

          {rows?.map(row => (
            <div key={row._id} className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => onReuse(row._id)}
                disabled={busy || row.missing}
                title={row.missing
                  ? 'The file is gone - the agent keeps recordings in a temp folder that gets cleared'
                  : undefined}
                className="flex-1 text-left px-2 py-1.5 rounded-lg border border-brand-200 text-brand-600 font-semibold hover:bg-brand-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {row.durationSec ? `${row.durationSec.toFixed(1)}s` : 'unknown length'}
                {' · '}
                {new Date(row.recordedAt).toLocaleString()}
                {row.useCount > 0 && ` · used ${row.useCount}×`}
                {/* A take filmed before the human-input work has no log, so it
                    falls back to the recipe's measured crop rather than punching
                    in on where the hand went. Better said here than discovered
                    in the edit. */}
                {!row.hasInputLog && ' · no input log'}
                {row.missing && ' · file gone'}
              </button>
              <button
                type="button"
                onClick={() => forget(row._id)}
                disabled={busy}
                title="Forget this recording"
                className="px-2 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors disabled:opacity-40"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function BeatRow({ beat, index, entry, window: win, mediaBaseUrl, onSearch, onChoose, onCapture,
  onListCaptures, onReuseCapture, onForgetCapture, onTrim, job, agentOnline, busy }) {
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

          {/* Deliberately not gated on the agent being online: taking a clip we
              already have is exactly what you want when the agent is down, and
              a disabled button there would send you off to start it for nothing. */}
          {!captureJob && (
            <CaptureLibrary
              recipeId={beat.visual.recipeId}
              onList={onListCaptures}
              onReuse={(captureId) => onReuseCapture(beat.id, captureId)}
              onForget={onForgetCapture}
              busy={busy}
            />
          )}

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

          {chosen && !captureJob && (
            <BeatTrim
              beat={beat} chosen={chosen} trim={entry?.trim} window={win}
              mediaBaseUrl={mediaBaseUrl} onTrim={onTrim}
            />
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

          {chosen && (
            <BeatTrim
              beat={beat} chosen={chosen} trim={entry?.trim} window={win}
              mediaBaseUrl={mediaBaseUrl} onTrim={onTrim}
            />
          )}
        </>
      )}
    </div>
  )
}

export default function FootagePicker({ script, footage, providers, providerErrors, job, agentOnline, mediaBaseUrl, onSearchAll, onSearch, onChoose, onCapture, onListCaptures, onReuseCapture, onForgetCapture, onTrim, onApprove, busy }) {
  const beats = script?.script?.beats ?? []

  if (beats.length === 0) {
    return <p className="text-sm text-slate-500 py-6 text-center">Write a script first.</p>
  }

  const stockBeats = beats.filter(b => b.visual?.kind !== 'capture')
  const chosenCount = stockBeats.filter(b => footage?.[b.id]?.chosen).length
  const ready = stockBeats.length > 0 && chosenCount === stockBeats.length

  const off = Object.entries(providers || {}).filter(([, on]) => !on).map(([n]) => n)
  // A key that is set but rejected reads as configured and returns nothing, so
  // it needs saying separately from one that was never set up.
  const failing = Object.entries(providerErrors || {})
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
          {off.includes('library') && ' The library is empty - drop clips into public/video/broll/ and list them in library.json.'}
        </p>
      )}

      {failing.length > 0 && (
        <p className="text-xs text-rose-700 bg-rose-100 border border-rose-200 rounded-lg px-2.5 py-1.5">
          Configured but returning nothing: {failing.map(([n, why]) => `${n} (${why})`).join(', ')}.
          Results below are missing everything these sources would have found.
        </p>
      )}

      <div className="space-y-2">
        {beats.map((b, i) => (
          <BeatRow
            key={b.id}
            beat={b}
            index={i}
            entry={footage?.[b.id]}
            window={beatWindow(script, b.id)}
            mediaBaseUrl={mediaBaseUrl}
            onSearch={onSearch}
            onChoose={onChoose}
            onCapture={onCapture}
            onListCaptures={onListCaptures}
            onReuseCapture={onReuseCapture}
            onForgetCapture={onForgetCapture}
            onTrim={onTrim}
            job={job}
            agentOnline={agentOnline}
            busy={busy}
          />
        ))}
      </div>
    </div>
  )
}
