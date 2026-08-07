import { useParams } from 'react-router-dom'
import DemoGameCard from '../components/landingGames/DemoGameCard'
import { GAME_DEMO_POOL } from '../components/landingGames/gameDemoPool'
import { componentForDemo } from '../components/landingGames/gameDemoRegistry'

// One self-playing CBAT game, alone on the page with no app chrome, so another
// page can iframe it. The CBAT guide (public/cbat-guide.html) is the caller:
// it is a static document outside the SPA, so an iframe is the only way it can
// show a live React game beside each test description.
//
// Deliberately the SAME DemoGameCard the landing page's wall uses, drawing from
// the same GAME_DEMO_POOL. That is what makes "only the games that already
// render correctly on the landing page" true by construction rather than by a
// second list somebody has to remember to update: a game absent from the pool
// simply has no embed, and one added to the pool gets one for free.
//
// A square stage, unlike the wall's 900×600. The guide sets these beside body
// copy in a reading column, where a square holds its own without pushing the
// text into a gutter. 640 keeps it above the app's 600px mobile breakpoint, so
// the games lay themselves out the way a desktop player sees them.
const STAGE = { w: 640, h: 640 }

export default function CbatDemoEmbed() {
  const { demoId } = useParams()
  const entry = GAME_DEMO_POOL.find((g) => g.id === demoId)
  const Game  = componentForDemo(demoId)

  // An unknown id renders nothing rather than an error: the guide frames this
  // in a box of its own, and an empty box beats a broken one.
  if (!entry || !Game) return null

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#06101e', overflow: 'hidden' }}>
      <DemoGameCard
        entry={entry}
        Component={Game}
        stage={STAGE}
        active
        // Always the signed-out link (/login?tab=register): the embed carries no
        // session of its own, and a reader who clicks it is coming from a public
        // document, not from inside the app.
        loggedIn={false}
        linkTarget="_top"
      />
    </div>
  )
}
