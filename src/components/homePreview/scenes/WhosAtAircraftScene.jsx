import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import RafBasesMap from '../../RafBasesMap'

// Mobile breakpoint matches the project's 600px convention.
const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 600px)').matches

// Mirrors the real WhereAircraftGame two-round flow:
//   Round 1: "ROUND 1 OF 2" eyebrow → "Identify the Aircraft" heading →
//            a REAL aircraft cutout fetched from /api/briefs/aircraft-cutouts
//            → 5 vertical answer buttons.
//   Round 2: "ROUND 2 OF 2" → "Find the Home Base" → the actual RafBasesMap
//            component (Leaflet with OSM tiles) zoomed to RAF Coningsby →
//            amber selected-base pill → red "Confirm Selection →" CTA.

// Module-level cache so we only fetch once per page visit, no matter how
// many times the scene re-mounts as the preview window loops.
let cachedCutout = null
let cachedCutoutPromise = null

function getApiBase() {
  return import.meta.env.VITE_API_URL || 'http://localhost:5000'
}

function loadRandomCutout() {
  if (cachedCutout) return Promise.resolve(cachedCutout)
  if (cachedCutoutPromise) return cachedCutoutPromise
  cachedCutoutPromise = fetch(`${getApiBase()}/api/briefs/aircraft-cutouts`)
    .then(r => r.ok ? r.json() : null)
    .then(j => {
      const pool = j?.data?.cutouts ?? []
      if (pool.length === 0) return null
      const pick = pool[Math.floor(Math.random() * pool.length)]
      cachedCutout = pick
      return pick
    })
    .catch(() => null)
  return cachedCutoutPromise
}

// Distractor pool — we filter out any that match the real aircraft title.
const DISTRACTORS = [
  'Tornado GR4',
  'F-35B Lightning II',
  'Hawk T2',
  'Lancaster B I',
  'Voyager KC2',
  'Wildcat AH1',
  'Tempest',
  'Typhoon FGR4',
  'Chinook HC6',
  'Hercules C-130J',
]

