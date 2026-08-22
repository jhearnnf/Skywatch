import { useState, useEffect } from 'react'

// Stage 4 — caption timing and styling.
//
// Word timings are measured, never typed: whisper reports when each word was
// spoken and the backend aligns that to the script. So there is no "edit the
// timing" control here by design. What IS editable is how captions look, which
// is the part that actually varies between videos.

// Sizes are in composition pixels against a 1920-tall frame, so 100px is 5.2%
// of the height. That band is where short-form captions actually sit; the old
// presets ran 58-76px, which measured out at 3-4% and read as small on a phone
// even though it looked fine in the preview.
//
// bottomPct is kept at 34 and above for the same class of reason: below about
// 30 the caption collides with the username, caption and CTA the platform draws
// over the video, and none of that furniture exists in the preview.
const PRESETS = {
  bold: { label: 'Bold white', style: { fontSize: 100, uppercase: true, color: '#fff', activeColor: '#ffd84d', strokeWidth: 13, strokeColor: '#000', bottomPct: 36 } },
  brand: { label: 'Brand blue', style: { fontSize: 96, uppercase: true, color: '#ddeaf8', activeColor: '#5baaff', strokeWidth: 11, strokeColor: '#06101e', bottomPct: 36 } },
  subtle: { label: 'Subtle', style: { fontSize: 84, uppercase: false, color: '#fff', activeColor: '#ffd84d', strokeWidth: 9, strokeColor: '#000', bottomPct: 34 } },
}

export default function CaptionStyler({ script, job, agentOnline, onGenerate, onSaveStyle, onApprove, busy }) {
  const captions = script?.captions
  const [style, setStyle] = useState(captions?.style ?? PRESETS.bold.style)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (captions?.style && Object.keys(captions.style).length) {
      setStyle(captions.style)
      setDirty(false)
    }
  }, [script?._id])

  const running = job && (job.status === 'queued' || job.status === 'claimed')
  const words = captions?.words ?? []
  const hasVoice = (script?.voice?.lines?.length ?? 0) > 0

  const set = (k, v) => { setStyle(s => ({ ...s, [k]: v })); setDirty(true) }
  const applyPreset = (p) => { setStyle(PRESETS[p].style); setDirty(true) }

  return (
    <div className="space-y-4">
      {!hasVoice && (
        <p className="text-xs text-amber-700 bg-amber-100 border border-amber-200 rounded-lg px-2.5 py-1.5">
          Record the narration first - caption timing is measured against it.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onGenerate}
          disabled={busy || running || !agentOnline || !hasVoice}
          className="px-3 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-500 transition-colors disabled:opacity-40"
        >
          {running ? 'Timing…' : words.length ? 'Re-time captions' : 'Generate captions'}
        </button>

        {dirty && (
          <button
            type="button"
            onClick={() => { onSaveStyle(style); setDirty(false) }}
            disabled={busy}
            className="px-3 py-2 rounded-xl border border-brand-200 text-brand-600 text-sm font-semibold hover:bg-brand-100 transition-colors disabled:opacity-50"
          >
            Save style
          </button>
        )}

        {words.length > 0 && !dirty && (
          <button
            type="button"
            onClick={onApprove}
            disabled={busy}
            className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500 transition-colors disabled:opacity-40"
          >
            Approve captions
          </button>
        )}

        {words.length > 0 && (
          <span className="text-xs text-slate-500 ml-auto">
            {words.length} words timed{captions?.model ? ` · ${captions.model}` : ''}
          </span>
        )}
      </div>

      {running && (
        <div className="space-y-1">
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full bg-brand-600 transition-all duration-500" style={{ width: `${job.progress || 0}%` }} />
          </div>
          <p className="text-xs text-slate-500">{job.stepLabel || 'queued'}</p>
        </div>
      )}

      {job?.status === 'failed' && (
        <p className="text-xs text-rose-700 bg-rose-100 border border-rose-200 rounded-lg px-2.5 py-1.5">
          Caption timing failed: {job.error}
        </p>
      )}

      <div className="border border-slate-200 rounded-xl bg-slate-50 p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mr-1">Preset</span>
          {Object.entries(PRESETS).map(([k, p]) => (
            <button
              key={k}
              type="button"
              onClick={() => applyPreset(k)}
              className="px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-100 transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label className="text-xs text-slate-600">
            <span className="block font-semibold mb-1">Size</span>
            <input type="number" min={30} max={120} value={style.fontSize ?? 76}
              onChange={e => set('fontSize', Number(e.target.value))}
              className="w-full px-2 py-1 rounded-lg bg-slate-100 border border-slate-200 text-slate-800" />
          </label>
          <label className="text-xs text-slate-600">
            <span className="block font-semibold mb-1">Active word</span>
            <input type="color" value={style.activeColor ?? '#5baaff'}
              onChange={e => set('activeColor', e.target.value)}
              className="w-full h-8 rounded-lg bg-slate-100 border border-slate-200" />
          </label>
          <label className="text-xs text-slate-600">
            <span className="block font-semibold mb-1">Text</span>
            <input type="color" value={style.color ?? '#ffffff'}
              onChange={e => set('color', e.target.value)}
              className="w-full h-8 rounded-lg bg-slate-100 border border-slate-200" />
          </label>
          <label className="text-xs text-slate-600">
            <span className="block font-semibold mb-1">Height from bottom</span>
            <input type="number" min={5} max={60} value={style.bottomPct ?? 22}
              onChange={e => set('bottomPct', Number(e.target.value))}
              className="w-full px-2 py-1 rounded-lg bg-slate-100 border border-slate-200 text-slate-800" />
          </label>
        </div>

        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={style.uppercase ?? true}
            onChange={e => set('uppercase', e.target.checked)} />
          Uppercase
        </label>
      </div>

      {words.length > 0 && (
        <details className="text-xs text-slate-600">
          <summary className="cursor-pointer font-semibold text-brand-600">Measured timings</summary>
          <div className="mt-2 flex flex-wrap gap-1">
            {words.slice(0, 120).map((w, i) => (
              <span key={i} title={`${w.startMs}-${w.endMs}ms`}
                className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200">
                {w.text}
              </span>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
