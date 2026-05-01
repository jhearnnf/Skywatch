import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import SEO from '../components/SEO'

export const CBAT_GAMES = [
  { key: 'target',          emoji: '🎯', title: 'Target',           desc: 'Multi-task across eight panels — hunt shapes, match lights, ID aircraft, find codes.', path: '/cbat/target',          image: '/images/Target.png' },
  { key: 'ant',             emoji: '📡', title: 'ANT',              desc: 'Airborne Numerical Test — speed, distance and time. Compute arrival, distance, fuel or speed against the clock.', path: '/cbat/ant',             image: '/images/ANT.png' },
  { key: 'symbols',         emoji: '🔣', title: 'Symbols',          desc: 'Spot the target symbol in a growing grid, round by round.', path: '/cbat/symbols',         image: '/images/Symbols.png' },
  { key: 'code-duplicates', emoji: '🧩', title: 'Code Duplicates',  desc: 'Memorise a sequence of digits, then count how many times one appeared.', path: '/cbat/code-duplicates', image: '/images/Code Duplicates.png' },
  { key: 'angles',          emoji: '📐', title: 'Angles',           desc: 'Judge angles quickly and accurately.',                  path: '/cbat/angles',          image: '/images/Angles.png' },
  { key: 'instruments',     emoji: '🛫', title: 'Instruments',      desc: 'Read cockpit instruments under time pressure.',         path: '/cbat/instruments',     image: '/images/Instruments.png' },
  { key: 'plane-turn',      emoji: '🗺️', title: 'Plane Turn',       desc: 'Choose your aircraft, plan your turn and heading with precision.',            path: '/cbat/plane-turn',      image: '/images/Plane Turn.png' },
  { key: 'flag',             emoji: '🚩', title: 'FLAG',             desc: 'Track aircraft, answer maths and identification questions, hit target shapes — all in 60 seconds.', path: '/cbat/flag',            image: '/images/FLAG.png' },
  { key: 'audio-interrupt',  emoji: '🎧', title: 'Audio Interrupt',  desc: 'Respond to audio cues while multitasking.',             path: null,                    image: '/images/placeholder-brief.svg' },
  { key: 'dad',              emoji: '🧭', title: 'DAD',              desc: 'Directions and Distances — coming soon.',               path: null,                    image: '/images/placeholder-brief.svg' },
  { key: 'visualisation-3d', emoji: '🧊', title: 'Visualisation 3D', desc: 'Rotate and reason about 3D shapes — coming soon.',      path: null,                    image: '/images/placeholder-brief.svg' },
  { key: 'visualisation-2d', emoji: '🧮', title: 'Visualisation 2D', desc: 'Spatial reasoning with 2D figures — coming soon.',      path: null,                    image: '/images/placeholder-brief.svg' },
]

function CardBgImage({ game, delay = 0, isFlickering = false, dimmed = false }) {
  if (!game.image) return null
  return (
    <>
      {/* Radar-tinted background image — slow Ken Burns pan, alternating */}
      <img
        src={game.image}
        alt=""
        aria-hidden="true"
        draggable={false}
        data-testid={`card-bg-image-${game.key}`}
        className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none motion-reduce:![animation:none]"
        style={{
          filter:     'grayscale(1) brightness(0.85) blur(4px)',
          opacity:    dimmed ? 0.4 : 1,
          animation:  `cbat-img-pan 9s ease-in-out ${delay}s infinite alternate${isFlickering ? ', cbat-flicker 0.55s linear 1' : ''}`,
          willChange: 'transform',
          zIndex:     0,
        }}
      />
      {/* Brand-blue colour wash — forces consistent blue tint over greyscale image */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background:   '#5baaff',
          opacity:      0.45,
          mixBlendMode: 'color',
          zIndex:       1,
        }}
      />
      {/* Blue radial bloom — slow pulse */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none motion-reduce:![animation:none]"
        style={{
          background: 'radial-gradient(ellipse 80% 70% at 50% 50%, rgba(91,170,255,0.16) 0%, transparent 75%)',
          animation:  `cbat-bloom-pulse 4.5s ease-in-out ${delay * 0.4}s infinite`,
          zIndex:     2,
        }}
      />
      {/* Scanlines */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.18) 2px, rgba(0,0,0,0.18) 3px)',
          zIndex: 3,
        }}
      />
    </>
  )
}

