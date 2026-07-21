import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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
        className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none"
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
        className="absolute inset-0 pointer-events-none"
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

// Right-clicking (or long-pressing) a game tile jumps straight to that game's
// all-time leaderboard. Most tiles' leaderboard key is the last segment of their
// path. The two combined tiles (Trace 1/2, Visualisation 2D/3D) have no single
// board, so they resolve to whichever mode the user last selected — the same
// choice persisted by useTraceMode / useVisualisationMode — defaulting to those
// hooks' own defaults (Trace 1, Visualisation 2D) when nothing is stored yet.
const TRACE_MODE_TO_KEY = { '2d': 'plane-turn-2d', '3d': 'plane-turn-3d', trace1: 'trace-1', trace2: 'trace-2' }
function leaderboardKeyFor(game) {
  if (game.key === 'plane-turn') {
    const mode = (() => { try { return localStorage.getItem('cbat:trace:mode') } catch { return null } })()
    return TRACE_MODE_TO_KEY[mode] || 'trace-1'
  }
  if (game.key === 'visualisation') {
    const mode = (() => { try { return localStorage.getItem('cbat:visualisation:mode') } catch { return null } })()
    return mode === '3d' ? 'visualisation-3d' : 'visualisation-2d'
  }
  return game.path.split('/').pop()
}

// The two combined tiles fan out into their two modes on hover (desktop only).
// Each half left-clicks into the game with that mode pre-selected — persisted to
// the same localStorage key useTraceMode / useVisualisationMode read on mount —
// and right-clicks straight to that mode's all-time leaderboard.
const SPLIT_TILES = {
  'plane-turn': {
    storageKey: 'cbat:trace:mode',
    halves: [
      { label: 'Trace 1', mode: 'trace1', lbKey: 'trace-1' },
      { label: 'Trace 2', mode: 'trace2', lbKey: 'trace-2' },
    ],
  },
  'visualisation': {
    storageKey: 'cbat:visualisation:mode',
    halves: [
      { label: '2D', mode: '2d', lbKey: 'visualisation-2d' },
      { label: '3D', mode: '3d', lbKey: 'visualisation-3d' },
    ],
  },
}
const persistMode = (key, mode) => { try { localStorage.setItem(key, mode) } catch { /* storage unavailable */ } }

// Display the "NEW GAME" badge on the TRACE 1/2 card until midnight at the
// start of 22 May 2026 (i.e. visible up to and including 21st May).
// Month is 0-indexed (4 = May), so `Date.now() < deadline` is still true at
// any point on May 21.
const NEW_GAME_KEY = 'plane-turn'
const NEW_GAME_DEADLINE = new Date(2026, 4, 22)

