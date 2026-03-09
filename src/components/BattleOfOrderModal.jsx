import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { playSound } from '../utils/sound'

const ORDER_TYPE_META = {
  speed:           { label: 'TOP SPEED',       direction: 'Slowest → Fastest',    startLabel: 'SLOWEST',      endLabel: 'FASTEST'     },
  year_introduced: { label: 'YEAR INTRODUCED', direction: 'Oldest → Newest',      startLabel: 'OLDEST',       endLabel: 'NEWEST'      },
  year_retired:    { label: 'YEAR RETIRED',     direction: 'Earliest → Latest',    startLabel: 'EARLIEST',     endLabel: 'LATEST'      },
  rank_hierarchy:  { label: 'RANK HIERARCHY',  direction: 'Most Senior → Junior',  startLabel: 'MOST SENIOR',  endLabel: 'MOST JUNIOR' },
  training_week:   { label: 'TRAINING PHASE',  direction: 'First Phase → Last',    startLabel: 'FIRST PHASE',  endLabel: 'LAST PHASE'  },
  start_year:      { label: 'YEAR STARTED',    direction: 'Earliest → Latest',     startLabel: 'EARLIEST',     endLabel: 'LATEST'      },
  end_year:        { label: 'YEAR CONCLUDED',  direction: 'Earliest → Latest',     startLabel: 'EARLIEST',     endLabel: 'LATEST'      },
}

const CATEGORY_ALL_TYPES = {
  Aircrafts: ['speed', 'year_introduced', 'year_retired'],
  Ranks:     ['rank_hierarchy'],
  Training:  ['training_week'],
  Missions:  ['start_year', 'end_year'],
  Tech:      ['start_year', 'end_year'],
  Treaties:  ['start_year', 'end_year'],
}

const GLITCH_CHARS = '!@#$%^&*01ABCDEF<>/\\|?~█▒░'

function corruptText(text, intensity) {
  return text.split('').map(c => {
    if (c === ' ') return c
    return Math.random() < intensity
      ? GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)]
      : c
  }).join('')
}

