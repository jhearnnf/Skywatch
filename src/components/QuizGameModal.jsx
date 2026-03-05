import { useEffect, useState, useRef, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'

export default function QuizGameModal({ briefId, onClose, onComplete }) {
  const { API } = useAuth()

  const [phase,      setPhase]      = useState('loading') // loading|question|answering|feedback|results|error
  const [attemptId,  setAttemptId]  = useState(null)
  const [sessionId,  setSessionId]  = useState(null)
  const [questions,  setQuestions]  = useState([])
  const [difficulty, setDifficulty] = useState('easy')
  const [qIndex,     setQIndex]     = useState(0)
  const [selected,   setSelected]   = useState(null)
  const [isCorrect,  setIsCorrect]  = useState(null)
  const [correctId,  setCorrectId]  = useState(null)
  const [score,      setScore]      = useState(0)
  const [earnedCoins, setEarnedCoins] = useState(0)   // awarded at end
  const [errorMsg,   setErrorMsg]   = useState('')
  const startTime     = useRef(null)
  const abandonedRef  = useRef(false)
  const completedRef  = useRef(false)

  // Load questions on mount
  useEffect(() => {
    fetch(`${API}/api/games/quiz/start`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ briefId }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.status !== 'success') {
          setErrorMsg(data.message ?? 'Could not load quiz.')
          setPhase('error')
          return
        }
        setAttemptId(data.data.attemptId)
        setSessionId(data.data.gameSessionId)
        setQuestions(data.data.questions)
        setDifficulty(data.data.difficulty)
        setPhase('question')
        startTime.current = Date.now()
      })
      .catch(() => { setErrorMsg('Connection failed.'); setPhase('error') })
  }, [API, briefId])

  // Finish attempt — returns aircoins earned
  const finishAttempt = useCallback(async (status) => {
    if (!attemptId || abandonedRef.current) return 0
    abandonedRef.current = true
    const res = await fetch(`${API}/api/games/quiz/attempt/${attemptId}/finish`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }).then(r => r.json()).catch(() => ({}))
    return res?.data?.aircoinsEarned ?? 0
  }, [API, attemptId])

  const handleClose = useCallback(async () => {
    if (phase === 'results') {
      // Quiz was completed — fire onComplete with coins earned
      onComplete?.(earnedCoins)
      onClose()
      return
    }
    if (phase !== 'loading' && phase !== 'error') {
      await finishAttempt('abandoned')
    }
    onClose()
  }, [phase, finishAttempt, onClose, onComplete, earnedCoins])

  // Escape key
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') handleClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [handleClose])

  // Lock scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const handleAnswer = async (answerId) => {
    if (phase !== 'question') return
    setPhase('answering')
    setSelected(answerId)

    const q     = questions[qIndex]
    const taken = Math.round((Date.now() - startTime.current) / 1000)

    const res = await fetch(`${API}/api/games/quiz/result`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questionId:         q._id,
        displayedAnswerIds: q.displayedAnswerIds,
        selectedAnswerId:   answerId,
        timeTakenSeconds:   taken,
        gameSessionId:      sessionId,
        attemptId,
      }),
    }).then(r => r.json()).catch(() => ({ status: 'error' }))

    const correct = res.data?.isCorrect ?? false
    if (correct) setScore(s => s + 1)
    setIsCorrect(correct)
    setCorrectId(q.correctAnswerId)
    setPhase('feedback')
    startTime.current = Date.now()
  }

  const handleNext = async () => {
    const next = qIndex + 1
    if (next >= questions.length) {
      // All questions answered — complete and get coins
      const coins = await finishAttempt('completed')
      setEarnedCoins(coins)
      completedRef.current = true
      setPhase('results')
    } else {
      setQIndex(next)
      setSelected(null)
      setIsCorrect(null)
      setCorrectId(null)
      setPhase('question')
    }
  }

  const overlay = (e) => { if (e.target === e.currentTarget) handleClose() }
  const q = questions[qIndex]

  return (
    <div className="modal-overlay" onClick={overlay} role="dialog" aria-modal="true" aria-label="Knowledge Check">
      <div className="modal quiz-modal">

        {/* Header */}
        <div className="modal__header">
          <div className="modal__header-left">
            <span className="modal__eyebrow">Knowledge Check · {difficulty === 'easy' ? 'Easy' : 'Medium'}</span>
            {phase === 'question' || phase === 'feedback' || phase === 'answering'
              ? <h2 className="modal__title">Question {qIndex + 1} of {questions.length}</h2>
              : <h2 className="modal__title">Quiz Game</h2>
            }
          </div>
          <button className="modal__close" onClick={handleClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M2 2l14 14M16 2L2 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="modal__body">

          {/* Loading */}
          {phase === 'loading' && (
            <div className="quiz-loading">
              <div className="app-loading__spinner" />
              <p>Preparing your briefing…</p>
            </div>
          )}

          {/* Error */}
          {phase === 'error' && (
            <div className="quiz-error">
              <p className="quiz-error__icon">⚠</p>
              <p className="quiz-error__msg">{errorMsg}</p>
            </div>
          )}

          {/* Question / Feedback */}
          {(phase === 'question' || phase === 'answering' || phase === 'feedback') && q && (
            <div className="quiz-question-wrap">
              {/* Progress dots */}
              <div className="quiz-progress">
                {questions.map((_, i) => (
                  <span key={i} className={`quiz-progress__dot ${i < qIndex ? 'quiz-progress__dot--done' : i === qIndex ? 'quiz-progress__dot--active' : ''}`} />
                ))}
              </div>

              <p className="quiz-question">{q.question}</p>

              <div className="quiz-answers">
                {q.answers.map(a => {
                  const strId = String(a._id)
                  let cls = 'quiz-answer'
                  if (phase === 'feedback' || phase === 'answering') {
                    if (strId === String(correctId))     cls += ' quiz-answer--correct'
                    else if (strId === String(selected)) cls += ' quiz-answer--wrong'
                  }
                  return (
                    <button
                      key={strId}
                      className={cls}
                      onClick={() => handleAnswer(a._id)}
                      disabled={phase !== 'question'}
                    >
                      {a.title}
                    </button>
                  )
                })}
              </div>

              {phase === 'feedback' && (
                <div className={`quiz-feedback ${isCorrect ? 'quiz-feedback--correct' : 'quiz-feedback--wrong'}`}>
                  <span className="quiz-feedback__icon">{isCorrect ? '✓' : '✗'}</span>
                  <span className="quiz-feedback__text">
                    {isCorrect ? 'Correct!' : 'Incorrect'}
                  </span>
                  <button className="btn-primary quiz-next-btn" onClick={handleNext}>
                    {qIndex + 1 < questions.length ? 'Next Question →' : 'See Results →'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Results */}
          {phase === 'results' && (
            <div className="quiz-results">
              <p className="quiz-results__eyebrow">Debrief</p>
              <div className="quiz-results__score">
                <span className="quiz-results__fraction">{score} / {questions.length}</span>
                <span className="quiz-results__pct">{Math.round((score / questions.length) * 100)}%</span>
              </div>
              {earnedCoins > 0 && (
                <p className="quiz-results__coins">⬡ +{earnedCoins} Aircoins earned</p>
              )}
              {earnedCoins === 0 && completedRef.current && (
                <p className="quiz-results__coins quiz-results__coins--none">No Aircoins awarded — retake does not earn extra coins.</p>
              )}
              <div className={`quiz-results__badge ${score === questions.length ? 'quiz-results__badge--gold' : score >= Math.ceil(questions.length / 2) ? 'quiz-results__badge--pass' : 'quiz-results__badge--fail'}`}>
                {score === questions.length ? 'Perfect Score' : score >= Math.ceil(questions.length / 2) ? 'Mission Passed' : 'Mission Failed'}
              </div>
              <button className="btn-primary" style={{ marginTop: '1.5rem' }} onClick={handleClose}>
                Close
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
