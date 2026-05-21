import { useEffect, useMemo, useRef, useState, Suspense } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import useScenePlayer from './useScenePlayer'

// Tactical "window" frame — 16:9 viewport with corner brackets, scanlines and
// a title overlay that fades as the active scene changes. Generic — accepts a
// `scenes` array and renders each scene's Component for its duration.
//
// Props:
//  - eyebrow:   uppercase chip above the window (e.g. "INTEL BRIEF GAMES")
//  - heading:   bold subtitle ("Watch a preview")
//  - scenes:    [{ id, title, subtitle, durationMs, Component, accent }]
//               accent is an optional hex color used for the title underline.
//  - loop, autoplay: passed through to useScenePlayer.
export default function PreviewWindow({ eyebrow, heading, scenes, loop = true, autoplay = true, dataTestId }) {
  const scenesSafe = useMemo(() => Array.isArray(scenes) ? scenes : [], [scenes])
  const windowRef = useRef(null)
  // inView starts false so the timer doesn't start ticking on a window that's
  // below the fold — the IntersectionObserver flips it true when the user
  // scrolls it into view. This is what makes the second (CBAT) window
  // auto-start when the user reaches it, instead of silently burning scenes
  // off-screen during the initial page load. Environments without IO (SSR /
  // very old browsers) fall back to always-on.
  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const el = windowRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      // Generous threshold (10%) so the player kicks in just as the window
      // edges into view, with a small bottom rootMargin to start prefetching
      // scene chunks a touch before the user actually sees it.
      { threshold: 0.1, rootMargin: '0px 0px -10% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const { index, runKey, currentScene, isPaused, replay, togglePause, jumpTo, total } =
    useScenePlayer(scenesSafe, { loop, autoplay, inView })

  // Swipe-to-advance: track the starting touch X, and on touchend compare to
  // the final X. ≥40px horizontal motion (with vertical motion < that) counts
  // as a swipe — left advances, right goes back. Looping so swiping past the
  // ends wraps around, which matches the autoplay's loop=true default.
  const swipeRef = useRef({ x: 0, y: 0, t: 0 })
  const onTouchStart = (e) => {
    const t = e.touches[0]
    if (!t) return
    swipeRef.current = { x: t.clientX, y: t.clientY, t: Date.now() }
  }
  const onTouchEnd = (e) => {
    const start = swipeRef.current
    const t = e.changedTouches[0]
    if (!t || !start.t) return
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy)) {
      const dir = dx < 0 ? 1 : -1
      const next = (index + dir + total) % total
      jumpTo(next)
    }
  }

  if (total === 0) return null

  const Scene = currentScene?.Component

  return (
    <section className="py-8 sm:py-12 px-3 sm:px-5 max-w-5xl mx-auto" data-testid={dataTestId}>
      {/* Eyebrow + heading */}
      <div className="text-center mb-4 sm:mb-6">
        <div className="flex items-center justify-center gap-2 mb-2 sm:mb-3">
          <span className="intel-tag">{eyebrow}</span>
        </div>
        <h2 className="text-xl sm:text-3xl font-bold text-slate-900 mb-1 px-3">{heading}</h2>
      </div>

      {/* The window — taller (4:5) on phones so vertical scene content fits, 16:9 on desktop */}
      <div className="relative">
        <div
          ref={windowRef}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          className="relative rounded-2xl sm:rounded-3xl overflow-hidden mx-auto aspect-[4/5] sm:aspect-[16/9] touch-pan-y"
          style={{
            background:   '#06101e',
            border:       '1px solid rgba(91,170,255,0.25)',
            boxShadow:    '0 0 60px rgba(91,170,255,0.10), 0 20px 40px rgba(0,0,0,0.4)',
            maxWidth:     '960px',
          }}
        >
          {/* Corner brackets */}
          <CornerBracket pos="tl" />
          <CornerBracket pos="tr" />
          <CornerBracket pos="bl" />
          <CornerBracket pos="br" />

          {/* Scene canvas */}
          <div className="absolute inset-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={`scene-${index}-${runKey}`}
                initial={{ opacity: 0, scale: 1.02 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="absolute inset-0"
              >
                {Scene ? (
                  <Suspense fallback={<SceneSkeleton accent={currentScene?.accent} />}>
                    <Scene runKey={runKey} />
                  </Suspense>
                ) : null}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Title overlay (top center) */}
          <AnimatePresence mode="wait">
            {currentScene?.title && (
              <motion.div
                key={`title-${currentScene.id}-${runKey}`}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.4 }}
                className="absolute top-2.5 sm:top-6 left-1/2 -translate-x-1/2 z-20 text-center pointer-events-none px-3 w-full"
              >
                <h3
                  className="font-extrabold tracking-widest text-xs sm:text-2xl uppercase"
                  style={{
                    color: currentScene.accent || '#ffffff',
                    textShadow: '0 2px 12px rgba(0,0,0,0.85), 0 0 24px rgba(91,170,255,0.35)',
                    letterSpacing: '0.15em',
                  }}
                >
                  {currentScene.title}
                </h3>
                {currentScene.subtitle && (
                  <p
                    className="text-[10px] sm:text-xs text-slate-800 intel-mono mt-1"
                    style={{
                      textShadow:
                        '0 1px 2px rgba(0,0,0,0.95), 0 0 10px rgba(0,0,0,0.85), 0 0 22px rgba(0,0,0,0.6)',
                    }}
                  >
                    {currentScene.subtitle}
                  </p>
                )}
                {/* Underline */}
                <div
                  className="mx-auto mt-2 h-[2px] rounded-full"
                  style={{
                    width: 60,
                    background: `linear-gradient(90deg, transparent, ${currentScene.accent || '#5baaff'}, transparent)`,
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Vignette */}
          <div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'radial-gradient(ellipse 70% 60% at 50% 50%, transparent 50%, rgba(0,0,0,0.55) 100%)',
              zIndex: 15,
            }}
          />

          {/* Scanlines */}
          <div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.16) 2px, rgba(0,0,0,0.16) 3px)',
              zIndex: 16,
              mixBlendMode: 'multiply',
            }}
          />

          {/* Progress dots — clickable */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5">
            {scenesSafe.map((s, i) => {
              const isActive = i === index
              return (
                <button
                  key={s.id}
                  onClick={() => jumpTo(i)}
                  aria-label={`Jump to ${s.title ?? s.id}`}
                  className="block rounded-full transition-all"
                  style={{
                    width:      isActive ? 22 : 7,
                    height:     7,
                    background: isActive ? (s.accent || '#5baaff') : 'rgba(255,255,255,0.35)',
                    boxShadow:  isActive ? `0 0 8px ${s.accent || '#5baaff'}` : 'none',
                    cursor:     'pointer',
                  }}
                />
              )
            })}
          </div>

          {/* Replay / pause controls — bottom right */}
          <div className="absolute bottom-3 right-3 z-30 flex items-center gap-1.5">
            <button
              type="button"
              onClick={togglePause}
              aria-label={isPaused ? 'Play preview' : 'Pause preview'}
              className="w-8 h-8 rounded-full flex items-center justify-center bg-black/40 hover:bg-black/60 border border-white/15 text-white text-xs transition-colors"
            >
              {isPaused ? '▶' : '❚❚'}
            </button>
            <button
              type="button"
              onClick={replay}
              aria-label="Replay preview from the start"
              className="w-8 h-8 rounded-full flex items-center justify-center bg-black/40 hover:bg-black/60 border border-white/15 text-white text-xs transition-colors"
            >
              ↻
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

function SceneSkeleton({ accent = '#5baaff' }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div
        className="intel-mono"
        style={{
          fontSize: 10,
          color: accent,
          letterSpacing: '0.2em',
          fontWeight: 700,
          opacity: 0.6,
        }}
      >
        LOADING…
      </div>
    </div>
  )
}

function CornerBracket({ pos }) {
  const corner = {
    tl: { top: 10,    left: 10,    borderTop: '2px solid #5baaff', borderLeft:  '2px solid #5baaff' },
    tr: { top: 10,    right: 10,   borderTop: '2px solid #5baaff', borderRight: '2px solid #5baaff' },
    bl: { bottom: 10, left: 10,    borderBottom: '2px solid #5baaff', borderLeft:  '2px solid #5baaff' },
    br: { bottom: 10, right: 10,   borderBottom: '2px solid #5baaff', borderRight: '2px solid #5baaff' },
  }[pos]
  return (
    <span
      aria-hidden="true"
      className="absolute pointer-events-none"
      style={{
        width: 16,
        height: 16,
        opacity: 0.55,
        zIndex: 17,
        ...corner,
      }}
    />
  )
}