const IMAGE_GAMES = CBAT_GAMES.filter(g => g.image)

export default function Cbat() {
  const { user } = useAuth()
  const [flickeringKey, setFlickeringKey] = useState(null)

  useEffect(() => {
    let tid
    function tick() {
      // wait 2–5s then flash one random image-card for 550ms
      tid = setTimeout(() => {
        const picked = IMAGE_GAMES[Math.floor(Math.random() * IMAGE_GAMES.length)]
        setFlickeringKey(picked.key)
        tid = setTimeout(() => {
          setFlickeringKey(null)
          tick()
        }, 550)
      }, 2000 + Math.random() * 3000)
    }
    tick()
    return () => clearTimeout(tid)
  }, [])

  return (
    <div className="cbat-page">
      <SEO title="CBAT Games" description="Practise for CBAT with targeted training games." />

      <h1 className="text-2xl font-extrabold text-slate-900 mb-1">CBAT Games</h1>
      <p className="text-sm text-slate-500 mb-6">Practise for CBAT with targeted training games.</p>

      {/* Lock card — shown when not signed in */}
      {!user && (
        <div className="bg-surface rounded-2xl border border-slate-200 p-6 mb-5 text-center card-shadow">
          <div className="text-4xl mb-3">🔒</div>
          <p className="font-bold text-slate-800 mb-1">Sign in to access CBAT Games</p>
          <p className="text-sm text-slate-500 mb-4">Create a free account to start practising.</p>
          <Link to="/login" className="inline-flex px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors">
            Sign In
          </Link>
        </div>
      )}

      {/* Game grid — blurred when not signed in */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4${!user ? ' opacity-40 pointer-events-none select-none blur-sm' : ''}`} style={{ rowGap: '2rem' }}>
        {CBAT_GAMES.map((game, i) => (
          <motion.div
            key={game.key}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06, duration: 0.35 }}
            className="h-full"
          >
            {game.path ? (
              <Link
                to={game.path}
                className="relative flex items-start gap-4 bg-surface rounded-2xl p-6 border border-slate-200 transition-all card-shadow cursor-pointer h-full min-h-[130px] w-full
                  hover:border-brand-300 hover:bg-brand-50 group hover:-translate-y-0.5 no-underline overflow-hidden"
              >
                <CardBgImage game={game} delay={i * 2.1} isFlickering={flickeringKey === game.key} />
                <span className="text-4xl shrink-0 group-hover:scale-110 transition-transform" style={{ position: 'relative', zIndex: 3 }}>{game.emoji}</span>
                <div className="min-w-0" style={{ position: 'relative', zIndex: 3 }}>
                  <p className="font-bold text-slate-800 mb-0.5">{game.title}</p>
                  <p className="text-xs text-slate-700">{game.desc}</p>
                </div>
              </Link>
            ) : (
              <div
                className="relative flex items-start gap-4 bg-surface rounded-2xl p-6 border border-slate-200 transition-all card-shadow h-full min-h-[130px] w-full opacity-60 overflow-hidden"
              >
                <CardBgImage game={game} delay={i * 2.1} isFlickering={flickeringKey === game.key} dimmed />
                <span className="text-4xl shrink-0" style={{ position: 'relative', zIndex: 3 }}>{game.emoji}</span>
                <div className="min-w-0" style={{ position: 'relative', zIndex: 3 }}>
                  <p className="font-bold text-slate-800 mb-0.5">{game.title}</p>
                  <p className="text-xs text-slate-700">{game.desc}</p>
                  <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-wide">Coming soon</p>
                </div>
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  )
}
