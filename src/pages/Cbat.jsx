import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { useAppSettings } from '../context/AppSettingsContext'
import SEO from '../components/SEO'
import RecentCbatScores from '../components/RecentCbatScores'
import AptitudeReportCard from '../components/AptitudeReportCard'
import CbatAdminViewToggle from '../components/CbatAdminViewToggle'
import CbatLoungeChat from '../components/CbatLoungeChat'
import { useLoungeOpen } from '../hooks/useLoungeOpen'
import { useFixedColumn } from '../hooks/useFixedColumn'
import { usePhoneTight } from '../hooks/usePhoneTight'
import { CBAT_GAMES, formatEstTime, formatEstTimeCompact, shortTitle } from '../data/cbatGames'
import { isCbatGameEnabled } from '../utils/cbat/isCbatGameEnabled'
import { SLIM_APP } from '../utils/appMode'
import { CBAT_GUIDE_HREF, prepareGuideChrome } from '../utils/guideHref'
import PlayOnPcNote from '../components/cbat/PlayOnPcNote'

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

// Estimated run length, pinned to the tile's top-left corner, opposite the
// announcement badge slot. Deliberately not a badge itself — it's
// standing information on every tile, so it carries no fill at all and sits
// right back at 35% opacity — a detail you find when you look for it rather
// than one the tile presents to you.
//
// The text-shadow is what makes that possible: this faint, the glyphs would
// otherwise break up against the blurred background image and its scanlines,
// and a fill dark enough to prevent that is exactly the visual weight we're
// trying to remove. It's pulled back in step with the text so it never reads
// as a smudge under it.
// The estimate as the desktop card has always shown it: a faint pill pinned to
// the tile's top-left corner, opposite the announcement badge. Standing
// information rather than a badge, so it carries no fill and sits back at 35%.
// The text-shadow is what makes that legible over the blurred card art.
function EstTime({ game }) {
  const label = formatEstTime(game)
  if (!label) return null
  return (
    <span
      data-testid={`est-time-${game.key}`}
      className="hidden sm:block absolute top-2 left-2 px-2 py-1 text-slate-700/35 text-[10px] font-bold tracking-wide uppercase whitespace-nowrap"
      style={{ zIndex: 4, textShadow: '0 1px 2px rgba(5,13,26,0.75)' }}
    >
      {label}
    </span>
  )
}

// The same estimate on the dense mobile grid, where there is no corner to pin it
// to: it sits in the text flow directly under the title. Louder than the desktop
// pill's 35% on purpose — at 7.5px, 35% over the blurred card art is unreadable,
// and here it is one of only two lines the tile has.
function EstTimeCompact({ game }) {
  const label = formatEstTimeCompact(game)
  if (!label) return null
  return (
    <span
      data-testid={`est-time-compact-${game.key}`}
      className="sm:hidden block font-mono text-[7.5px] font-medium tracking-wide text-slate-700/60 tabular-nums"
      style={{ position: 'relative', zIndex: 3, textShadow: '0 1px 2px rgba(5,13,26,0.75)' }}
    >
      {label}
    </span>
  )
}

// A tile's title. Four games carry a short label — see CBAT_SHORT_TITLES — that
// only the dense mobile tile uses; the desktop card has the room for the real
// name and keeps it. A game needing no shortening renders a single node rather
// than a hidden duplicate, so its title appears exactly once in the DOM.
function TileTitle({ game }) {
  const short = shortTitle(game)
  return (
    <p className="font-bold text-slate-800 text-[8.5px] leading-[1.15] sm:text-base sm:leading-normal sm:mb-0.5">
      {short ? (
        <>
          <span className="sm:hidden">{short}</span>
          <span className="hidden sm:inline">{game.title}</span>
        </>
      ) : game.title}
    </p>
  )
}

// Shared tile geometry. Mobile is a four-across icon grid — a centred column of
// emoji, name and run time in a ~70px box, which is what gets all 22 games onto
// one phone screen. From `sm` up it is the original card, unchanged: a 130px row
// with the emoji beside the text and the full description.
const TILE_BASE =
  'relative bg-surface border border-slate-200 transition-all card-shadow h-full w-full overflow-hidden ' +
  'flex flex-col items-center justify-center text-center gap-[3px] px-1 py-1.5 rounded-xl min-h-[70px] ' +
  'sm:flex-row sm:items-center sm:justify-start sm:text-left sm:gap-4 sm:p-6 sm:rounded-2xl sm:min-h-[130px]'

