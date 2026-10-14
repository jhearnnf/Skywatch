import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { useAppSettings } from '../../context/AppSettingsContext'
import { useGameChrome } from '../../context/GameChromeContext'
import { useLoungeOpen } from '../../hooks/useLoungeOpen'
import CbatLoungeChat from '../CbatLoungeChat'
import { DEFAULT_LOUNGE_GROW } from './LoungeResizeHandle'
import { cbatRouteKind, dockMode } from '../../utils/cbat/loungeDock'
import { DockContext, useLoungeDock } from './loungeDockContext'

// The CBAT chat on desktop: ONE panel for the whole of CBAT, mounted here at
// the app level beside the routes rather than inside any page, so it stays put
// the way the navbar does while the pages change underneath it. The room you
// were in, your draft and the live connection all survive a trip from the hub
// to a game's instructions to a leaderboard and back.
//
// It is pinned to the right edge at the hub column's width, gliding between:
//
//   hub          the bottom of the hub's side column, under Recent Scores. The
//                hub renders a placeholder box there (<LoungeHubSlot>) that the
//                resize handle drags; the panel tracks that box.
//   full         on instruction pages and leaderboards: the right-hand
//                column, at exactly the size and place it had on the hub (the
//                chat never changes shape between pages). The page reserves
//                the column (`cbat-dock-reserve`) and centres itself in what is
//                left, scrolling in its own column so its scrollbar sits where
//                the hub's grid one does. The space above the panel holds a
//                joystick game's right-hand panel (ACT's headphones notice).
//   hidden       slid down off the bottom of the window: in a game, on a
//                results screen, or on a window too narrow to give it a column.
//
// Starting a game sets `immersive` (every CBAT game does, see
// GameChromeContext), which is what slides the panel away, and finishing
// brings it back up. Nothing per game.
//
// Phones never get this: below `lg` the hub mounts its own chat under the grid
// (see Cbat.jsx), and the two are never mounted together.

const DOCK_WIDTH = 340
// Gap to the window's right and bottom edges, and the hub column's own inset.
const EDGE = 16
// Below these the reserved column would squeeze the instructions card.
// Ordinary pages: a 768px shell beside 380px of reserve and the 224px sidebar.
// The joystick games (CbatStickLayout): 340px rail + card + gaps beside it.
const FULL_MIN = '(min-width: 1440px)'
const STICK_MIN = '(min-width: 1680px)'
const LG = '(min-width: 1024px)'

const GLIDE = { duration: 0.5, ease: [0.22, 1, 0.36, 1] }
const SNAP = { duration: 0 }

function useMedia(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
  )
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(query)
    const onChange = (e) => setMatches(e.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [query])
  return matches
}

// Document position from the offset chain rather than getBoundingClientRect:
// offsets ignore transforms, so an entrance animation running on the column
// (or a route transition) cannot hand the panel a position it then snaps from.
function offsetBox(el) {
  let top = 0, left = 0
  for (let n = el; n; n = n.offsetParent) { top += n.offsetTop; left += n.offsetLeft }
  return { top: top - window.scrollY, left: left - window.scrollX, width: el.offsetWidth, height: el.offsetHeight }
}

// The right-hand column: level with the top of the page header, down to the
// bottom edge, at the right edge of the viewport (inside any scrollbar).
function columnBox() {
  const bar = document.querySelector('.app-topbar')
  const top = (bar?.offsetHeight ?? 56) + 12
  return {
    top,
    left:   document.documentElement.clientWidth - EDGE - DOCK_WIDTH,
    width:  DOCK_WIDTH,
    height: Math.max(360, window.innerHeight - top - EDGE),
  }
}

// Height of the closed chat tab, mt-3 included.
const TAB_PX = 50

// Where the open panel's top edge last sat on the hub, so every other page
// shows it at exactly that size: the chat does not change shape between the
// hub and a game's instructions. Module scope, as it outlives the pages.
let hubOpenTop = null

// The panel on a page that is not the hub: the hub's size and place. Its
// bottom edge is the column's; its top is where the hub last had it (or the
// hub's default even split of the column, before the hub has been seen), or a
// tab's height above the bottom while the chat is closed.
function pageBox(open) {
  const col    = columnBox()
  const bottom = col.top + col.height
  const top    = !open
    ? bottom - TAB_PX
    : Math.min(bottom - 200, hubOpenTop ?? col.top + Math.round(col.height / 2))
  return { top, left: col.left, width: col.width, height: bottom - top }
}

const sameBox = (a, b) => a && b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height

