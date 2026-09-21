// Shared CBAT leaderboard row, used by both the full leaderboard page
// (src/pages/CbatLeaderboard.jsx) and the post-game reveal's weekly chase
// window (src/components/CbatGameOver.jsx) so the snippet reads as a true
// preview of the destination — same medals, same "you" highlight, same columns.
//
// Two variants:
//   weekly   — Rank · Agent · Points (weekTotal) · Plays [· Input] · Theme
//   all-time — Rank · Agent · <scoreLabel> · Time [· Input] · Theme
//
// The trailing Input column is opt-in via `cfg.showInput` (only ACT, RTT and
// SMA carry the field — see cbatGames.js). The Theme column (which site theme
// the run was played under: SkyWatch or Real CBAT) is on every board, so a
// score set under either look can be told apart at a glance. Both are dropped
// from the compact variant regardless, because the post-game chase window has
// no width to spare for another track.
//
// Name precedence matches everywhere: a precomputed `entry.name` (reveal
// neighbours) wins, else displayName → admin email → agent number.

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import CbatPassedBadge from './CbatPassedBadge'
import SupporterBadge from './SupporterBadge'
import { INPUT_METHOD_ICON, PEDALS_ICON, describeInput, normalizeInputMethod, normalizePedals } from '../utils/cbat/inputMethod'
import UiThemeMark from './UiThemeMark'
import { UI_THEME_LABELS, normalizeUiTheme } from '../lib/uiTheme'

// `compact` narrows the fixed columns for constrained containers (the post-game
// weekly-chase window, which is nested inside several layers of padding on a
// phone) so the flexible Agent column keeps enough room for names.
//
// The non-compact widths are mobile-first: the rank/score/plays columns are
// sized to their actual content below `sm` and only widen on larger screens.
// Rank is 2rem: the list is a top 20, so "#20" is the widest it holds. The one
// wider rank is the viewer's own row below the "···" when they sit outside the
// top 20, and that cell drops to text-xs for three digits (see the rank cell).
// Agent is the `1fr` column, so every rem shaved off the fixed ones goes
// straight into the name — on a 360px phone that took it from ~10 characters
// to ~19, which is what a display name or "Agent 1234" needs to read.
// Every class string below is written out in full. Tailwind only generates CSS
// for class names it can find literally in the source, so building one with a
// template literal (`grid-cols-[…${extra}]`) leaves the grid with no rule at
// all and every cell stacks into one column.
//
// The Input and Theme columns never appear compact — the post-game chase
// window is already width-starved without a fifth track. Each cell is
// icon-only (the name is the hover tooltip), so a track is 2.5rem and 3.5rem
// on `sm:`, enough for a "Mixed" week's two or three icons side by side. The
// two are the same width, so the layout only cares how many trailing icon
// tracks there are: one (Theme, every board) or two (Input as well), and
// every combination is still a full literal string below.
export const iconTrackCount = (cfg, compact = false) =>
  compact ? 0 : 1 + (cfg?.showInput ? 1 : 0)

export const rowCols = (variant, cfg, compact = false) => {
  const icons = iconTrackCount(cfg, compact)
  if (variant === 'weekly') {
    if (compact) return 'grid-cols-[2.25rem_1fr_3.25rem_2.25rem]'
    if (icons === 2) return 'grid-cols-[2rem_1fr_3.25rem_2.25rem_2.5rem_2.5rem] sm:grid-cols-[3rem_1fr_5rem_4rem_3.5rem_3.5rem]'
    return 'grid-cols-[2rem_1fr_3.25rem_2.25rem_2.5rem] sm:grid-cols-[3rem_1fr_5rem_4rem_3.5rem]'
  }
  if (cfg?.hideTime) {
    if (icons === 2) return 'grid-cols-[2rem_1fr_3.5rem_2.5rem_2.5rem] sm:grid-cols-[3rem_1fr_5rem_3.5rem_3.5rem]'
    return 'grid-cols-[2rem_1fr_3.5rem_2.5rem] sm:grid-cols-[3rem_1fr_5rem_3.5rem]'
  }
  if (icons === 2) return 'grid-cols-[2rem_1fr_3.5rem_3.5rem_2.5rem_2.5rem] sm:grid-cols-[3rem_1fr_5rem_4.5rem_3.5rem_3.5rem]'
  return 'grid-cols-[2rem_1fr_3.5rem_3.5rem_2.5rem] sm:grid-cols-[3rem_1fr_5rem_4.5rem_3.5rem]'
}