const TILE_HOVER =
  'cursor-pointer no-underline hover:border-brand-300 hover:bg-brand-50 hover:-translate-y-0.5'

const TILE_EMOJI = 'text-[21px] leading-none shrink-0 sm:text-4xl'

// An announcement badge has nowhere to live on an 83px phone tile, so there it
// becomes a dot in the corner: the same "something changed here", at the only
// size that fits. The desktop card keeps the full wording.
function TileBadge({ text, tone = 'brand' }) {
  const pill = tone === 'brand'
    ? 'bg-brand-500 text-white ring-2 ring-brand-300/60 shadow-[0_0_12px_rgba(91,170,255,0.7)]'
    : 'bg-slate-300 text-slate-700'
  const dot = tone === 'brand'
    ? 'bg-brand-600 shadow-[0_0_7px_rgba(91,170,255,0.9)]'
    : 'bg-slate-500'
  return (
    <>
      <span
        aria-hidden="true"
        title={text}
        className={`sm:hidden absolute top-1 right-1 w-1.5 h-1.5 rounded-full ${dot}`}
        style={{ zIndex: 5 }}
      />
      <span
        className={`hidden sm:block absolute top-2 right-2 px-2.5 py-1 rounded-lg text-[10px] font-extrabold tracking-wider uppercase whitespace-nowrap ${pill}`}
        style={{ zIndex: 4 }}
      >
        {text}
      </span>
    </>
  )
}

const IMAGE_GAMES = CBAT_GAMES.filter(g => g.image)

// Structured data for the hub. This is the one CBAT page a logged-out crawler
// can actually read — every /cbat/<game> route is behind RequireAuth and just
// redirects to /login — so the ItemList is what tells Google the breadth of what
// is here. It mirrors the same enabled/hidden filter the grid below uses, so a
// game an admin has switched off is never advertised in search results.
//
// Deliberately no `url` per item: pointing Google at auth-gated routes would
// earn a pile of "Page with redirect" exclusions in Search Console for URLs that
// can never rank. Name and description carry the value on their own.
function cbatHubJsonLd(isGameEnabled) {
  const games = CBAT_GAMES.filter(g => !g.hidden && isGameEnabled(g.key))
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'CBAT-style practice tests on SkyWatch',
    description: 'The aptitude subtests available to practise on SkyWatch.',
    numberOfItems: games.length,
    itemListElement: games.map((g, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: g.title,
      description: g.desc,
    })),
  }
}

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

