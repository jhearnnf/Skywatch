import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGameChrome } from '../../context/GameChromeContext'
import { getActiveMock, MOCK_ROUTE } from '../../lib/cbatMockSession'

// The end of one test inside a Mock Assessment. No score, no boards, no trend: the real test
// moves straight on, and so does this. The run is still saved and still counts everywhere; the
// player sees all of it on the score sheet at the end.
//
// Continue waits for the save to confirm, because that save is what moves the mock to the next
// test (the server claims the run as it stores it). A run that could only be queued offline has
// not reached the mock, so the player is told plainly and sent back to sit it again.
const STALL_MS = 15000

export default function CbatMockGameOver({ scoreSaved, queued }) {
  const navigate = useNavigate()
  const { enterGameOver, exitGameOver } = useGameChrome()
  const mock = getActiveMock()

  useEffect(() => {
    enterGameOver()
    return exitGameOver
  }, [enterGameOver, exitGameOver])

  // A save that is refused outright is neither saved nor queued, and would otherwise leave the
  // panel on "Saving" forever. After a while, offer the way back regardless.
  const [stalled, setStalled] = useState(false)
  useEffect(() => {
    if (scoreSaved || queued) return undefined
    const t = setTimeout(() => setStalled(true), STALL_MS)
    return () => clearTimeout(t)
  }, [scoreSaved, queued])

  const back = () => navigate(`${MOCK_ROUTE}${mock ? `?after=${mock.id}` : ''}`)
  const saving = !scoreSaved && !queued

  return (
    <div className="max-w-md mx-auto text-center py-8 px-4" data-testid="cbat-mock-game-over">
      <p className="text-[11px] uppercase tracking-wide text-slate-500 font-bold mb-1">Mock Assessment</p>
      <h2 className="text-xl font-extrabold text-slate-900 mb-2">Test complete</h2>

      {saving && !stalled && (
        <p className="text-sm text-slate-600 mb-5" data-testid="cbat-mock-saving">Saving your answers…</p>
      )}

      {scoreSaved && (
        <>
          <p className="text-sm text-slate-600 mb-5">
            Your result is saved. You will see every score on your score sheet at the end.
          </p>
          <button
            type="button"
            onClick={back}
            data-testid="cbat-mock-continue"
            className="px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg text-sm transition-colors"
          >
            Continue assessment
          </button>
        </>
      )}

      {((queued && !scoreSaved) || (saving && stalled)) && (
        <>
          <p className="text-sm text-slate-600 mb-5" data-testid="cbat-mock-queued">
            We could not send this result, so it does not count towards your assessment yet. Check
            your connection, then go back and sit this test again.
          </p>
          <button
            type="button"
            onClick={back}
            className="px-6 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-lg text-sm transition-colors"
          >
            Back to the assessment
          </button>
        </>
      )}
    </div>
  )
}
