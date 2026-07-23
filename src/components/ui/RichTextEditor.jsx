import { useEffect, useRef } from 'react'

// Small WYSIWYG editor for update-notification bodies. Backed by a
// contentEditable div so the browser's native Ctrl+B / Ctrl+I / Ctrl+U work
// out of the box; the toolbar exposes the same commands plus text colour.
//
// Value is the raw editing HTML (a string); the display side sanitizes it
// before rendering, and saveDraft sanitizes before persisting, so this
// component deliberately does no sanitizing of its own — it just edits.
//
// The value→DOM sync only runs when the incoming value differs from what's
// already shown, so ordinary typing (which flows out via onChange and back in
// as `value`) never resets the caret to the start.

const PRESET_COLORS = ['#5baaff', '#ff6b6b', '#ffd166', '#22c55e', '#c084fc', '#ffffff']

export default function RichTextEditor({ value, onChange, ariaLabel, className = '' }) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.innerHTML !== (value || '')) el.innerHTML = value || ''
  }, [value])

  function emit() {
    const el = ref.current
    if (!el) return
    // A visually-empty editor (e.g. a lone <br> or zero-width space) counts as
    // empty so the "body is required" check behaves.
    const text = el.textContent.replace(/\u200B/g, '').trim()
    onChange(text === '' ? '' : el.innerHTML)
  }

  function exec(cmd, arg) {
    ref.current?.focus()
    document.execCommand(cmd, false, arg)
    emit()
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 mb-1.5">
        <ToolbarButton label="Bold (Ctrl+B)"      onClick={() => exec('bold')}><b>B</b></ToolbarButton>
        <ToolbarButton label="Italic (Ctrl+I)"    onClick={() => exec('italic')}><i>I</i></ToolbarButton>
        <ToolbarButton label="Underline (Ctrl+U)" onClick={() => exec('underline')}><u>U</u></ToolbarButton>
        <span className="w-px h-5 bg-slate-200 mx-0.5" />
        {PRESET_COLORS.map(c => (
          <button
            key={c}
            type="button"
            aria-label={`Text colour ${c}`}
            title={`Text colour ${c}`}
            onMouseDown={e => e.preventDefault()}
            onClick={() => exec('foreColor', c)}
            className="w-5 h-5 rounded-full border border-slate-300"
            style={{ backgroundColor: c }}
          />
        ))}
        <label
          className="relative w-5 h-5 rounded-full border border-slate-300 overflow-hidden cursor-pointer bg-gradient-to-br from-red-400 via-emerald-400 to-brand-500"
          title="Custom text colour"
          onMouseDown={e => e.preventDefault()}
        >
          <input
            type="color"
            aria-label="Custom text colour"
            onChange={e => exec('foreColor', e.target.value)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        </label>
        <span className="w-px h-5 bg-slate-200 mx-0.5" />
        <ToolbarButton label="Clear formatting" onClick={() => exec('removeFormat')}>✕</ToolbarButton>
      </div>
      <div
        ref={ref}
        role="textbox"
        aria-label={ariaLabel}
        aria-multiline="true"
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        className={className}
      />
    </div>
  )
}

function ToolbarButton({ label, onClick, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      // Keep the editor's text selection while the button is clicked, so the
      // command applies to the selected words rather than to nothing.
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      className="min-w-7 h-7 px-1.5 rounded-md border border-slate-200 bg-surface text-text text-sm leading-none hover:bg-slate-100"
    >
      {children}
    </button>
  )
}
