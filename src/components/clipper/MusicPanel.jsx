import { useState, useEffect, useCallback, useRef } from 'react'

// Stage — the bed the whole video sits on.
//
// One track per video, chosen from a library rather than searched per video.
// Same reasoning as the SFX catalogue: a recurring bed is part of what makes a
// channel recognisable, and a different track every time works against that.
// Search exists to FILL the library, not to pick per video.
//
// Only CC0 and public-domain results can be imported. Those ask nothing of us —
// no credit, no share-alike, no non-commercial limit — so a published video
// never carries an obligation nobody remembers agreeing to. The licence is
// shown on every row precisely so it stays a visible fact rather than an
// assumption.
//
// Levels live on the script, not the track: the same bed sits differently under
// a busy read than a sparse one.

const fmtDuration = (ms) => (ms ? `${Math.round(ms / 1000)}s` : '—');
const pct = (v) => `${Math.round((v ?? 0) * 100)}%`;

function TrackRow({ track, chosen, playing, onPlay, onChoose, onDelete, busy }) {
  return (
    <div className={`flex flex-wrap items-center gap-2 border rounded-lg px-3 py-2 ${
      chosen ? 'border-brand-600 bg-brand-100' : 'border-slate-200 bg-slate-50'
    }`}>
      <div className="flex-1 min-w-[12rem]">
        <p className="text-sm text-slate-700 truncate">{track.title}</p>
        <p className="text-[11px] text-slate-500 truncate">
          {track.creator ? `${track.creator} · ` : ''}{track.licence}
          {track.sourceUrl && (
            <>
              {' · '}
              <a href={track.sourceUrl} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
                source
              </a>
            </>
          )}
        </p>
      </div>

      <span className="text-xs text-slate-500 font-mono">{fmtDuration(track.durationMs)}</span>

      <button
        type="button"
        onClick={() => onPlay(track)}
        className="px-2 py-0.5 rounded-lg border border-brand-200 text-brand-600 text-xs font-semibold hover:bg-brand-100 transition-colors"
      >
        {playing ? 'Stop' : 'Play'}
      </button>

      <button
        type="button"
        onClick={() => onChoose(chosen ? null : track.slug)}
        disabled={busy}
        className={`px-2 py-0.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 ${
          chosen
            ? 'bg-brand-600 text-white hover:bg-brand-500'
            : 'border border-slate-200 text-slate-600 hover:bg-slate-100'
        }`}
      >
        {chosen ? 'Using' : 'Use'}
      </button>

      <button
        type="button"
        onClick={() => onDelete(track.slug)}
        disabled={busy}
        className="text-xs text-slate-500 font-semibold hover:underline disabled:opacity-40 disabled:no-underline"
      >
        Remove
      </button>
    </div>
  )
}

function ResultRow({ result, playing, onPlay, onImport, busy }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border border-slate-200 rounded-lg bg-slate-50 px-3 py-2">
      <div className="flex-1 min-w-[12rem]">
        <p className="text-sm text-slate-700 truncate">{result.title}</p>
        <p className="text-[11px] text-slate-500 truncate">
          {result.creator ? `${result.creator} · ` : ''}
          <span className="text-emerald-700 font-semibold">{result.licence}</span>
          {result.upstream ? ` · ${result.upstream}` : ''}
        </p>
      </div>

      <span className="text-xs text-slate-500 font-mono">{fmtDuration(result.durationMs)}</span>

      <button
        type="button"
        onClick={() => onPlay(result)}
        className="px-2 py-0.5 rounded-lg border border-brand-200 text-brand-600 text-xs font-semibold hover:bg-brand-100 transition-colors"
      >
        {playing ? 'Stop' : 'Play'}
      </button>

      <button
        type="button"
        onClick={() => onImport(result)}
        disabled={busy || result.imported}
        className="px-2 py-0.5 rounded-lg bg-brand-600 text-white text-xs font-semibold hover:bg-brand-500 transition-colors disabled:opacity-40"
      >
        {result.imported ? 'In library' : 'Add'}
      </button>
    </div>
  )
}