// A combined tile (Trace 1/2, Visualisation 2D/3D). Identical to the normal tile
// off-hover; on hover (desktop only — `group-hover` in Tailwind v4 fires solely
// on hover-capable devices) it greys the card and floats two half-width mode
// buttons over it. The overlay is a SIBLING of the base <Link>, not a child, so
// its clicks never trip the anchor's navigation and touch devices — where the
// overlay stays inert — fall through to the Link's tap / long-press exactly as
// before. Whichever half is hovered is the active (brand) one; the other dims.
function CombinedGameTile({ game, i, split, flickeringKey, enabled, isAdmin, showNewBadge, navigate, baseHandlers }) {
  return (
    <div className="relative h-full group">
      <Link
        to={game.path}
        {...baseHandlers}
        className="relative flex items-center gap-4 bg-surface rounded-2xl p-6 border border-slate-200 transition-all card-shadow cursor-pointer h-full min-h-[130px] w-full
          hover:border-brand-300 hover:bg-brand-50 hover:-translate-y-0.5 no-underline overflow-hidden"
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
        {!enabled && isAdmin && (
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

      {/* Hover split — greys the base card and overlays the two mode buttons. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 z-20 flex items-center justify-center gap-2 p-3 rounded-2xl bg-[#050d1a]/85
          opacity-0 pointer-events-none transition-opacity duration-150
          group-hover:opacity-100 group-hover:pointer-events-auto"
      >
        {split.halves.map((h) => (
          <div
            key={h.mode}
            onClick={() => {
              // Left-click → open the game with this mode pre-selected.
              persistMode(split.storageKey, h.mode)
              navigate(game.path)
            }}
            onContextMenu={(e) => {
              // Right-click → this mode's all-time leaderboard.
              e.preventDefault()
              navigate(`/cbat/${h.lbKey}/leaderboard?period=all-time`)
            }}
            className="flex-1 max-w-[40%] flex items-center justify-center px-5 py-6 rounded-xl cursor-pointer select-none
              border border-[#1a3a5c] bg-[#0a1628] text-slate-400 opacity-60 transition-all
              hover:opacity-100 hover:bg-brand-600 hover:text-white hover:border-brand-400
              hover:shadow-[0_0_16px_rgba(91,170,255,0.45)]"
          >
            <span className="text-base font-extrabold tracking-wide uppercase">{h.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Cbat() {
  const { user } = useAuth()
  const { settings } = useAppSettings()
  const navigate = useNavigate()

  // Shortcut to a game's all-time leaderboard: desktop right-click, or a ~500ms
  // long-press on touch. One shared timer is enough — only one tile can be under
  // a finger at a time. `fired` lets the tile's onClick swallow the tap-through
  // navigation that a touch-end would otherwise trigger after a long-press.
  const longPressRef = useRef({ timer: null, fired: false })
  const openAllTimeBoard = (game) =>
    navigate(`/cbat/${leaderboardKeyFor(game)}/leaderboard?period=all-time`)
  const startLongPress = (game) => {
    longPressRef.current.fired = false
    clearTimeout(longPressRef.current.timer)
    longPressRef.current.timer = setTimeout(() => {
      longPressRef.current.fired = true
      openAllTimeBoard(game)
    }, 500)
  }
  const cancelLongPress = () => clearTimeout(longPressRef.current.timer)
  useEffect(() => () => clearTimeout(longPressRef.current.timer), [])
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
        {CBAT_GAMES.filter(g => !g.hidden).map((game, i) => {
          const isImplemented = !!game.path
          const enabled       = isGameEnabled(game.key)
          // Admins always click through to test, regardless of toggle state.
          const clickable     = isImplemented && (enabled || !!user?.isAdmin)
          // Distinguishes "admin disabled this in settings" (temporary) from
          // "this game has no page yet" (genuinely future) so the picker can
          // show the right message to non-admins.
          const adminDisabled = isImplemented && !enabled
          const split         = SPLIT_TILES[game.key]
          // Shared base-<Link> handlers: right-click → the persisted mode's board;
          // touch tap / long-press unchanged. Combined tiles reuse these for their
          // base layer (mobile), and add a desktop hover split on top.
          const baseHandlers = {
            onContextMenu: (e) => { e.preventDefault(); openAllTimeBoard(game) },
            onTouchStart:  () => startLongPress(game),
            onTouchEnd:    cancelLongPress,
            onTouchMove:   cancelLongPress,
            onTouchCancel: cancelLongPress,
            onClick: (e) => {
              // Swallow the tap-through that follows a long-press so it
              // doesn't also open the game after we've navigated away.
              if (longPressRef.current.fired) { e.preventDefault(); longPressRef.current.fired = false }
            },
          }
          return (
            <motion.div
              key={game.key}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06, duration: 0.35 }}
              className="h-full"
            >
              {clickable && split ? (
                <CombinedGameTile
                  game={game}
                  i={i}
                  split={split}
                  flickeringKey={flickeringKey}
                  enabled={enabled}
                  isAdmin={!!user?.isAdmin}
                  showNewBadge={showNewBadge}
                  navigate={navigate}
                  baseHandlers={baseHandlers}
                />
              ) : clickable ? (
                <Link
                  to={game.path}
                  {...baseHandlers}
                  className="relative flex items-center gap-4 bg-surface rounded-2xl p-6 border border-slate-200 transition-all card-shadow cursor-pointer h-full min-h-[130px] w-full
                    hover:border-brand-300 hover:bg-brand-50 group hover:-translate-y-0.5 no-underline overflow-hidden"
                >
                  <CardBgImage game={game} delay={i * 2.1} isFlickering={flickeringKey === game.key} />
                  {game.beta && (
                    <span
                      className="absolute top-2 left-2 px-2.5 py-1 rounded-lg bg-amber-600 text-[#1a1200] text-[10px] font-extrabold tracking-wider uppercase ring-2 ring-amber-700/60 shadow-[0_0_12px_rgba(245,158,11,0.6)]"
                      style={{ zIndex: 4 }}
                    >
                      Beta
                    </span>
                  )}
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
                  {game.beta && (
                    <span
                      className="absolute top-2 left-2 px-2.5 py-1 rounded-lg bg-amber-600 text-[#1a1200] text-[10px] font-extrabold tracking-wider uppercase ring-2 ring-amber-700/60 shadow-[0_0_12px_rgba(245,158,11,0.6)]"
                      style={{ zIndex: 4 }}
                    >
                      Beta
                    </span>
                  )}
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

      {/* Quiet report link — a game misbehaving? Send it to the team. */}
      <div className="mt-10 pt-6 border-t border-slate-200 text-center">
        <p className="text-xs text-slate-500">
          A game not working right?{' '}
          <Link to="/report" className="font-semibold text-slate-600 hover:text-brand-600 underline underline-offset-2 transition-colors">
            Report a problem
          </Link>
        </p>
      </div>
    </div>
  )
}