export default function WhosAtAircraftScene({ runKey }) {
  const [phase, setPhase] = useState('r1')
  const [pickedId, setPickedId] = useState(null)
  const [pickedBase, setPickedBase] = useState(null)
  const [submitted, setSubmitted] = useState(false)
  const [cutout, setCutout] = useState(cachedCutout)

  useEffect(() => {
    let aborted = false
    if (!cachedCutout) {
      loadRandomCutout().then(c => {
        if (!aborted && c) setCutout(c)
      })
    }
    return () => { aborted = true }
  }, [])

  const correctTitle = cutout?.title ?? 'Typhoon FGR4'
  const distractors = DISTRACTORS
    .filter(t => t.toLowerCase() !== correctTitle.toLowerCase())
    .slice(0, 4)
  const OPTIONS = [
    { id: 'correct', name: correctTitle, isCorrect: true },
    ...distractors.map((t, i) => ({ id: `d${i}`, name: t, isCorrect: false })),
  ]
  // Deterministic shuffle so the correct option isn't always first
  const seed = (correctTitle || '').length
  const shuffled = [...OPTIONS].sort((a, b) => {
    const ah = (a.name.charCodeAt(0) + seed) % 11
    const bh = (b.name.charCodeAt(0) + seed) % 11
    return ah - bh
  })

  useEffect(() => {
    setPhase('r1'); setPickedId(null); setPickedBase(null); setSubmitted(false)
    const t1 = setTimeout(() => setPickedId('correct'), 1000)
    const t2 = setTimeout(() => setPhase('r2'),         2000)
    const t3 = setTimeout(() => setPickedBase('home'),  3100)
    const t4 = setTimeout(() => setSubmitted(true),     3900)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4) }
  }, [runKey])

  return (
    <div className="absolute inset-0 overflow-hidden flex items-center justify-center">
      {/* Backdrop — subtle red mood */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at 50% 60%, rgba(239,68,68,0.10), transparent 70%), #06101e',
        }}
      />

      <AnimatePresence mode="wait">
        {phase === 'r1' && (
          <motion.div
            key="r1"
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -18 }}
            transition={{ duration: 0.3 }}
            className="bg-surface rounded-2xl border border-slate-200 card-shadow"
            style={{
              width: 300, maxWidth: '90%',
              padding: isMobile ? 10 : 16,
              marginTop: isMobile ? 22 : 30,
              position: 'relative', zIndex: 5,
            }}
          >
            <p className="intel-mono" style={{ fontSize: 8, color: '#ef4444', fontWeight: 800, letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 2 }}>
              Round 1 of 2
            </p>
            <h3 className="font-extrabold text-slate-900" style={{ fontSize: isMobile ? 12 : 14, marginBottom: 2 }}>Identify the Aircraft</h3>
            <p className="text-slate-600" style={{ fontSize: 9, marginBottom: 8 }}>
              Select the correct aircraft name from the options below.
            </p>

            {/* Real aircraft cutout */}
            <div
              className="rounded-xl overflow-hidden mb-3 relative flex items-center justify-center"
              style={{
                aspectRatio: '16 / 9',
                background: 'linear-gradient(135deg, #1e3a5a 0%, #0a1628 100%)',
                border: '1px solid rgba(91,170,255,0.2)',
              }}
            >
              {cutout?.cutoutUrl ? (
                <img
                  src={cutout.cutoutUrl}
                  alt={cutout.title}
                  draggable={false}
                  style={{
                    maxWidth: '88%',
                    maxHeight: '88%',
                    objectFit: 'contain',
                    filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.5))',
                  }}
                />
              ) : (
                <motion.span
                  animate={{ opacity: [0.4, 0.8, 0.4] }}
                  transition={{ duration: 1.4, repeat: Infinity }}
                  className="intel-mono"
                  style={{ fontSize: 9, color: '#5baaff', letterSpacing: '0.2em', fontWeight: 700 }}
                >
                  RECON IMAGE LOADING…
                </motion.span>
              )}
            </div>

            {/* Answer buttons */}
            <div className="space-y-1.5">
              {shuffled.map(opt => {
                const isThis = opt.id === pickedId
                const isCorrect = opt.isCorrect
                const answered = pickedId !== null
                let state = 'idle'
                if (answered) {
                  if (isCorrect)    state = 'correct'
                  else if (isThis)  state = 'wrong'
                }
                return (
                  <motion.div
                    key={opt.id}
                    animate={state === 'correct' ? { x: [0, -4, 4, -2, 2, 0] } : {}}
                    transition={{ duration: 0.35 }}
                    style={{ fontSize: 10 }}
                    className={`w-full text-left p-2 rounded-xl border-2 font-semibold flex items-center gap-2 transition-all
                      ${state === 'correct' ? 'bg-emerald-50 border-emerald-500 text-emerald-800' :
                        state === 'wrong'   ? 'bg-red-50 border-red-400 text-red-700' :
                        answered            ? 'bg-slate-50 border-slate-200 text-slate-400' :
                                              'bg-surface border-slate-200 text-slate-800'
                      }`}
                  >
                    <span
                      style={{ width: 16, height: 16, fontSize: 9 }}
                      className={`rounded-full border-2 flex items-center justify-center shrink-0 text-white font-bold
                        ${state === 'correct' ? 'bg-emerald-500 border-emerald-500' :
                          state === 'wrong'   ? 'bg-red-400 border-red-400' :
                          answered            ? 'border-slate-200' :
                                                'border-slate-300'
                        }`}
                    >
                      {state === 'correct' ? '✓' : state === 'wrong' ? '✗' : ''}
                    </span>
                    {opt.name}
                  </motion.div>
                )
              })}
            </div>
          </motion.div>
        )}

        {phase === 'r2' && (
          <motion.div
            key="r2"
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.35 }}
            className="bg-surface rounded-2xl border border-slate-200 card-shadow"
            style={{
              width: 300, maxWidth: '90%',
              padding: isMobile ? 10 : 16,
              marginTop: isMobile ? 22 : 30,
              position: 'relative', zIndex: 5,
            }}
          >
            <p className="intel-mono" style={{ fontSize: 8, color: '#ef4444', fontWeight: 800, letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 2 }}>
              Round 2 of 2
            </p>
            <h3 className="font-extrabold text-slate-900" style={{ fontSize: isMobile ? 12 : 14, marginBottom: 2 }}>Find the Home Base</h3>
            <p className="text-slate-600" style={{ fontSize: 9, marginBottom: 8 }}>
              Select the RAF base where{' '}
              <span className="font-semibold text-slate-800">{correctTitle}</span> is based.
            </p>

            {/* Real Leaflet map — same component the game uses */}
            <div className="mb-2 [&_.leaflet-control-zoom]:!hidden">
              <RafBasesMap
                mode="view"
                height={isMobile ? 130 : 160}
                highlightedBaseNames={['RAF Coningsby']}
              />
            </div>

            {/* Selected base pill */}
            <div style={{ minHeight: 22, marginBottom: 8 }}>
              {pickedBase ? (
                <span
                  className="font-semibold inline-block rounded-full"
                  style={{
                    fontSize: 9,
                    background: submitted ? 'rgb(220 252 231)' : 'rgb(254 243 199)',
                    color:      submitted ? '#065f46'          : '#92400e',
                    border:     `1px solid ${submitted ? '#86efac' : '#fcd34d'}`,
                    padding: '3px 8px',
                  }}
                >
                  RAF Coningsby{submitted && ' ✓'}
                </span>
              ) : (
                <span className="text-slate-500" style={{ fontSize: 9 }}>Tap a base on the map to select it.</span>
              )}
            </div>

            {/* Confirm button */}
            <div
              className="rounded-xl font-bold text-center"
              style={{
                background: submitted ? '#ef4444' : pickedBase ? '#dc2626' : '#f1f5f9',
                color: pickedBase || submitted ? '#fff' : '#94a3b8',
                padding: '7px 0',
                fontSize: 10,
                letterSpacing: '0.04em',
                boxShadow: pickedBase || submitted ? '0 6px 14px rgba(220,38,38,0.35)' : 'none',
                transition: 'all 0.2s',
              }}
            >
              {submitted ? '✓ Mission Complete' : 'Confirm Selection →'}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