// Row padding/gutter shrink alongside the columns on mobile for the same reason.
export const rowPad = (compact = false) =>
  compact ? 'gap-1.5 px-2.5' : 'gap-1.5 px-3 sm:gap-2 sm:px-4'

const agentName = (e) =>
  e.name || e.displayName || (e.email ? e.email : `Agent ${e.agentNumber || '???'}`)

// A weekly numeric cell that can flash and carry a "+N" gain badge.
//
// The badge sits in the row's padding gutter above the number (`-top-3` against `py-2.5`),
// where it clears both the divider and the digits of the row above. It scales in rather than
// fading so it registers in peripheral vision — a user reading their score will catch the
// movement even if they never look straight at this cell.
//
// While `pulse` is on, the number turns emerald to match the badge and pops once. The colour
// swap is a class change, not a tween: a flash should arrive instantly and it keeps the two
// theme colours out of the animation's keyframes. `tone` is kept separate from `className` for
// that swap — folding the colour into className would leave two competing text-* classes on the
// element, resolved by stylesheet order rather than by intent, and would drop the weight the
// cell is normally rendered at for the duration of the pulse.
function GainCell({ value, gain, pulse, tone, className = '' }) {
  return (
    <span className={`relative text-right font-mono ${className} ${pulse ? 'text-emerald-300' : tone}`}>
      {gain && (
        <motion.span
          initial={{ opacity: 0, y: 5, scale: 0.7 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 22 }}
          className="absolute -top-3 right-0 text-[9px] font-bold text-emerald-300 whitespace-nowrap pointer-events-none"
        >
          {gain}
        </motion.span>
      )}
      <motion.span
        className="inline-block"
        animate={pulse ? { scale: [1, 1.3, 1] } : { scale: 1 }}
        transition={{ duration: 0.55, ease: 'easeOut' }}
      >
        {value}
      </motion.span>
    </span>
  )
}

// The Input column's cell. All-time carries one `entry.inputMethod` (the run
// that set the best score); weekly carries `entry.inputMethods`, the distinct
// non-null methods across every play the user made this week, because one
// weekly total can be built from runs on different controls.
//
// Icon only. The name lives in the hover tooltip (`title`) and in `aria-label`
// for anyone not using a mouse; a text label was tried and it cost the Agent
// column more width than a three-value column deserves. Two or more distinct
// methods in a week show every icon rather than picking one — picking one
// would hide that the total isn't comparable to a single-device rival's. No
// recorded method (an older score) shows a muted "?" rather than a blank, so
// it reads as "unknown" and not as a rendering bug.
//
// Pedals (SMA only) are not a method of their own but a partner to one — they
// hold the lateral axis while the method holds the vertical — so `entry.pedals`
// adds the pedal icon AFTER the method's, in the same cell: a stick-and-pedals
// run reads 🕹️🦶. Weekly carries one `pedals` for the week: true if any run
// that week was flown on them, for the same reason the methods are a set.
function InputMethodCell({ variant, entry }) {
  const methods = variant === 'weekly'
    ? (entry.inputMethods || []).map(normalizeInputMethod).filter(Boolean)
    : (normalizeInputMethod(entry.inputMethod) ? [entry.inputMethod] : [])
  const pedals = normalizePedals(entry.pedals) === true

  const cellClass = 'flex items-center justify-end gap-0.5 text-right text-xs text-slate-400 whitespace-nowrap cursor-help'
  const label = describeInput(methods, pedals)

  return (
    <span className={cellClass} data-testid="input-method" data-pedals={pedals ? 'true' : undefined} title={label} aria-label={label}>
      {methods.length || pedals
        ? <>
            {methods.map(m => <span key={m} aria-hidden="true">{INPUT_METHOD_ICON[m]}</span>)}
            {pedals && <span aria-hidden="true">{PEDALS_ICON}</span>}
          </>
        : '?'}
    </span>
  )
}

