import { useLocation } from 'react-router-dom'
import { useGameChrome } from '../context/GameChromeContext'

// True while a CBAT test is being played: every game enters the immersive
// chrome for its play phases (countdown, playing, feedback) and leaves it on
// the instructions and score screens, so "immersive on a /cbat/ route" is
// exactly "mid-test". Other immersive pages (brief reader, quizzes) don't
// count. Read by anything that must not reskin or disturb a test in progress,
// such as the theme selector.
export function useCbatGameInProgress() {
  const { pathname } = useLocation()
  const { immersive } = useGameChrome()
  return immersive && pathname.startsWith('/cbat/')
}

export default useCbatGameInProgress
