import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { useAppTutorial } from '../../context/AppTutorialContext'
import TutorialPickerModal from '../../components/admin/TutorialPickerModal'

// Default shape for a freshly added step.
const EMPTY_STEP = {
  emoji: '✨',
  title: '',
  body: '',
  guestBody: '',
  highlightSelector: '',
  highlightPage: '',
  advanceOnTargetClick: true,
  showToGuests: true,
}

// Tutorials editor — replaces the old text-only override flow with a full
// step-CRUD editor sourced from /api/admin/tutorials. Each tutorial is a
// collapsible accordion with add/remove/reorder controls and a per-step
// highlight selector + element picker. Inline mini-tutorials (pathway swipe,
// post-quiz nudge, etc.) are listed but not editable in detail.
export default function TutorialsEditor({ API, ConfirmModal, Toast, CollapsibleBox }) {
  const { apiFetch } = useAuth()
  const { refreshTutorials } = useAppTutorial() ?? {}

  const [tutorials,    setTutorials]    = useState([])  // [{ tutorialId, name, inline, showToGuests, steps }]
  const [drafts,       setDrafts]       = useState({})  // { tutorialId: { steps, showToGuests } }
  const [expanded,     setExpanded]     = useState(null) // tutorialId currently open
  const [saving,       setSaving]       = useState(false) // true while batch save in flight
  const [confirmOpen,  setConfirmOpen]  = useState(false) // batch-save reason capture
  const [pickerFor,    setPickerFor]    = useState(null) // { tutorialId, stepIndex } when picker open
  const [toast,        setToast]        = useState('')

  const load = useCallback(() => {
    apiFetch(`${API}/api/admin/tutorials`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        const list = d?.data?.tutorials ?? []
        setTutorials(list)
        // Seed drafts from server payload (deep-clone so edits don't mutate fetched copy)
        const fresh = {}
        for (const t of list) {
          fresh[t.tutorialId] = {
            steps:        JSON.parse(JSON.stringify(t.steps ?? [])),
            showToGuests: t.showToGuests !== false,
          }
        }
        setDrafts(fresh)
      })
      .catch(() => setToast('✗ Failed to load tutorials'))
  }, [API, apiFetch])

  useEffect(() => { load() }, [load])

  // ── Tutorial-level mutations ───────────────────────────────────────
  function setTutorialField(tutorialId, field, value) {
    setDrafts(prev => ({
      ...prev,
      [tutorialId]: { ...(prev[tutorialId] ?? { steps: [], showToGuests: true }), [field]: value },
    }))
  }

  // ── Step mutations ─────────────────────────────────────────────────
  function setStepField(tutorialId, idx, field, value) {
    setDrafts(prev => {
      const draft = prev[tutorialId] ?? { steps: [], showToGuests: true }
      const steps = (draft.steps ?? []).map((s, i) =>
        i === idx ? { ...s, [field]: value } : s
      )
      return { ...prev, [tutorialId]: { ...draft, steps } }
    })
  }

  function moveStep(tutorialId, idx, dir) {
    setDrafts(prev => {
      const draft = prev[tutorialId] ?? { steps: [], showToGuests: true }
      const steps = [...(draft.steps ?? [])]
      const target = idx + dir
      if (target < 0 || target >= steps.length) return prev
      ;[steps[idx], steps[target]] = [steps[target], steps[idx]]
      return { ...prev, [tutorialId]: { ...draft, steps } }
    })
  }

  function removeStep(tutorialId, idx) {
    setDrafts(prev => {
      const draft = prev[tutorialId] ?? { steps: [], showToGuests: true }
      const steps = (draft.steps ?? []).filter((_, i) => i !== idx)
      return { ...prev, [tutorialId]: { ...draft, steps } }
    })
  }

  function addStep(tutorialId) {
    setDrafts(prev => {
      const draft = prev[tutorialId] ?? { steps: [], showToGuests: true }
      const route = guessRouteForTutorial(tutorialId)
      const steps = [...(draft.steps ?? []), { ...EMPTY_STEP, highlightPage: route }]
      return { ...prev, [tutorialId]: { ...draft, steps } }
    })
  }

  // ── Save flow ──────────────────────────────────────────────────────
  // Single batched save — one reason capture, then a parallel PUT for every
  // tutorial whose draft differs from the server copy. Lets the admin make
  // edits across multiple tutorials and persist them all in one click.
  async function confirmSave(reason) {
    const dirtyIds = tutorials
      .filter(t => !t.inline && dirty(t.tutorialId))
      .map(t => t.tutorialId)
    if (dirtyIds.length === 0) { setConfirmOpen(false); return }

    setSaving(true)
    const results = await Promise.all(dirtyIds.map(async (id) => {
      const draft = drafts[id] ?? { steps: [], showToGuests: true }
      try {
        const res = await apiFetch(`${API}/api/admin/tutorials/${encodeURIComponent(id)}`, {
          method: 'PUT', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            steps:        draft.steps ?? [],
            showToGuests: draft.showToGuests !== false,
            reason,
          }),
        })
        const data = await res.json()
        return { id, ok: data?.status === 'success', message: data?.message }
      } catch (e) {
        return { id, ok: false, message: e.message }
      }
    }))

    const failed = results.filter(r => !r.ok)
    if (failed.length === 0) {
      setToast(`✓ ${dirtyIds.length} tutorial${dirtyIds.length === 1 ? '' : 's'} saved`)
    } else {
      const names = failed.map(f => tutorials.find(t => t.tutorialId === f.id)?.name ?? f.id)
      setToast(`✗ Failed to save: ${names.join(', ')}`)
    }
    // Refresh server copies + bust runtime cache so new steps appear immediately
    load()
    refreshTutorials?.()
    setSaving(false)
    setConfirmOpen(false)
  }

  // ── Picker handshake ───────────────────────────────────────────────
  function openPicker(tutorialId, stepIndex) {
    const route = drafts[tutorialId]?.steps?.[stepIndex]?.highlightPage || guessRouteForTutorial(tutorialId)
    setPickerFor({ tutorialId, stepIndex, route })
  }
  function applyPickedSelector({ selector, page }) {
    if (!pickerFor) return
    const { tutorialId, stepIndex } = pickerFor
    setDrafts(prev => {
      const draft = prev[tutorialId] ?? { steps: [], showToGuests: true }
      const steps = (draft.steps ?? []).map((s, i) =>
        i === stepIndex ? { ...s, highlightSelector: selector, highlightPage: page || s.highlightPage } : s
      )
      return { ...prev, [tutorialId]: { ...draft, steps } }
    })
    setPickerFor(null)
  }

  // ── Render helpers ─────────────────────────────────────────────────
  const dirty = (tutorialId) => {
    const orig = tutorials.find(t => t.tutorialId === tutorialId)
    const original = { steps: orig?.steps ?? [], showToGuests: orig?.showToGuests !== false }
    const draft    = drafts[tutorialId] ?? { steps: [], showToGuests: true }
    return JSON.stringify(original) !== JSON.stringify({
      steps:        draft.steps,
      showToGuests: draft.showToGuests !== false,
    })
  }

  const dirtyCount = tutorials.filter(t => !t.inline && dirty(t.tutorialId)).length

  return (
    <CollapsibleBox
      bodyStyle={{ border: '1px solid #172236', background: '#0c1829' }}
      headerStyle={{ borderColor: '#172236', background: '#102040' }}
      headerContent={<>
        <h3 className="font-bold text-slate-800">Tutorials</h3>
        <p className="text-xs text-slate-400 ml-2">Click a tutorial to edit its steps. Steps with a highlight target are tinted amber.</p>
      </>}
    >
      <AnimatePresence>{toast && <Toast msg={toast} onClear={() => setToast('')} />}</AnimatePresence>
      {confirmOpen && (
        <ConfirmModal
          title={`Save ${dirtyCount} tutorial${dirtyCount === 1 ? '' : 's'}`}
          onConfirm={confirmSave}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
      {pickerFor && (
        <TutorialPickerModal
          route={pickerFor.route}
          onPick={applyPickedSelector}
          onCancel={() => setPickerFor(null)}
        />
      )}

      <div className="px-5 py-3 space-y-2">
        {tutorials.length === 0 && (
          <p className="text-sm text-slate-400 italic py-4">Loading tutorials…</p>
        )}
        {tutorials.map(t => {
          const isOpen        = expanded === t.tutorialId
          const draft         = drafts[t.tutorialId] ?? { steps: [], showToGuests: true }
          const steps         = draft.steps ?? []
          const guestsAllowed = draft.showToGuests !== false
          if (t.inline) {
            return (
              <div key={t.tutorialId} className="flex items-center justify-between py-2 border-b border-slate-800/50 last:border-0">
                <span className="text-sm font-semibold text-slate-700">{t.name}</span>
                <span className="text-xs text-slate-400 italic">inline visual hint — not editable here</span>
              </div>
            )
          }
          return (
            <div key={t.tutorialId} className="border-b border-slate-800/50 last:border-0">
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : t.tutorialId)}
                className="w-full flex items-center justify-between py-3 text-left"
              >
                <span className="text-sm font-semibold text-slate-700">
                  {t.name}
                  {!guestsAllowed && <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-slate-400 bg-slate-700/40 px-1.5 py-0.5 rounded">signed-in only</span>}
                  {dirty(t.tutorialId) && <span className="ml-2 text-amber-500 text-xs">● unsaved</span>}
                </span>
                <span className="text-slate-400 text-xs">
                  {isOpen ? '▲ collapse' : `${steps.length} step${steps.length === 1 ? '' : 's'} ▼`}
                </span>
              </button>
              {isOpen && (
                <div className="pb-4 space-y-3">
                  {/* Tutorial-level controls */}
                  <div className="rounded-xl bg-slate-800/30 border border-slate-700/50 px-3 py-2">
                    <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={guestsAllowed}
                        onChange={e => setTutorialField(t.tutorialId, 'showToGuests', e.target.checked)}
                        className="accent-brand-600"
                      />
                      <span><b>Show to guests</b> — when off, this tutorial only runs for signed-in users.</span>
                    </label>
                  </div>

                  {steps.map((step, idx) => (
                    <StepRow
                      key={idx}
                      step={step}
                      idx={idx}
                      total={steps.length}
                      tutorialAllowsGuests={guestsAllowed}
                      onChange={(field, value) => setStepField(t.tutorialId, idx, field, value)}
                      onMove={(dir) => moveStep(t.tutorialId, idx, dir)}
                      onRemove={() => removeStep(t.tutorialId, idx)}
                      onPick={() => openPicker(t.tutorialId, idx)}
                    />
                  ))}
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => addStep(t.tutorialId)}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800/60 transition-colors"
                    >
                      + Add step
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Single batched save — covers every dirty tutorial at once */}
      <div className="px-5 py-4 border-t border-slate-800/50 flex items-center justify-between gap-3">
        <p className="text-xs text-slate-400">
          {dirtyCount === 0
            ? 'No unsaved changes.'
            : `${dirtyCount} tutorial${dirtyCount === 1 ? '' : 's'} with unsaved changes.`}
        </p>
        <button
          type="button"
          disabled={dirtyCount === 0 || saving}
          onClick={() => setConfirmOpen(true)}
          className="px-5 py-2 text-sm font-bold rounded-xl bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving…' : `Save ${dirtyCount > 0 ? `(${dirtyCount})` : ''} changes`.trim()}
        </button>
      </div>
    </CollapsibleBox>
  )
}

// ── Single step row ─────────────────────────────────────────────────
function StepRow({ step, idx, total, tutorialAllowsGuests, onChange, onMove, onRemove, onPick }) {
  const hasHighlight = !!step.highlightSelector?.trim()
  const stepShowsGuests = step.showToGuests !== false
  const wrapperClass = [
    'rounded-xl p-3 border-l-4',
    hasHighlight
      ? 'border-amber-400/60 bg-amber-500/5'
      : 'border-slate-700/50 bg-slate-100',
  ].join(' ')

  return (
    <div className={wrapperClass}>
      {/* Header: position, reorder, remove */}
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-xl${step.emoji === '🔥' ? ' flame-blue' : ''}${step.emoji === '⭐' ? ' star-silver' : ''}`}>
          {step.emoji || '✨'}
        </span>
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Step {idx + 1}</span>
        {hasHighlight && (
          <span className="text-[10px] font-bold uppercase tracking-wide text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full">
            🎯 highlight
          </span>
        )}
        {!stepShowsGuests && (
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 bg-slate-700/30 px-2 py-0.5 rounded-full">
            signed-in only
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          <button
            type="button"
            disabled={idx === 0}
            onClick={() => onMove(-1)}
            className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Move step up"
          >▲</button>
          <button
            type="button"
            disabled={idx === total - 1}
            onClick={() => onMove(1)}
            className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Move step down"
          >▼</button>
          <button
            type="button"
            onClick={onRemove}
            className="w-7 h-7 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10"
            aria-label="Remove step"
          >×</button>
        </span>
      </div>

      {/* Text fields */}
      <div className="space-y-2">
        <div className="grid grid-cols-[80px_1fr] gap-2">
          <input
            type="text"
            value={step.emoji ?? ''}
            placeholder="✨"
            onChange={e => onChange('emoji', e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-200 bg-surface-raised text-slate-800 placeholder:text-slate-500"
          />
          <input
            type="text"
            value={step.title ?? ''}
            placeholder="Step title"
            onChange={e => onChange('title', e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-200 bg-surface-raised text-slate-800 placeholder:text-slate-500"
          />
        </div>
        <textarea
          rows={3}
          value={step.body ?? ''}
          placeholder="Step body — what the user sees in the tutorial card"
          onChange={e => onChange('body', e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm resize-none outline-none focus:ring-2 focus:ring-brand-200 bg-surface-raised text-slate-800 placeholder:text-slate-500"
        />
      </div>

      {/* Visibility */}
      <div className="mt-3 pt-3 border-t border-slate-200/40">
        <label className={`flex items-center gap-2 text-xs cursor-pointer ${tutorialAllowsGuests ? 'text-slate-700' : 'text-slate-400'}`}>
          <input
            type="checkbox"
            checked={stepShowsGuests}
            disabled={!tutorialAllowsGuests}
            onChange={e => onChange('showToGuests', e.target.checked)}
            className="accent-brand-600"
          />
          <span>
            <b>Show to guests</b>
            {!tutorialAllowsGuests && <span className="ml-1 italic">(disabled — whole tutorial is signed-in only)</span>}
          </span>
        </label>
      </div>

      {/* Highlight controls */}
      <div className="mt-3 pt-3 border-t border-slate-200/40">
        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Highlight</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={step.highlightSelector ?? ''}
            placeholder='CSS selector (e.g. [data-tutorial-target="play-grid"])'
            onChange={e => onChange('highlightSelector', e.target.value)}
            className="flex-1 min-w-[200px] border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-mono outline-none focus:ring-2 focus:ring-brand-200 bg-surface-raised text-slate-800 placeholder:text-slate-500"
          />
          <button
            type="button"
            onClick={onPick}
            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-700 hover:bg-slate-600 text-white"
          >
            🎯 Pick element
          </button>
          {hasHighlight && (
            <button
              type="button"
              onClick={() => { onChange('highlightSelector', ''); onChange('highlightPage', '') }}
              className="px-2 py-1 text-[11px] font-semibold text-red-400 hover:text-red-300"
            >
              Clear
            </button>
          )}
        </div>
        {hasHighlight && (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <input
              type="text"
              value={step.highlightPage ?? ''}
              placeholder="Highlight page (e.g. /play)"
              onChange={e => onChange('highlightPage', e.target.value)}
              className="flex-1 min-w-[160px] border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-mono outline-none focus:ring-2 focus:ring-brand-200 bg-surface-raised text-slate-800 placeholder:text-slate-500"
            />
            <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={step.advanceOnTargetClick !== false}
                onChange={e => onChange('advanceOnTargetClick', e.target.checked)}
                className="accent-brand-600"
              />
              Advance when user clicks target
            </label>
          </div>
        )}
      </div>
    </div>
  )
}

// Map a tutorialId to its likely default page. Only used to pre-fill the
// picker route + new step's highlightPage; admin can override either.
function guessRouteForTutorial(tutorialId) {
  const map = {
    home:                          '/',
    'learn-priority':              '/learn-priority',
    briefReader:                   '/',
    quiz:                          '/play',
    play:                          '/play',
    profile:                       '/profile',
    rankings:                      '/rankings',
    wheres_aircraft:               '/play/wta',
    caseFile_coldOpen:             '/case-files',
    caseFile_evidenceWall:         '/case-files',
    caseFile_actorInterrogations:  '/case-files',
    caseFile_decisionPoint:        '/case-files',
    caseFile_mapPredictive:        '/case-files',
    caseFile_phaseReveal:          '/case-files',
    caseFile_mapLive:              '/case-files',
    caseFile_debrief:              '/case-files',
  }
  return map[tutorialId] ?? '/'
}