// A combined tile (Trace 1/2, Visualisation 2D/3D). Identical to the normal tile
// off-hover; on hover (desktop only — `group-hover` in Tailwind v4 fires solely
// on hover-capable devices) it greys the card and floats two half-width mode
// buttons over it. The overlay is a SIBLING of the base <Link>, not a child, so
// its clicks never trip the anchor's navigation and touch devices — where the
// overlay stays inert — fall through to the Link's tap / long-press exactly as
// before. Whichever half is hovered is the active (brand) one; the other dims.
function CombinedGameTile({ game, i, split, flickeringKey, enabled, isAdmin, navigate, baseHandlers }) {
  return (
    <div className="relative h-full group">
      <Link
        to={game.path}
        {...baseHandlers}
        className={`${TILE_BASE} ${TILE_HOVER}`}
      >
        <CardBgImage game={game} delay={i * 2.1} isFlickering={flickeringKey === game.key} />
        <EstTime game={game} />
        {!enabled && isAdmin && <TileBadge text="Disabled" tone="slate" />}
        <span className={`${TILE_EMOJI} group-hover:scale-110 transition-transform`} style={{ position: 'relative', zIndex: 3 }}>{game.emoji}</span>
        <div className="min-w-0 w-full sm:w-auto" style={{ position: 'relative', zIndex: 3 }}>
          <TileTitle game={game} />
          <EstTimeCompact game={game} />
          <p className="hidden sm:block text-xs text-slate-700">{game.desc}</p>
        </div>
      </Link>

      {/* Hover split — greys the base card and overlays the two mode buttons. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 z-20 hidden sm:flex items-center justify-center gap-2 p-3 rounded-2xl bg-[#050d1a]/85
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
  // The "Play on a PC" note. Only ever reachable from the native app, where the
  // link that opens it is the one that replaces the donation link.
  const [pcNoteOpen, setPcNoteOpen] = useState(false)
  // Owned here rather than inside the widget: the split between Recent Scores
  // and the chat depends on it, so both halves of the column need to see it.
  const [loungeOpen, setLoungeOpen] = useLoungeOpen()
  // The side column does not move with the page: only the game grid scrolls.
  // Fixed rather than sticky, and measured off the spacer aside — see the hook.
  const sideColumnRef = useRef(null)
  const sideColumn    = useFixedColumn(sideColumnRef)
  const cbatGameEnabled = settings?.cbatGameEnabled ?? {}
  const visibleGames = CBAT_GAMES.filter(g => !g.hidden)

  // The phone grid is four across, so a game count that is not a multiple of
  // four leaves dead cells on the last row — at 22 games, the two beside
  // Vigilance and SMA. The report link goes in them: it is the only thing on
  // this page that is not a game, it costs nothing to put it in space the grid
  // was wasting anyway, and it stops the page needing a footer strip under the
  // grid at all.
  //
  // Computed rather than hard-coded to two, because the roster grows. At 23
  // games there is one cell left and a link squeezed into a single 73px column
  // would be unreadable, so it falls back to the footer; at 24 there are none
  // and it must, or it would open a seventh row to hold one link and cost more
  // height than it ever saved.
  const trailingCells = (4 - (visibleGames.length % 4)) % 4
  const reportInGrid  = trailingCells >= 2
  const isGameEnabled = (key) => isCbatGameEnabled(cbatGameEnabled, key)

  // Signed-in users get a Recent Scores side column on lg+ — widen the page
  // shell so the existing 2-column game grid keeps its natural width instead
  // of being squeezed by the new column. Mirror of the cbat-dpt-fullwidth pattern.
  useEffect(() => {
    if (!user) return
    document.body.classList.add('cbat-recent-wide')
    return () => document.body.classList.remove('cbat-recent-wide')
  }, [user])

  // Phone-height relief for the hub. /cbat/* game routes already get their top
  // padding cut by `.cbat-route`, but the hub deliberately does not carry that
  // class, so it still pays .app-shell-content's full py-6 — 48px spent above a
  // heading and below a footer line that both have whitespace to spare. Phone
  // width only; desktop is untouched.
  usePhoneTight()

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
    // A flex column exactly as tall as the viewport below the app chrome, so the
    // report link can sit on the bottom edge with mt-auto instead of floating
    // directly under a grid that no longer reaches the fold.
    //
    // The deduction has to match what the shell actually takes, or the page is a
    // few pixels taller than the space it sits in and scrolls with nothing below
    // the fold to scroll to. Both insets count: `.app-shell-body` pads down by
    // `3.5rem + env(safe-area-inset-top)` and `.app-shell-main` up by
    // `5rem + env(safe-area-inset-bottom)`. The status-bar inset is 0 on desktop
    // but 24-48px in the Android app (viewport-fit=cover), which is where a too-
    // small deduction shows up as a phantom scroll.
    //
    // Phone: 3.5 topbar + 0.75 + 0.75 (usePhoneTight halves .app-shell-content's
    // py-6) + 5 BottomNav = 10rem. sm and up: the full py-6 is paid, so 11.5rem —
    // .app-shell-main's 5rem is unlayered and beats its own md:pb-6, so the
    // BottomNav's reservation is held at desktop width too.
    <div className="cbat-page flex flex-col min-h-[calc(100dvh-10rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] sm:min-h-[calc(100dvh-11.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))]">
      <SEO
        title="CBAT Practice Tests"
        description="Practise every CBAT-style aptitude subtest in one place: FLAG, ANT, DPT, ACT, Trace, Visualisation and more. Free to play, with every score tracked."
        jsonLd={cbatHubJsonLd(isGameEnabled)}
      />

      <h1 className="text-2xl font-extrabold text-slate-900 mb-3 sm:mb-1">CBAT Aptitude Practise</h1>
      {/* The strapline is for someone who has just landed here — a signed-out visitor, and the
          crawler that reads this page as one of the few indexable CBAT URLs we have. A signed-in
          player on a phone already knows what the page is, and the line costs them 28px of the
          viewport the 22-tile grid is fighting for, so it comes off at phone width only once
          there is a session. Never hidden while signed out, or we would be hiding the page's one
          keyword-bearing sentence from mobile-first indexing. */}
      <p className={`text-sm text-slate-500 mb-2 sm:mb-4${user ? ' hidden sm:block' : ''}`}>
        Practise for CBAT with targeted training games.
      </p>

      {/* Guide strip — signed-out only. For a visitor the grid below is blurred
          and this is the only thing on the page they can actually use, so it
          earns its space; once you are signed in you are here to play, and it
          just pushes the games down. Crawlers are always signed out, so this
          still gives the guide its crawl path from an indexable page.

          Plain <a>: the guide is a standalone document in public/, not an app
          route, so a <Link> would 404 inside the SPA. The href is platform-aware
          — see utils/guideHref.js. */}
      {!user && (
        <a
          href={CBAT_GUIDE_HREF}
          onClick={prepareGuideChrome}
          className="group flex items-center gap-3 mb-6 rounded-xl border border-slate-200 bg-surface px-4 py-3 no-underline card-shadow transition-colors hover:border-brand-300 hover:bg-brand-50"
        >
          <span className="text-xl shrink-0">📖</span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-slate-800">New to CBAT? Read the guide first</span>
            <span className="block text-xs text-slate-500">What each subtest is really like, and how the test day runs. Free to read.</span>
          </span>
          <span className="shrink-0 text-brand-600 text-base leading-none group-hover:translate-x-0.5 transition-transform">→</span>
        </a>
      )}

      <div className="lg:flex lg:gap-6 lg:items-start">
        <div className="lg:flex-1 lg:min-w-0">

      {/* Lock card — shown when not signed in */}
      {!user && (
        <div className="bg-surface rounded-2xl border border-slate-200 p-6 mb-5 text-center card-shadow">
          <div className="text-4xl mb-3">🔒</div>
          <p className="font-bold text-slate-800 mb-1">Sign in to access CBAT Aptitude Practise</p>
          <p className="text-sm text-slate-500 mb-4">Create a free account to start practising.</p>
          <Link to="/login" className="inline-flex px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors">
            Sign In
          </Link>
        </div>
      )}

      {/* Aptitude Report — the estimate of what this practice would score on a real role's
          battery. Above the grid because it's the reason to pick one game over another. */}
      {user && <AptitudeReportCard />}

      {/* Game grid — blurred when not signed in */}
      {/* Four across on a phone so all 22 games sit on one screen; the two-column
          130px card grid is untouched from `sm` up. The row gap was an inline
          2rem style, which beat every class and applied at all widths — it is a
          responsive class now, which is what lets the phone grid be dense. */}
      <div className={`grid grid-cols-4 gap-2 sm:grid-cols-2 sm:gap-x-4 sm:gap-y-8${!user ? ' opacity-40 pointer-events-none select-none blur-sm' : ''}`}>
        {visibleGames.map((game, i) => {
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
                  navigate={navigate}
                  baseHandlers={baseHandlers}
                />
              ) : clickable ? (
                <Link
                  to={game.path}
                  {...baseHandlers}
                  className={`${TILE_BASE} ${TILE_HOVER} group`}
                >
                  <CardBgImage game={game} delay={i * 2.1} isFlickering={flickeringKey === game.key} />
                  <EstTime game={game} />
                  {/* Announcement badge for an existing game that's gained
                      something. */}
                  {game.badge && enabled && <TileBadge text={game.badge} />}
                  {!enabled && user?.isAdmin && <TileBadge text="Disabled" tone="slate" />}
                  <span className={`${TILE_EMOJI} group-hover:scale-110 transition-transform`} style={{ position: 'relative', zIndex: 3 }}>{game.emoji}</span>
                  <div className="min-w-0 w-full sm:w-auto" style={{ position: 'relative', zIndex: 3 }}>
                    <TileTitle game={game} />
                    <EstTimeCompact game={game} />
                    <p className="hidden sm:block text-xs text-slate-700">{game.desc}</p>
                  </div>
                </Link>
              ) : (
                <div className={`${TILE_BASE} opacity-60`}>
                  <CardBgImage game={game} delay={i * 2.1} isFlickering={flickeringKey === game.key} dimmed />
                  <EstTime game={game} />
                  <span className={TILE_EMOJI} style={{ position: 'relative', zIndex: 3 }}>{game.emoji}</span>
                  <div className="min-w-0 w-full sm:w-auto" style={{ position: 'relative', zIndex: 3 }}>
                    <TileTitle game={game} />
                    <EstTimeCompact game={game} />
                    <p className="hidden sm:block text-xs text-slate-700">{game.desc}</p>
                    {/* The phone tile has room for one word, so it states the
                        condition and the desktop card keeps the explanation. */}
                    <p className="text-[7px] leading-tight text-slate-500 uppercase tracking-wide sm:text-[10px] sm:mt-1">
                      {adminDisabled
                        ? <><span className="sm:hidden">Off</span><span className="hidden sm:inline">Temporarily disabled — check back soon</span></>
                        : <><span className="sm:hidden">Soon</span><span className="hidden sm:inline">Coming soon</span></>}
                    </p>
                  </div>
                </div>
              )}
            </motion.div>
          )
        })}

        {/* Report link, sitting in the last row's dead cells beside Vigilance and
            SMA. Phone only — the desktop grid is two across, always full, and has
            the room for a proper footer anyway.

            It is deliberately NOT a tile. No surface, no border, no shadow, no
            emoji: everything that makes a card here read as "a thing you play"
            is absent, so it reads as the whitespace it is sitting in with a link
            written across it. A dashed or ghosted card was the obvious idea and
            is the wrong one, because this grid already contains greyed-out cards
            that mean "coming soon" and a 23rd ghost card would be read as one.

            The question comes back that the compact footer had to drop. The cell
            already exists at the row's height whatever goes in it, so two lines
            of 8px text are free here in a way they were not under the grid. */}
        {reportInGrid && (
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: visibleGames.length * 0.06, duration: 0.35 }}
            className={`sm:hidden flex items-stretch ${trailingCells === 3 ? 'col-span-3' : 'col-span-2'}`}
          >
            {/* Two links now, side by side, each taking half the cell and all of
                its height. They are still deliberately NOT tiles: no surface, no
                border, no shadow, no emoji, so they read as the whitespace they
                are sitting in with links written across it, and the grid does
                not grow a 23rd thing that looks playable.

                Side by side rather than stacked, and labels only. Stacking them
                fits — four lines of 8px text clear 70px — but it halves each tap
                target to about 30px and asks someone to read two micro-sentences
                at arm's length. Half a cell each is roughly 80x70px, which is a
                real target, and at this size a legible label beats an
                illegible explanation.

                What goes is the framing question that used to sit above "Report
                a problem". It was there because one link left the cell with room
                to spare; the room now buys a second destination, which is worth
                more than a sentence explaining a link that already explains
                itself. The full framing for both survives at `sm` in the footer
                strip below, where there is width for it.

                The ask goes first for the same reason it does down there, and is
                never in the native app: see the footer note. */}
            {!SLIM_APP && (
              <Link
                to="/donate"
                data-testid="cbat-grid-donate"
                className="flex-1 flex items-center justify-center px-1 text-center no-underline
                  text-[9px] font-semibold leading-[1.25] text-brand-600 active:text-brand-700
                  underline underline-offset-2 transition-colors"
              >
                Support SkyWatch
              </Link>
            )}
            {/* The native app has no donation link (see the footer note), which
                left "Report a problem" stretched alone across the whole span
                instead of the two-up pairing the web gets. This takes the empty
                half: a phone-only player never otherwise learns that a PC gives
                them a joystick, and the slot was already paid for. */}
            {SLIM_APP && (
              <button
                type="button"
                onClick={() => setPcNoteOpen(true)}
                data-testid="cbat-grid-play-on-pc"
                className="flex-1 flex items-center justify-center px-1 text-center no-underline
                  text-[9px] font-semibold leading-[1.25] text-brand-600 active:text-brand-700
                  underline underline-offset-2 transition-colors"
              >
                Play on a PC
              </button>
            )}
            <Link
              to="/report"
              data-testid="cbat-grid-report"
              className="flex-1 flex items-center justify-center px-1 text-center no-underline
                text-[9px] font-semibold leading-[1.25] text-slate-600 active:text-brand-600
                underline underline-offset-2 transition-colors"
            >
              Report a problem
            </Link>
          </motion.div>
        )}
      </div>

        </div>

        {/* Recent scores side column — desktop (lg+) only, requires sign-in.
            A flex column exactly as tall as the viewport below it, so the two
            cards can split that height: Recent Scores takes 60% and the lounge
            chat 40% while the chat is open, and Recent Scores takes all of it
            while the chat is collapsed to its tab. The height is measured
            rather than set in CSS — see useStickyFillHeight for why. */}
        {user && (
          <aside ref={sideColumnRef} className="hidden lg:block lg:w-[340px] lg:shrink-0">
            <div
              className="flex flex-col"
              style={sideColumn
                ? {
                  position: 'fixed',
                  top:      sideColumn.top,
                  left:     sideColumn.left,
                  width:    sideColumn.width,
                  height:   sideColumn.height,
                }
                // Until the first measurement lands, sit in flow at the column's
                // natural size. One frame, and never a panel drawn at 0,0.
                : undefined}
            >
              {/* Admin-only tab docked to the top edge of the card below: admins see
                  player emails on every CBAT board, and this drops them back to the
                  agent view a player gets. Inset from the right so it meets the
                  straight part of the card's edge rather than its rounded corner.
                  No gap under it — it is meant to read as part of the card. */}
              {user.isAdmin && (
                <div className="shrink-0 flex justify-end pr-4">
                  <CbatAdminViewToggle />
                </div>
              )}
              <div className={`${loungeOpen ? 'flex-[3]' : 'flex-1'} min-h-0`}>
                <RecentCbatScores fill />
              </div>
              <CbatLoungeChat open={loungeOpen} onToggle={setLoungeOpen} />
            </div>
          </aside>
        )}
      </div>

      {/* The two standing links this page carries that are not games: the
          donation ask and the report link. `mt-auto` takes up whatever slack
          the grid leaves, so they sit on the bottom edge of the page rather
          than trailing the last row of tiles.

          One row, not two stacked lines. On a phone this whole strip
          disappears when the grid has dead cells to put the links in (see
          `reportInGrid` above) and the framing sentences are hidden anyway, so
          the row is two short labels; from `sm` up each label gets its framing
          sentence back and the row wraps to two lines only if the container is
          too narrow to hold both — which is the stacked layout, arrived at when
          it is actually needed rather than always.

          Below the fold on a desktop, unavoidably: the two-across grid is
          eleven rows of 130px tiles. That is the right place for a standing
          link even so. The high-intent ask is the post-game note, which fires
          on a results screen after a measured improvement; this is the findable
          home for someone who has gone looking, and a footer is where people
          look. Anyone who reaches it has scrolled 22 games.

          Neither link is a button. A filled CTA here would compete with the
          tiles for the same glance and read as the page's primary action,
          which it emphatically is not.

          The donation link is never shown in the native app, whatever the admin
          flags say — the store-policy reason is set out in CbatGameOver. It
          reads SLIM_APP rather than useSlimMode() for the same reason given
          there: slim mode applied to the WEBSITE is just a trimmed site and
          carries no store exposure. */}
      {/* `lg:mr-[364px]` keeps this clear of the Recent Scores column, and it is
          not cosmetic. This strip is a sibling of the lg:flex row above rather
          than a child of its left column — it has to be, because `mt-auto`
          against .cbat-page's flex column is what pins it to the bottom edge of
          the page. So it spans the full width while the side column is
          `position: fixed` and painted over the right 340px of the viewport,
          and centred footer text slid underneath it: "Report a problem" was
          buried behind the chat panel at lg and up.

          340px column + gap-6 (24px) = 364px, and only when there is a column
          to miss — it renders for signed-in users at lg only, which is exactly
          when the margin applies. */}
      <div
        data-testid="cbat-footer-report"
        className={`mt-auto pt-1 sm:pt-6 sm:border-t sm:border-slate-200${reportInGrid ? ' hidden sm:block' : ''}${user ? ' lg:mr-[364px]' : ''}`}
      >
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-center text-[10px] sm:text-xs text-slate-500">
          {!SLIM_APP && (
            <p className="m-0">
              <span className="hidden sm:inline">SkyWatch is free and has no ads. Donations cover the running costs. </span>
              <Link to="/donate" data-testid="cbat-footer-donate" className="font-semibold text-brand-600 hover:text-brand-700 underline underline-offset-2 transition-colors">
                Support SkyWatch
              </Link>
            </p>
          )}
          {SLIM_APP && (
            <p className="m-0">
              <span className="hidden sm:inline">Every game runs in a desktop browser too. </span>
              <button
                type="button"
                onClick={() => setPcNoteOpen(true)}
                data-testid="cbat-footer-play-on-pc"
                className="font-semibold text-brand-600 hover:text-brand-700 underline underline-offset-2 transition-colors"
              >
                Play on a PC
              </button>
            </p>
          )}
          <p className="m-0">
            <span className="hidden sm:inline">A game not working right? </span>
            <Link to="/report" className="font-semibold text-slate-600 hover:text-brand-600 underline underline-offset-2 transition-colors">
              Report a problem
            </Link>
          </p>
        </div>
      </div>

      {pcNoteOpen && <PlayOnPcNote onClose={() => setPcNoteOpen(false)} />}
    </div>
  )
}