// The Theme column's cell, the Input cell's twin: all-time carries one
// `entry.uiTheme` (the run that set the best score), weekly carries
// `entry.uiThemes`, the distinct non-null themes across the week's plays. A
// week played under both shows both marks, because on the games whose Real
// CBAT variant is a different screen the total is not comparable to a
// single-theme rival's. No recorded theme (a score older than the field)
// shows the muted "?" the Input cell uses, for the same reason.
function UiThemeCell({ variant, entry }) {
  const themes = variant === 'weekly'
    ? (entry.uiThemes || []).map(normalizeUiTheme).filter(Boolean)
    : (normalizeUiTheme(entry.uiTheme) ? [entry.uiTheme] : [])

  const cellClass = 'flex items-center justify-end gap-0.5 text-right text-xs text-slate-400 whitespace-nowrap cursor-help'
  const label = themes.length ? themes.map(t => UI_THEME_LABELS[t]).join(', ') : 'Not recorded'

  return (
    <span className={cellClass} data-testid="ui-theme" data-themes={themes.join(' ')} title={label} aria-label={label}>
      {themes.length
        ? themes.map(t => <UiThemeMark key={t} theme={t} />)
        : '?'}
    </span>
  )
}

// A sideways scroller with a fade on whichever edge is clipped. The fade is
// the hint that there is more: the cut-off content dissolves instead of
// stopping dead, the same cue a horizontal chip strip gives. It is a mask on
// the scroller so it needs no knowledge of the row's background (the "you"
// row is tinted). Which edge fades follows the scroll position, so once you
// have swiped to the end the fade moves to the left and the revealed end is
// fully legible; content that fits gets no fade at all. Both the scroller and
// its content are observed because a web font landing changes the content's
// width without touching the scroller's. The scrollbar is hidden so a cell
// that fits looks exactly as it always did.
const FADE_CLASS = { none: '', right: 'scroll-fade-r', left: 'scroll-fade-l', both: 'scroll-fade-x' }