export default function MusicPanel({ script, call, onChanged, busy }) {
  const music = script?.music ?? null

  const [library, setLibrary] = useState([])
  const [term, setTerm] = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState(null)
  const [working, setWorking] = useState(false)

  const audioRef = useRef(null)
  const [playingSrc, setPlayingSrc] = useState(null)

  const loadLibrary = useCallback(async () => {
    try {
      const data = await call('/music/library')
      setLibrary(data.tracks)
    } catch (e) { setError(e.message) }
  }, [call])

  useEffect(() => { loadLibrary() }, [loadLibrary])

  const play = useCallback((src) => {
    const el = audioRef.current
    if (!el) return
    if (playingSrc === src) { el.pause(); setPlayingSrc(null); return }
    el.src = src
    el.play().then(() => setPlayingSrc(src)).catch(() => setPlayingSrc(null))
  }, [playingSrc])

  const run = useCallback(async (fn) => {
    setWorking(true); setError(null)
    try { await fn() } catch (e) { setError(e.message) } finally { setWorking(false) }
  }, [])

  const search = () => run(async () => {
    setSearching(true)
    try {
      const data = await call(`/music/search?q=${encodeURIComponent(term)}`)
      setResults(data.results)
    } finally { setSearching(false) }
  })

  const disabled = busy || working

  return (
    <div className="space-y-4">
      <audio ref={audioRef} onEnded={() => setPlayingSrc(null)} className="hidden" />

      {error && (
        <p className="text-xs text-rose-700 bg-rose-100 border border-rose-200 rounded-lg px-2.5 py-1.5">
          {error}
        </p>
      )}

      {/* ── Levels for this video ──────────────────────────────────────────── */}
      {music && (
        <div className="border border-slate-200 rounded-xl bg-slate-50 p-3 space-y-2">
          <p className="text-sm text-slate-700">
            Using <span className="font-semibold">{music.title}</span>
            <span className="text-xs text-slate-500"> · {music.licence}</span>
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs text-slate-600">
              Level {pct(music.volume ?? 0.18)}
              <input
                type="range" min="0" max="0.6" step="0.01"
                value={music.volume ?? 0.18}
                onChange={e => onChanged({ volume: Number(e.target.value) })}
                className="w-full"
              />
            </label>
            <label className="text-xs text-slate-600">
              Under narration {pct(music.duckVolume ?? 0.06)}
              <input
                type="range" min="0" max="0.3" step="0.01"
                value={music.duckVolume ?? 0.06}
                onChange={e => onChanged({ duckVolume: Number(e.target.value) })}
                className="w-full"
              />
            </label>
            <label className="text-xs text-slate-600">
              Fade out {((music.fadeOutMs ?? 1500) / 1000).toFixed(1)}s
              <input
                type="range" min="0" max="4000" step="100"
                value={music.fadeOutMs ?? 1500}
                onChange={e => onChanged({ fadeOutMs: Number(e.target.value) })}
                className="w-full"
              />
            </label>
          </div>

          <p className="text-[11px] text-slate-500">
            The track loops to cover the video and drops to the lower level whenever anyone is
            speaking, so the voice stays on top. On a video that is narrated end to end that means
            the lower level is what you hear throughout &mdash; the higher one applies to the gaps,
            such as an end card with no voice over it.
          </p>
        </div>
      )}

      {/* ── Library ────────────────────────────────────────────────────────── */}
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
          Library
        </p>
        {library.length === 0 ? (
          <p className="text-sm text-slate-500 py-5 text-center border border-dashed border-slate-200 rounded-xl">
            No tracks yet. Search below, or drop your own files in
            <code className="mx-1 px-1 rounded bg-slate-100 text-slate-700">public/sounds/music/</code>.
          </p>
        ) : (
          <div className="space-y-1.5">
            {library.map(t => (
              <TrackRow
                key={t.slug}
                track={t}
                chosen={music?.slug === t.slug}
                playing={playingSrc === `/${t.src}`}
                busy={disabled}
                onPlay={() => play(`/${t.src}`)}
                onChoose={(slug) => onChanged({ slug })}
                onDelete={(slug) => run(async () => {
                  await call(`/music/${slug}`, { method: 'DELETE' })
                  await loadLibrary()
                })}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Search ─────────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            value={term}
            onChange={e => setTerm(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && term.trim()) search() }}
            placeholder="search CC0 music - e.g. dark cinematic loop"
            className="flex-1 px-2.5 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-sm text-slate-800"
          />
          <button
            type="button"
            onClick={search}
            disabled={disabled || !term.trim()}
            className="px-3 py-1.5 rounded-lg border border-brand-200 text-brand-600 text-xs font-semibold hover:bg-brand-100 transition-colors disabled:opacity-40"
          >
            {searching ? 'Searching…' : 'Search'}
          </button>
        </div>

        <p className="text-[11px] text-slate-500">
          CC0 and public domain only. Those require no credit, so nothing you publish carries an
          attribution obligation.
        </p>

        {results && (results.length === 0 ? (
          <p className="text-xs text-slate-500">Nothing CC0 matched those words.</p>
        ) : (
          <div className="space-y-1.5">
            {results.map(r => (
              <ResultRow
                key={r.providerId}
                result={r}
                playing={playingSrc === r.downloadUrl}
                busy={disabled}
                onPlay={() => play(r.downloadUrl)}
                onImport={(candidate) => run(async () => {
                  await call('/music/import', {
                    method: 'POST', body: JSON.stringify({ candidate }),
                  })
                  setResults(rs => rs.map(x =>
                    x.providerId === candidate.providerId ? { ...x, imported: true } : x))
                  await loadLibrary()
                })}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
