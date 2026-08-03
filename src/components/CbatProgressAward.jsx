import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import Overlay from './ui/Overlay'
import useCountUp from '../hooks/useCountUp'
import { awardTitle, awardSummary } from '../utils/cbatProgressAward'

// The CBAT progress-award milestone: a short celebration shown when a player's recent form has
// improved measurably on their early runs at a game (see backend/utils/cbatProgressAward.js for
// when it fires), plus the donation footnote that may follow it.
//
// TWO components, and the separation is the whole design.
//
// <CbatProgressAward> is a celebration and nothing else. Folding the donation ask into it would
// teach users that "milestone" means "money ask", which retroactively makes the achievement read
// as invented to justify the ask — killing the credibility of both. <CbatDonationNote> is a
// separate, quieter beat that appears only after the celebration has been dismissed, and it is
// visually subordinate to it: small, inline, and dismissible in one click.
//
// The milestone screen also has to be worth showing on its own. It ships enabled independently of
// the donation flag precisely so it keeps working as a retention feature if the ask is switched
// off — if it were only worth building because money is attached, it should not be built.

// Celebration beats. The ring sweeps and the number counts together — they are two readings of
// one fact, so splitting them would read as two separate events. The donation note is not on this
// timeline at all; it waits for the user to dismiss this.
const RING_MS = 900
const COUNT_MS = 900
const SUMMARY_DELAY = 0.55   // seconds — the sentence lands while the number is still moving

// Ring geometry. The centre has to hold the widest percentage the award can ever state, and the
// figure is unbounded on the high side — a lower-is-better game halving its rotations reads +50%,
// but nothing stops a big higher-is-better swing printing +120%. Sizing to "+34%" left a
// three-digit value colliding with the stroke.
//
// Inner diameter = 2 × (RING_R − RING_SW/2) = 112px, against ~90px for "+120%" at text-3xl in the
// mono face. That clearance is the reason the game emoji is NOT in here: stacked under the number
// it took the vertical room the same way, and the summary line below already names the game.
const RING_BOX = 144
const RING_R = 60
const RING_SW = 8
const RING_C = 2 * Math.PI * RING_R

export default function CbatProgressAward({ tier, pct, attempts, gameTitle, gameEmoji, onDismiss }) {
  const shown = useCountUp(pct, { duration: COUNT_MS })

  // <Overlay> rather than a bare fixed div: it portals out (the results screen's root animates
  // `scale`, and a transformed ancestor would make `position: fixed` resolve against that card
  // instead of the viewport), and it redirects into the stage element when a game is running
  // inside a landing-page demo card, where an overlay must not escape and cover the page.
  return (
    <Overlay
      backdrop="rgba(6, 16, 30, 0.95)"
      onDismiss={onDismiss}
      className="flex items-center justify-center px-5"
      data-testid="cbat-progress-award"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
        className="w-full max-w-sm bg-[#0a1628] border border-[#1a3a5c] rounded-2xl p-7 text-center"
      >
        {/* The emoji identifies the game up here rather than inside the ring, where it was
            competing with the number for the same 112px. */}
        <div className="flex items-center justify-center gap-2 mb-5">
          <span className="text-sm" aria-hidden="true">{gameEmoji}</span>
          <p className="text-[10px] text-slate-500 uppercase tracking-[0.2em]">Progress milestone</p>
        </div>

        <div
          className="relative mx-auto mb-5"
          style={{ width: RING_BOX, height: RING_BOX }}
        >
          <svg viewBox={`0 0 ${RING_BOX} ${RING_BOX}`} className="w-full h-full -rotate-90">
            <circle
              cx={RING_BOX / 2} cy={RING_BOX / 2} r={RING_R}
              fill="none" stroke="#1a3a5c" strokeWidth={RING_SW}
            />
            <motion.circle
              cx={RING_BOX / 2} cy={RING_BOX / 2} r={RING_R}
              fill="none" stroke="#5baaff" strokeWidth={RING_SW} strokeLinecap="round"
              strokeDasharray={RING_C}
              initial={{ strokeDashoffset: RING_C }}
              animate={{ strokeDashoffset: 0 }}
              transition={{ duration: RING_MS / 1000, ease: 'easeOut' }}
            />
          </svg>
          {/* leading-none so the glyph box doesn't push the number off the ring's optical centre,
              and tabular figures so it doesn't jitter sideways while the count-up runs. */}
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-3xl font-mono font-bold text-brand-300 leading-none tabular-nums">
              +{shown}%
            </span>
          </div>
        </div>

        <h2 className="text-xl font-extrabold text-amber-300 mb-2">{awardTitle(tier)}</h2>

        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: SUMMARY_DELAY }}
        >
          <p className="text-sm text-[#ddeaf8] leading-relaxed">{awardSummary(pct, gameTitle)}</p>
          {attempts != null && (
            <p className="text-[11px] text-slate-500 mt-1.5">Across {attempts} attempts</p>
          )}
        </motion.div>

        <button
          onClick={onDismiss}
          className="mt-6 w-full px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold rounded-lg transition-colors"
        >
          Continue
        </button>
      </motion.div>
    </Overlay>
  )
}

