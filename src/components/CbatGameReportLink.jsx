import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useCbatGameInProgress } from '../hooks/useCbatGameInProgress'

// "Report a problem", pinned to the bottom corner of every CBAT game page.
//
// The hub grid and its footer both link to the form, but a bug is noticed in
// the game, and the only way there used to be back out to the hub. This puts
// the link where the problem is. It arrives with the game's route already in
// the trail, so the report names the game without the reporter having to.
//
// Desktop only (lg and up). The phone layouts are tuned to fit one screen and
// another line under the game would either scroll or squeeze the play area;
// the hub grid's own link is one tap away there. Fixed rather than in flow for
// the same reason on desktop: a game tuned to fit a 1080p viewport must not
// gain a footer that pushes its controls below the fold.
//
// Hidden mid-test. The games are timed, full-attention tasks and nothing may
// sit over the play area while one runs; the link shows on the instructions
// and score screens, which is also when anyone would actually use it.
//
// Portalled to <body>. Every route sits inside a framer-motion PageWrapper that
// slides in with a transform, and a transformed ancestor becomes the containing
// block for `position: fixed` — so in-tree, the link rode the bottom of the page
// for the length of the transition and then jumped to the viewport corner.
export default function CbatGameReportLink() {
  const inProgress = useCbatGameInProgress()
  if (inProgress) return null
  return createPortal(
    <Link
      to="/report"
      data-testid="cbat-game-report"
      className="hidden lg:inline-flex fixed bottom-3 right-4 z-30 items-center px-2 py-1 rounded-md
        text-[11px] font-semibold text-slate-500 hover:text-brand-600 bg-surface/80 backdrop-blur-sm
        underline underline-offset-2 transition-colors"
    >
      Report a problem
    </Link>,
    document.body,
  )
}