export default function BattleOfOrderModal({ briefId, category, onClose, onComplete }) {
  const { API } = useAuth()
  const fileIdRef = useRef(Math.random().toString(16).slice(2, 8).toUpperCase())

  // phase: loading | no_options | spinning | locked | generating | playing | result
  const [phase,             setPhase]             = useState('loading')
  const [errorMsg,          setErrorMsg]           = useState('')
  const [availableOptions,  setAvailableOptions]   = useState([])
  const [selectedOrderType, setSelectedOrderType]  = useState(null)
  const [displayText,       setDisplayText]        = useState('DECRYPTING...')
  const [game,              setGame]               = useState(null)
  const [userOrder,         setUserOrder]          = useState([])
  const [result,            setResult]             = useState(null)
  const [submitting,        setSubmitting]         = useState(false)
  const abandonedRef      = useRef(false)
  const gameIdRef         = useRef(null)
  const gameStartTimeRef  = useRef(null)

  // Fetch options on mount
  useEffect(() => {
    fetch(`${API}/api/games/battle-of-order/options?briefId=${briefId}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (data.status !== 'success' || !data.data.available) {
          const reason = data.data?.reason
          setErrorMsg(
            reason === 'ineligible_category' ? 'This category does not support Battle of Order.' :
            reason === 'insufficient_briefs'  ? 'Insufficient intel assets in this category. Add more briefs with Battle of Order data to unlock this operation.' :
            data.message ?? 'Unable to generate game.'
          )
          setPhase('no_options')
          return
        }
        setAvailableOptions(data.data.options.map(o => o.orderType))
        const picked = data.data.options[Math.floor(Math.random() * data.data.options.length)].orderType
        setSelectedOrderType(picked)
        setPhase('spinning')
      })
      .catch(() => { setErrorMsg('Connection failed.'); setPhase('no_options') })
  }, [API, briefId])

  // Spin animation
  useEffect(() => {
    if (phase !== 'spinning' || !selectedOrderType || availableOptions.length === 0) return

    const allLabels = availableOptions.map(ot => ORDER_TYPE_META[ot]?.label ?? ot)
    const lockedLabel = ORDER_TYPE_META[selectedOrderType]?.label ?? selectedOrderType
    let tick = 0
    const timers = []
    let intervalId = null

    const runAt = (interval, corruption, lockAfter) => {
      clearInterval(intervalId)
      intervalId = setInterval(() => {
        tick++
        const base = allLabels[tick % allLabels.length]
        setDisplayText(corruptText(base, corruption))
      }, interval)
      if (lockAfter != null) {
        const t = setTimeout(() => {
          clearInterval(intervalId)
          setDisplayText(lockedLabel)
          setPhase('locked')
          playSound('battle_of_order_selection')
        }, lockAfter)
        timers.push(t)
      }
    }

    runAt(55,  0.65, null)
    timers.push(setTimeout(() => runAt(120, 0.35, null), 1200))
    timers.push(setTimeout(() => runAt(220, 0.15, null), 1800))
    timers.push(setTimeout(() => runAt(400, 0.04, 700),  2300))

    return () => {
      clearInterval(intervalId)
      timers.forEach(clearTimeout)
    }
  }, [phase, selectedOrderType, availableOptions])

  const handleEngage = useCallback(() => {
    if (!selectedOrderType) return
    setPhase('generating')
    fetch(`${API}/api/games/battle-of-order/generate`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ briefId, orderType: selectedOrderType }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.status !== 'success') {
          setErrorMsg(data.message ?? 'Game generation failed.')
          setPhase('no_options')
          return
        }
        const { gameId, choices, orderType, difficulty } = data.data
        gameIdRef.current        = gameId
        gameStartTimeRef.current = Date.now()
        setGame({ gameId, orderType, difficulty })
        setUserOrder(choices)
        setPhase('playing')
      })
      .catch(() => { setErrorMsg('Connection failed.'); setPhase('no_options') })
  }, [API, briefId, selectedOrderType])

  const moveCard = (index, dir) => {
    setUserOrder(prev => {
      const arr = [...prev]
      const swap = index + dir
      if (swap < 0 || swap >= arr.length) return prev
      ;[arr[index], arr[swap]] = [arr[swap], arr[index]]
      return arr
    })
  }

  const handleSubmit = useCallback(async () => {
    if (submitting || !game) return
    setSubmitting(true)
    const userChoices = userOrder.map((item, idx) => ({
      choiceId: item.choiceId,
      userOrderNumber: idx + 1,
    }))
    const timeTakenSeconds = gameStartTimeRef.current
      ? Math.round((Date.now() - gameStartTimeRef.current) / 1000)
      : null
    try {
      const res  = await fetch(`${API}/api/games/battle-of-order/submit`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: game.gameId, userChoices, timeTakenSeconds }),
      })
      const data = await res.json()
      if (data.status !== 'success') throw new Error(data.message)
      const { won, aircoinsEarned, rankPromotion, cycleAircoins, correctReveal, alreadyCompleted } = data.data
      abandonedRef.current = false
      setResult({ won, aircoinsEarned, correctReveal, alreadyCompleted })
      setPhase('result')
      playSound(won ? 'battle_of_order_won' : 'battle_of_order_lost')
      if (won) {
        onComplete?.(aircoinsEarned, { rankPromotion, cycleAircoins, orderType: game.orderType })
      }
    } catch (err) {
      setErrorMsg(err.message ?? 'Submission failed.')
    } finally {
      setSubmitting(false)
    }
  }, [API, game, userOrder, submitting, onComplete])

  const handleClose = useCallback(() => {
    if (gameIdRef.current && phase === 'playing' && !abandonedRef.current) {
      abandonedRef.current = true
      const timeTakenSeconds = gameStartTimeRef.current
        ? Math.round((Date.now() - gameStartTimeRef.current) / 1000)
        : null
      fetch(`${API}/api/games/battle-of-order/abandon`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: gameIdRef.current, timeTakenSeconds }),
      }).catch(() => {})
    }
    onClose?.()
  }, [API, phase, onClose])

  const handlePlayAgain = () => {
    gameIdRef.current = null
    abandonedRef.current = false
    setGame(null)
    setUserOrder([])
    setResult(null)
    setErrorMsg('')
    setAvailableOptions([])
    setSelectedOrderType(null)
    setDisplayText('DECRYPTING...')
    setPhase('loading')
    fetch(`${API}/api/games/battle-of-order/options?briefId=${briefId}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (!data.data?.available) { setErrorMsg('No options available.'); setPhase('no_options'); return }
        const opts = data.data.options.map(o => o.orderType)
        setAvailableOptions(opts)
        const picked = opts[Math.floor(Math.random() * opts.length)]
        setSelectedOrderType(picked)
        setPhase('spinning')
      })
      .catch(() => { setErrorMsg('Connection failed.'); setPhase('no_options') })
  }

  const meta = game ? ORDER_TYPE_META[game.orderType] : null
  const lockedMeta = selectedOrderType ? ORDER_TYPE_META[selectedOrderType] : null

  return (
    <div className="modal-overlay" role="dialog" aria-label="Battle of Order - Mini Game">
      <div className="modal boa-modal">

        {/* Classification banner */}
        <div className="boa-cls-banner">
          <span className="boa-cls-banner__level">▐ RESTRICTED ▌</span>
          <span className="boa-cls-banner__ref">REF: BOO-{fileIdRef.current}</span>
        </div>

        {/* Header */}
        <div className="modal__header boa-modal__header">
          <div>
            <span className="modal__eyebrow boa-modal__eyebrow">⬡ OPERATION // BATTLE OF ORDER</span>
            <h2 className="modal__title boa-modal__title">
              {phase === 'spinning'   ? '> RANDOMISING PRIORITY AXIS...' :
               phase === 'locked'     ? '> AXIS LOCKED — AWAIT ORDERS' :
               phase === 'generating' ? '> RETRIEVING INTEL ASSETS...' :
               phase === 'playing'    ? `> SEQUENCE: ${meta?.label ?? ''}` :
               phase === 'result'     ? (result?.won ? '> CIPHER BROKEN' : '> SEQUENCE COMPROMISED') :
               '> ESTABLISHING SECURE CHANNEL...'}
            </h2>
          </div>
          <button className="modal__close boa-modal__close" onClick={handleClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="modal__body boa-modal__body">

          {/* Loading */}
          {phase === 'loading' && (
            <div className="boa-center">
              <div className="boa-loader">
                <div className="boa-loader__ring" />
                <span className="boa-loader__icon">⬡</span>
              </div>
              <p className="boa-status-text">ESTABLISHING SECURE CHANNEL…</p>
              <p className="boa-status-sub">DECRYPTING MISSION PARAMETERS</p>
            </div>
          )}

          {/* No options */}
          {phase === 'no_options' && (
            <div className="boa-center">
              <p className="boa-error-icon">⚠</p>
              <p className="boa-status-text boa-status-text--error">ACCESS DENIED</p>
              <p className="boa-status-sub">{errorMsg || 'Unable to generate operation.'}</p>
            </div>
          )}

          {/* Spinning / Locked */}
          {(phase === 'spinning' || phase === 'locked') && (
            <div className="boa-spin-screen">
              <div className="boa-spin-decorline" />
              <p className="boa-spin-label">// PRIORITY AXIS SELECTION</p>
              <div className={`boa-reel${phase === 'locked' ? ' boa-reel--locked' : ''}`}>
                <span className="boa-reel__prefix">{phase === 'locked' ? '◈' : '◌'}</span>
                <span className="boa-reel__text">{displayText}</span>
                {phase === 'locked' && <span className="boa-reel__confirmed">// PARAMETER LOCKED — AGENT CLEARANCE REQUIRED</span>}
              </div>
              {phase === 'spinning' && (
                <p className="boa-spin-sub">RANDOMISING PRIORITY AXIS…</p>
              )}
              {phase === 'locked' && (
                <>
                  <div className="boa-spin-direction-wrap">
                    <span className="boa-spin-dir-label">ORDER SEQUENCE</span>
                    <span className="boa-spin-dir-value">{lockedMeta?.direction ?? ''}</span>
                  </div>
                  <button className="boa-engage-btn" onClick={handleEngage}>
                    <span className="boa-engage-btn__icon">►</span> INITIATE SEQUENCE
                  </button>
                </>
              )}
              <div className="boa-spin-decorline" />
            </div>
          )}

          {/* Generating */}
          {phase === 'generating' && (
            <div className="boa-center">
              <div className="boa-loader">
                <div className="boa-loader__ring" />
                <span className="boa-loader__icon">⬡</span>
              </div>
              <p className="boa-status-text">COMPILING DOSSIER FILES…</p>
              <p className="boa-status-sub">RETRIEVING INTEL ASSETS</p>
            </div>
          )}

          {/* Playing */}
          {phase === 'playing' && (
            <div className="boa-game">
              <div className="boa-game-header">
                <div className="boa-game-header__left">
                  <span className="boa-game-param-label">PRIORITY AXIS</span>
                  <span className="boa-game-param-value">{meta?.label}</span>
                </div>
                <div className="boa-game-header__right">
                  <span className="boa-game-mission-label">OBJECTIVE</span>
                  <span className="boa-game-mission-text">Arrange dossiers in correct sequence</span>
                </div>
              </div>

              <div className="boa-game-board">
                {/* Vertical direction axis */}
                <div className="boa-axis">
                  <span className="boa-axis__label boa-axis__label--start">{meta?.startLabel}</span>
                  <div className="boa-axis__track">
                    <span className="boa-axis__arrow">▲</span>
                    <div className="boa-axis__line" />
                    <span className="boa-axis__arrow">▼</span>
                  </div>
                  <span className="boa-axis__label boa-axis__label--end">{meta?.endLabel}</span>
                </div>

                {/* Card list */}
                <ol className="boa-card-list">
                  {userOrder.map((item, idx) => {
                    const imgUrl = item.briefMedia?.find(m => m?.mediaUrl && m.mediaType === 'picture')?.mediaUrl
                                 ?? item.briefMedia?.[0]?.mediaUrl
                    return (
                      <li key={item.choiceId} className="boa-card">
                        <span className="boa-card__pos">{String(idx + 1).padStart(2, '0')}</span>
                        {imgUrl && (
                          <img className="boa-card__img" src={imgUrl} alt="" aria-hidden="true" />
                        )}
                        <div className="boa-card__body">
                          <span className="boa-card__file">FILE-{String(idx + 1).padStart(3, '0')}</span>
                          <span className="boa-card__title">{item.briefTitle}</span>
                        </div>
                        <div className="boa-card__btns">
                          <button className="boa-card__mv boa-card__mv--up" onClick={() => moveCard(idx, -1)} disabled={idx === 0} aria-label="Move up">▲</button>
                          <button className="boa-card__mv boa-card__mv--dn" onClick={() => moveCard(idx, 1)} disabled={idx === userOrder.length - 1} aria-label="Move down">▼</button>
                        </div>
                      </li>
                    )
                  })}
                </ol>
              </div>

              <button className="boa-submit-btn" onClick={handleSubmit} disabled={submitting}>
                {submitting
                  ? <><span className="boa-submit-btn__spinner" />TRANSMITTING…</>
                  : '► TRANSMIT SEQUENCE'}
              </button>
            </div>
          )}

          {/* Result */}
          {phase === 'result' && result && (
            <div className="boa-result">
              <div className={`boa-result__banner${result.won ? ' boa-result__banner--won' : ' boa-result__banner--lost'}`}>
                <div className="boa-result__banner-inner">
                  <span className="boa-result__icon">{result.won ? '◈' : '✕'}</span>
                  <div>
                    <span className="boa-result__status">{result.won ? 'CIPHER BROKEN' : 'SEQUENCE COMPROMISED'}</span>
                    <span className="boa-result__sub">{result.won ? 'MISSION COMPLETE — SEQUENCE CONFIRMED' : 'MISSION FAILED — INCORRECT ORDER DETECTED'}</span>
                  </div>
                </div>
                {result.won && result.aircoinsEarned > 0 && (
                  <span className="boa-result__coins">+{result.aircoinsEarned} <span style={{ opacity: 0.65 }}>AIRCOINS</span></span>
                )}
                {result.won && result.alreadyCompleted && (
                  <span className="boa-result__replay-note">Already completed — switch difficulty to earn Aircoins</span>
                )}
              </div>

              <p className="boa-result__label">// VERIFIED SEQUENCE — {ORDER_TYPE_META[game?.orderType]?.direction}</p>
              <ol className="boa-reveal-list">
                {result.correctReveal.map((item) => {
                  const userItem = userOrder.find(u => u.choiceId?.toString() === item.choiceId?.toString())
                  const userPos  = userOrder.indexOf(userItem) + 1
                  const correct  = userPos === item.correctOrder
                  return (
                    <li key={item.choiceId} className={`boa-reveal-item${correct ? ' boa-reveal-item--correct' : ' boa-reveal-item--wrong'}`}>
                      <span className="boa-reveal-item__pos">{String(item.correctOrder).padStart(2, '0')}</span>
                      <span className="boa-reveal-item__title">{item.briefTitle}</span>
                      {item.displayValue && <span className="boa-reveal-item__val">{item.displayValue}</span>}
                      <span className="boa-reveal-item__tick">{correct ? '◈' : '✕'}</span>
                    </li>
                  )
                })}
              </ol>

              <div className="boa-result__actions">
                <button className="boa-engage-btn" onClick={handlePlayAgain}>► RUN AGAIN</button>
                <button className="boa-close-text" onClick={handleClose}>Stand Down</button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