// The donation footnote. Rendered inline on the results screen after the celebration above has
// been dismissed — never inside it, and never before it.
//
// Copy notes, both deliberate:
//   - It names a concrete amount. An open-ended "support us" converts far worse than a small
//     specific one, and the destination page is where a range of amounts belongs.
//   - It states what Skywatch costs the user (nothing, no ads) and asks. It does NOT suggest the
//     site or their progress is at risk without them. Manufactured jeopardy converts worse than
//     gratitude and is a bad thing to do to someone who has just been congratulated.
//
// TWO controls, and no more. The results screen already carries Play Again and both leaderboards
// (plus per-game extras like Change Aircraft), so anything added here is competing with the
// primary action for the same glance.
//
// An earlier version had three — "Support", "Not now" and "Already supported" — which came from
// putting a button on screen for each state the backend tracks rather than for each thing a user
// wants to do. Nobody needs two ways to say no. The × carries the whole of "no", and the
// two-dismissal cap still gets a genuine supporter to silence permanently; it just costs them a
// second dismissal instead of a button everyone else has to look past.
//
// A dismiss icon rather than a text button is the other half of it: this then reads as a
// dismissible notice, which is what it is, instead of a third cluster of buttons.
export function CbatDonationNote({ url, onRecord }) {
  const [gone, setGone] = useState(false)
  const reported = useRef(false)

  // The impression is reported from here, on render, rather than inferred from the server having
  // decided the note was due — that decision is made while the award overlay is still covering the
  // screen, so it would count people who left before this ever appeared. It is the denominator of
  // the admin funnel stat, so counting it honestly is the whole point.
  //
  // The ref guard keeps StrictMode's double-invoke (and any remount) from double-counting.
  useEffect(() => {
    if (reported.current || !url) return
    reported.current = true
    onRecord?.('shown')
  }, [url])  // eslint-disable-line react-hooks/exhaustive-deps

  const close = (action) => { setGone(true); onRecord?.(action) }

  if (gone || !url) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.25 }}
      className="relative bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 pr-9 text-left"
      data-testid="cbat-donation-note"
    >
      <button
        onClick={() => close('dismissed')}
        aria-label="Dismiss"
        className="absolute top-1.5 right-1.5 w-7 h-7 flex items-center justify-center text-slate-500 hover:text-slate-700 transition-colors"
      >
        ✕
      </button>
      <p className="text-xs text-[#ddeaf8] leading-relaxed">
        Skywatch is free and has no ads. If it's helping, a one-off £3 helps keep it running.
      </p>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => close('clicked')}
        className="inline-block mt-2.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold rounded-lg transition-colors no-underline"
      >
        Support Skywatch
      </a>
    </motion.div>
  )
}