function useScrollFade(ref, contentRef, deps) {
  const [fade, setFade] = useState('none')
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const max = el.scrollWidth - el.clientWidth
      if (max <= 1) return setFade('none')
      const x = el.scrollLeft
      setFade(x <= 1 ? 'right' : x >= max - 1 ? 'left' : 'both')
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    ro?.observe(el)
    if (contentRef.current) ro?.observe(contentRef.current)
    return () => {
      el.removeEventListener('scroll', update)
      ro?.disconnect()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return fade
}

// The Agent cell: the name and the marks (Passed, Supporter).
//
// The marks have priority and are always shown in full. On a phone that means
// STACKING: the name takes the whole column on its own line and the marks wrap
// beneath it. The column is ~19 characters there and as little as 6 on a board
// with the Input column, where a name and two words cannot share a line at all.
// Every inline arrangement tried either truncated the name to nothing
// ("James_Sk...") or pushed a mark out of view with no cue that it existed,
// which is worse than a slightly taller row for the few agents who carry one.
// From `sm` up the column has room, so the two sit inline: the marks are
// `shrink-0` and the name is the one that gives way (`flex-1`, floor `min-w-10`).
//
// The name never truncates. It scrolls sideways with the fade as the cue, and
// `overscroll-x-contain` stops the swipe leaking into the browser's back
// gesture once it hits the end. `max-w-full` is what caps it to the column in
// the stacked layout (a flex-col item with `items-start` is otherwise
// shrink-to-fit and would overflow the cell instead of scrolling).
//
// `marks` is passed pre-gated (null when there are none) so the stacked layout
// does not leave an empty second line under a plain name.
function AgentCell({ isMe, title, name, marks, onClick }) {
  const nameRef = useRef(null)
  const textRef = useRef(null)
  const fade = useScrollFade(nameRef, textRef, [name])
  const Name = onClick ? 'button' : 'span'

  return (
    <span
      data-testid="agent-cell"
      className={`min-w-0 flex flex-col items-start gap-0.5 sm:flex-row sm:items-center sm:gap-1 ${isMe ? 'text-brand-600 font-bold' : 'text-game-text'}`}
    >
      <span
        ref={nameRef}
        data-testid="agent-name"
        data-fade={fade}
        className={`max-w-full sm:flex-1 sm:min-w-10 overflow-x-auto overflow-y-hidden overscroll-x-contain scrollbar-none whitespace-nowrap ${FADE_CLASS[fade]}`}
      >
        {/* inline-block so the text has a box of its own to measure; the admin
            timestamp tooltip sits on the text because it is about the name */}
        <Name
          ref={textRef}
          type={onClick ? 'button' : undefined}
          onClick={onClick}
          className={`inline-block text-left ${onClick ? 'cursor-pointer hover:underline focus-visible:underline focus-visible:outline-none' : title ? 'cursor-help' : ''}`}
          {...(title ? { title } : {})}
        >
          {name}
        </Name>
      </span>
      {/* One wrapping row of marks under the name on a phone; `sm:contents`
          dissolves the wrapper so the marks become inline siblings of the name. */}
      {marks && (
        <span data-testid="agent-marks" className="flex flex-wrap items-center gap-1 sm:contents">
          {marks}
        </span>
      )}
    </span>
  )
}

// `layout` opts a row into framer's FLIP reordering (used only during the
// leaderboard's post-game rank slide). `delta` is the change in position for the
// user's own row during that slide (positive = climbed) and renders a small
// ↑/↓ badge next to the rank; both are inert everywhere else.
//
// `gains` ({ points, plays }) annotates the weekly numeric cells with what the run
// just added ("+120", "+1"), and `pulse` illuminates them while that lands — both
// used only by the post-game increment replay, and both inert on the full board.
// The annotations are absolutely positioned in the row's vertical gutter: the
// weekly columns are sized to the digits they hold (see rowCols), so anything
// added in-flow would either reflow the grid or clip.
export default function LeaderboardRow({ entry, variant, cfg = {}, isMe = false, divider = false, layout = false, delta = null, compact = false, gains = null, pulse = false, onOpenUser }) {
  const achievedAtTitle = entry.achievedAt
    ? new Date(entry.achievedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
    : null

  return (
    <motion.div
      layout={layout}
      transition={{ layout: { duration: 0.6, ease: [0.4, 0, 0.2, 1] } }}
      className={`grid ${rowCols(variant, cfg, compact)} ${rowPad(compact)} py-2.5 text-sm ${divider ? 'border-t border-game-line' : ''} ${
        isMe ? 'bg-brand-600/10 border-l-2 border-l-brand-400' : ''
      }`}
    >
      <span className={`font-mono font-bold text-slate-400 flex items-center gap-1 whitespace-nowrap ${entry.rank >= 100 ? 'text-xs' : ''}`}>
        {entry.rank <= 3 ? ['🥇', '🥈', '🥉'][entry.rank - 1] : `#${entry.rank}`}
        {delta != null && delta !== 0 && (
          <motion.span
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`text-[10px] font-bold ${delta > 0 ? 'text-green-400' : 'text-red-400'}`}
          >
            {delta > 0 ? `▲${delta}` : `▼${Math.abs(delta)}`}
          </motion.span>
        )}
      </span>
      <AgentCell
        onClick={onOpenUser && entry.userId && !entry.isFake ? () => onOpenUser(entry.userId) : undefined}
        isMe={isMe}
        title={achievedAtTitle}
        name={`${agentName(entry)}${isMe ? ' (you)' : ''}`}
        marks={(entry.cbatPassed || entry.supporter) ? (
          <>
            {entry.cbatPassed && <CbatPassedBadge />}
            {entry.supporter && <SupporterBadge />}
          </>
        ) : null}
      />
      {variant === 'weekly' ? (
        <>
          <GainCell value={entry.weekTotal} gain={gains?.points} pulse={pulse} tone="text-brand-600" className="font-bold" />
          <GainCell value={entry.plays} gain={gains?.plays} pulse={pulse} tone="text-slate-400" />
          {cfg?.showInput && !compact && <InputMethodCell variant={variant} entry={entry} />}
          {!compact && <UiThemeCell variant={variant} entry={entry} />}
        </>
      ) : (
        <>
          <span className="text-right font-mono font-bold text-brand-600">
            {cfg.formatScore ? cfg.formatScore(entry.bestScore) : entry.bestScore}
          </span>
          {!cfg.hideTime && <span className="text-right font-mono text-slate-400">{entry.bestTime.toFixed(cfg.timeDecimals ?? 1)}s</span>}
          {cfg?.showInput && !compact && <InputMethodCell variant={variant} entry={entry} />}
          {!compact && <UiThemeCell variant={variant} entry={entry} />}
        </>
      )}
    </motion.div>
  )
}