export function CbatLoungeDockProvider({ children }) {
  const { user } = useAuth()
  const { settings } = useAppSettings() ?? {}
  const { immersive, gameOver } = useGameChrome()
  const { pathname } = useLocation()

  const [open, setOpen] = useLoungeOpen()
  // The hub's Recent Scores / chat split, dragged by the player. Starts even
  // on every visit, deliberately not remembered.
  const [grow, setGrow] = useState(DEFAULT_LOUNGE_GROW)
  const [resizing, setResizing] = useState(false)
  const [hubSlot, setHubSlot] = useState(null)
  const [stickCount, setStickCount] = useState(0)
  // The joystick layout's grid, and the box above the panel its right-hand
  // panel (ACT's headphones notice) is drawn into. See CbatStickLayout.
  const [stickGrid, setStickGrid] = useState(null)
  const [upperEl, setUpperEl] = useState(null)

  const lg    = useMedia(LG)
  const wide  = useMedia(FULL_MIN)
  const wider = useMedia(STICK_MIN)
  const kind  = cbatRouteKind(pathname)
  const onHub = kind === 'hub'
  const available = Boolean(user) && settings?.chatEnabled !== false && lg
  const mounted   = available && kind !== null

  const stick = stickCount > 0
  const wanted = dockMode({ kind, hubSlot, immersive, gameOver, stick, wide, wider })
  // 'hold' keeps whatever the panel last was. Remembered in state during
  // render (React's pattern for deriving from a previous value).
  const [held, setHeld] = useState('hidden')
  if (wanted !== 'hold' && held !== wanted) setHeld(wanted)
  const mode = wanted === 'hold' ? held : wanted

  // The room the instructions or leaderboard centre themselves beside.
  const reserve = mounted && mode === 'full'
  useLayoutEffect(() => {
    if (!reserve) return
    document.body.classList.add('cbat-dock-reserve')
    // The three columns (see `cbat-dock-reserve` in main.css), spread evenly
    // between the sidebar and the window edge. `--dock-gutter` is the left
    // column plus its gap to the middle; `--dock-pad-right` is the room between
    // the middle column and <main>'s scrollbar.
    //
    // Tightest fit is 1068px of <main>: 16 + 340 left + 24 + 672 middle + 16,
    // with the chat a further 50px past the middle (16 + 10px scrollbar + 24
    // margin). Narrower than that the left column gives way first, so the
    // middle keeps its 672px. Wider, the spare room is split so both gaps
    // either side of the middle match: the left column then sits 16px off the
    // sidebar exactly as the chat sits 16px off the window edge, and the middle
    // column is centred on the space right of the sidebar. The old rule hugged
    // the right and handed every spare pixel to the left, which left a big
    // hole beside the sidebar on a wide monitor.
    const main = document.querySelector('.app-shell-main')
    const setGutter = () => {
      const spare = (main?.clientWidth ?? 0) - 1068
      let gutter = 364
      let right  = 0
      if (spare < 0) {
        gutter = Math.max(0, 364 + spare)
      } else {
        right  = Math.max(0, (spare - 26) / 2)
        gutter = 364 + spare - right
      }
      document.body.style.setProperty('--dock-gutter', `${gutter}px`)
      document.body.style.setProperty('--dock-pad-right', `${16 + right}px`)
    }
    setGutter()
    window.addEventListener('resize', setGutter)
    return () => {
      window.removeEventListener('resize', setGutter)
      document.body.classList.remove('cbat-dock-reserve')
      document.body.style.removeProperty('--dock-gutter')
      document.body.style.removeProperty('--dock-pad-right')
    }
  }, [reserve])

  // Geometry. A change of mode glides; anything else (a drag of the split, a
  // window resize, the column's own open/close transition) tracks exactly, or
  // the panel would trail the thing it is meant to be part of.
  const [box, setBox] = useState(null)
  const [upperBox, setUpperBox] = useState(null)
  const [transition, setTransition] = useState(SNAP)
  const modeRef = useRef(null)
  const openRef = useRef(open)
  useLayoutEffect(() => {
    if (!mounted) { modeRef.current = null; return }
    // The hub fading out on the way to a game. The route has already changed,
    // so the shell has already trimmed the top padding it gives game pages,
    // and the hub column underneath is sliding up 12px as it fades. Following
    // it would carry that shift to the next page as a small resize; the panel
    // holds still instead, at the size the hub had.
    if (mode === 'hub' && !onHub) return
    const place = (animate) => {
      let next
      if (mode === 'hub' && hubSlot) {
        next = offsetBox(hubSlot)
        if (next.height > TAB_PX + 1) hubOpenTop = next.top
      } else {
        next = pageBox(open)
      }
      setTransition(animate ? GLIDE : SNAP)
      setBox(prev => (sameBox(prev, next) ? prev : next))
      // The space above the panel, from the top of the joystick grid (level
      // with the instructions card) down to a gap above the chat.
      if (mode === 'full' && stickGrid) {
        const top = Math.max(columnBox().top, offsetBox(stickGrid).top)
        const up = { top, left: next.left, width: next.width, height: Math.max(0, next.top - top) }
        setUpperBox(prev => (sameBox(prev, up) ? prev : up))
      } else {
        setUpperBox(null)
      }
    }
    // First appearance on a page is the slide up (see `initial` below), not
    // a glide from wherever the panel last was. Opening or closing the chat
    // off the hub glides too; on the hub the column's own transition does it.
    const moved = modeRef.current !== null && modeRef.current !== mode
    const toggled = mode !== 'hub' && openRef.current !== open
    place(moved || toggled)
    modeRef.current = mode
    openRef.current = open

    let frame = 0
    const track = () => {
      if (frame) return
      frame = requestAnimationFrame(() => { frame = 0; place(false) })
    }
    window.addEventListener('resize', track)
    const ro = typeof ResizeObserver === 'function' && hubSlot && mode === 'hub' ? new ResizeObserver(track) : null
    // (Only reached on the hub itself: see the early return above.)
    ro?.observe(hubSlot)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('resize', track)
      ro?.disconnect()
    }
  }, [mounted, mode, hubSlot, open, stickGrid, onHub])

  const value = {
    available,
    open, setOpen,
    grow, setGrow,
    resizing, setResizing,
    setHubSlot,
    setStickGrid,
    upperEl,
    docked: mounted && mode === 'full',
    registerStick: () => {
      setStickCount(c => c + 1)
      return () => setStickCount(c => c - 1)
    },
  }

  const hidden = mode === 'hidden'
  // Off the bottom of the window, whatever height the panel has.
  const away = typeof window !== 'undefined' ? window.innerHeight - (box?.top ?? 0) + 24 : 1000

  return (
    <DockContext.Provider value={value}>
      {children}
      <AnimatePresence>
        {mounted && box && (
          <motion.div
            key="cbat-lounge-dock"
            data-testid="cbat-lounge-dock"
            data-dock-mode={mode}
            aria-hidden={hidden ? 'true' : undefined}
            className="fixed z-20 flex flex-col justify-end"
            initial={{ ...box, y: away, opacity: 0 }}
            animate={{ ...box, y: hidden ? away : 0, opacity: hidden ? 0 : 1 }}
            exit={{ y: away, opacity: 0, transition: GLIDE }}
            transition={{
              ...transition,
              // Sliding in and out always animates, even while the box itself
              // is being tracked frame by frame.
              y:       GLIDE,
              opacity: { duration: 0.35, ease: 'easeOut' },
            }}
            style={{ pointerEvents: hidden ? 'none' : undefined }}
          >
            <CbatLoungeChat
              open={open}
              onToggle={setOpen}
              collapsible
              grow={DEFAULT_LOUNGE_GROW}
              resizing={resizing}
              split={false}
            />
          </motion.div>
        )}
      </AnimatePresence>
      {/* Above the panel on a joystick game: the column the instructions
          card's right-hand panel is drawn into (ACT's headphones notice), so
          it stays on the card's right while the chat keeps its hub size below
          it. Filled by CbatStickLayout through a portal. */}
      {mounted && upperBox && (
        <div
          ref={setUpperEl}
          data-testid="cbat-lounge-dock-upper"
          className="fixed z-20 overflow-y-auto"
          style={upperBox}
        />
      )}
    </DockContext.Provider>
  )
}

const SLOT_TRANSITION = 'flex-grow 450ms cubic-bezier(.22,1,.36,1), flex-basis 450ms cubic-bezier(.22,1,.36,1)'

// The hub's placeholder for the panel: an empty box in the side column, sized
// by the same flex split the chat itself used to take, which the docked panel
// lines up over. A real box rather than a wrapper, because the resize handle
// measures its neighbours to turn a drag into a split.
export function LoungeHubSlot() {
  const dock = useLoungeDock()
  if (!dock?.available) return null
  const { setHubSlot, open, grow, resizing } = dock
  return (
    <div
      ref={setHubSlot}
      data-testid="cbat-lounge-hub-slot"
      aria-hidden="true"
      className="min-h-0"
      style={open
        ? { flexGrow: grow, flexShrink: 1, flexBasis: '0px', transition: resizing ? 'none' : SLOT_TRANSITION }
        : { flexGrow: 0, flexShrink: 0, flexBasis: `${TAB_PX}px`, transition: SLOT_TRANSITION }}
    />
  )
}
