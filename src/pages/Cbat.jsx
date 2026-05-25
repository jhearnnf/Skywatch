import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { useAppSettings } from '../context/AppSettingsContext'
import SEO from '../components/SEO'
import RecentCbatScores from '../components/RecentCbatScores'
import { CBAT_GAMES } from '../data/cbatGames'
import { isCbatGameEnabled } from '../utils/cbat/isCbatGameEnabled'

// Re-export so existing imports (`import { CBAT_GAMES } from './Cbat'`) still work.
export { CBAT_GAMES }

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

// Display the "NEW GAME" badge on the TRACE 1/2 card until midnight at the
// start of 22 May 2026 (i.e. visible up to and including 21st May).
// Month is 0-indexed (4 = May), so `Date.now() < deadline` is still true at
// any point on May 21.
const NEW_GAME_KEY = 'plane-turn'
const NEW_GAME_DEADLINE = new Date(2026, 4, 22)

export default function Cbat() {
  const { user } = useAuth()
  const { settings } = useAppSettings()
  const [flickeringKey, setFlickeringKey] = useState(null)
  const showNewBadge = Date.now() < NEW_GAME_DEADLINE.getTime()
  const cbatGameEnabled = settings?.cbatGameEnabled ?? {}
  const isGameEnabled = (key) => isCbatGameEnabled(cbatGameEnabled, key)

  // Signed-in users get a Recent Scores side column on lg+ — widen the page
  // shell so the existing 2-column game grid keeps its natural width instead
  // of being squeezed by the new column. Mirror of the cbat-dpt-fullwidth pattern.
  useEffect(() => {
    if (!user) return
    document.body.classList.add('cbat-recent-wide')
    return () => document.body.classList.remove('cbat-recent-wide')
  }, [user])

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

      <div className="lg:flex lg:gap-6 lg:items-start">
        <div className="lg:flex-1 lg:min-w-0">

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
        {CBAT_GAMES.map((game, i) => {
          const isImplemented = !!game.path
          const enabled       = isGameEnabled(game.key)
          // Admins always click through to test, regardless of toggle state.
          const clickable     = isImplemented && (enabled || !!user?.isAdmin)
          // Distinguishes "admin disabled this in settings" (temporary) from
          // "this game has no page yet" (genuinely future) so the picker can
          // show the right message to non-admins.
          const adminDisabled = isImplemented && !enabled
          return (
            <motion.div
              key={game.key}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06, duration: 0.35 }}
              className="h-full"
            >
              {clickable ? (
                <Link
                  to={game.path}
                  className="relative flex items-center gap-4 bg-surface rounded-2xl p-6 border border-slate-200 transition-all card-shadow cursor-pointer h-full min-h-[130px] w-full
                    hover:border-brand-300 hover:bg-brand-50 group hover:-translate-y-0.5 no-underline overflow-hidden"
                >
                  <CardBgImage game={game} delay={i * 2.1} isFlickering={flickeringKey === game.key} />
                  {showNewBadge && game.key === NEW_GAME_KEY && enabled && (
                    <span
                      className="absolute top-2 right-2 px-2.5 py-1 rounded-lg bg-brand-500 text-white text-[10px] font-extrabold tracking-wider uppercase ring-2 ring-brand-300/60 shadow-[0_0_12px_rgba(91,170,255,0.7)]"
                      style={{ zIndex: 4 }}
                    >
                      New Game
                    </span>
                  )}
                  {!enabled && user?.isAdmin && (
                    <span
                      className="absolute top-2 right-2 px-2.5 py-1 rounded-lg bg-slate-300 text-slate-700 text-[10px] font-extrabold tracking-wider uppercase"
                      style={{ zIndex: 4 }}
                    >
                      Disabled
                    </span>
                  )}
                  <span className="text-4xl shrink-0 group-hover:scale-110 transition-transform" style={{ position: 'relative', zIndex: 3 }}>{game.emoji}</span>
                  <div className="min-w-0" style={{ position: 'relative', zIndex: 3 }}>
                    <p className="font-bold text-slate-800 mb-0.5">{game.title}</p>
                    <p className="text-xs text-slate-700">{game.desc}</p>
                  </div>
                </Link>
              ) : (
                <div
                  className="relative flex items-center gap-4 bg-surface rounded-2xl p-6 border border-slate-200 transition-all card-shadow h-full min-h-[130px] w-full opacity-60 overflow-hidden"
                >
                  <CardBgImage game={game} delay={i * 2.1} isFlickering={flickeringKey === game.key} dimmed />
                  <span className="text-4xl shrink-0" style={{ position: 'relative', zIndex: 3 }}>{game.emoji}</span>
                  <div className="min-w-0" style={{ position: 'relative', zIndex: 3 }}>
                    <p className="font-bold text-slate-800 mb-0.5">{game.title}</p>
                    <p className="text-xs text-slate-700">{game.desc}</p>
                    <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-wide">
                      {adminDisabled ? 'Temporarily disabled — check back soon' : 'Coming soon'}
                    </p>
                  </div>
                </div>
              )}
            </motion.div>
          )
        })}
      </div>

        </div>

        {/* Recent scores side column — desktop (lg+) only, requires sign-in */}
        {user && (
          <aside className="hidden lg:block lg:w-[340px] lg:shrink-0 lg:sticky lg:top-4">
            <RecentCbatScores />
          </aside>
        )}
      </div>
    </div>
  )
}
