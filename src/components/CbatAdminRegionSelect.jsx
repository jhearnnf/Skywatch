// Admin-only tab beside the admin view toggle on the CBAT hub: see the hub and
// the Aptitude Report as a new player in another country would. Docks onto the
// Recent Scores card the same way CbatAdminViewToggle does, so the two read as
// one strip of admin chrome. See src/utils/cbatAdminRegion.js.
//
// A button and our own menu rather than a native <select>: the browser draws a
// native select's list itself, white and unstyled, on top of the dark theme.

import { useEffect, useRef, useState } from 'react'
import { useCbatAdminRegion, setCbatAdminRegion } from '../utils/cbatAdminRegion'
import { REGIONS, REGION_CODES } from '../data/cbatBatteries'

// "United Kingdom" is too long for a tab this size.
const SHORT = { GB: 'UK' }
const labelFor = (code) => (code ? (SHORT[code] ?? REGIONS[code].label) : 'Mine')
const OPTIONS = ['', ...REGION_CODES]

export default function CbatAdminRegionSelect() {
  const region = useCbatAdminRegion(true)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const tone = region ? 'text-amber-700' : 'text-slate-500 group-hover:text-slate-700'

  return (
    <div ref={wrapRef} className="relative z-20 -mb-px">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Simulate region"
        data-testid="cbat-admin-region"
        onClick={() => setOpen(o => !o)}
        title="See the CBAT page and the Aptitude Report as a new player in this country would."
        className="inline-flex items-center gap-1.5 px-2.5 py-1 cursor-pointer rounded-t-lg border border-b-0
          border-game-line bg-game-panel hover:bg-surface-raised transition-colors group"
      >
        <span className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">Region</span>
        <span className={`text-[10px] font-extrabold uppercase tracking-wide transition-colors ${tone}`}>{labelFor(region)}</span>
        <svg aria-hidden="true" viewBox="0 0 10 6" className={`w-2 h-1.5 transition-transform ${open ? 'rotate-180' : ''} ${tone}`}>
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Simulate region"
          className="absolute right-0 top-full mt-1 min-w-full py-1 rounded-lg border border-game-line bg-game-panel
            shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
        >
          {OPTIONS.map(code => {
            const selected = code === region
            return (
              <li key={code || 'mine'}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-testid={`cbat-admin-region-${code || 'mine'}`}
                  onClick={() => { setCbatAdminRegion(code); setOpen(false) }}
                  className={`w-full text-left px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-wide whitespace-nowrap transition-colors
                    ${selected ? 'text-brand-600 bg-brand-50' : 'text-slate-600 hover:text-slate-900 hover:bg-surface-raised'}`}
                >
                  {labelFor(code)}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
