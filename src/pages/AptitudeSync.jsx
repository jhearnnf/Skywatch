import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useAppSettings } from '../context/AppSettingsContext'
import { playTypingSound } from '../utils/sound'

// ── CRT colour palette — electric blue to match site theme ───────────────────
const G_BRIGHT  = '#5baaff'   // brand-600 electric blue
const G_MID     = '#3d8fd9'   // mid blue
const G_DIM     = '#1a4a70'   // dim blue
const G_ERROR   = '#ff5555'
const G_AMBER   = '#ffcc44'   // coin / aircoin highlight
const G_WHITE   = '#c8e6ff'   // near-white blue tint for user text

// ── Terminal line types → colour mapping ─────────────────────────────────────
const LINE_COLORS = {
  cmd:     G_MID,
  system:  G_DIM,
  info:    G_BRIGHT,
  logo:    G_MID,
  user:    G_WHITE,
  ai:      G_BRIGHT,
  coin:    G_AMBER,
  error:   G_ERROR,
  summary: G_BRIGHT,
  divider: G_DIM,
  blank:   'transparent',
}

// ── Skywatch ASCII logo (crosshair) ──────────────────────────────────────────
const SKYWATCH_ASCII_LOGO = [
  '                                                ####                                                ',
  '                                          ################                                          ',
  '                                   ##############################                                   ',
  '                               ##############   ####   ##############                               ',
  '                            #########           ####           #########                            ',
  '                         #######                ####                #######                         ',
  '                       ######                   ####                   ######                       ',
  '                    #######                     ####                     #######                    ',
  '                  ######                        ####                        ######                  ',
  '                 #####                          ####                          #####                 ',
  '               #####                            ####                            #####               ',
  '              #####                             ####                             #####              ',
  '             ####                               ####                               ####             ',
  '            ####                                ####                                ####            ',
  '           ####                                 ####                                 ####           ',
  '          ####                             ==============                             ####          ',
  '         ####                           ====================                           ####         ',
  '        ####                         ========          ========                         ####        ',
  '        ###                         ======                ======                         ###        ',
  '       ####                       =====                      =====                       ####       ',
  '       ###                       =====                        =====                       ###       ',
  '      ####                      ====                            ====                      ####      ',
  '      ####                      ===           ========           ===                      ####      ',
  '      ####                     ====         ============         ====                     ####      ',
  '  ############################ ===          ============          === ############################  ',
  '  ############################ ===         ==============         === ############################  ',
  '  ############################ ===          ============          === ############################  ',
  '      ####                     ====         ============         ====                     ####      ',
  '      ####                     ====           ========           ====                     ####      ',
  '      ####                      ====                            ====                      ####      ',
  '       ###                       ====                          ====                       ###       ',
  '       ####                       =====                      =====                       ####       ',
  '        ###                        =======                =======                        ###        ',
  '        ####                         ========          ========                         ####        ',
  '         ####                           ====================                           ####         ',
  '         #####                             ==============                             #####         ',
  '          #####                                 ####                                 #####          ',
  '           #####                                ####                                ####            ',
  '             ####                               ####                               ####             ',
  '              #####                             ####                             #####              ',
  '               #####                            ####                            #####               ',
  '                 #####                          ####                          #####                 ',
  '                  ######                        ####                        ######                  ',
  '                    ######                      ####                      ######                    ',
  '                      #######                   ####                   #######                      ',
  '                         #######                ####                #######                         ',
  '                           ###########          ####          ###########                           ',
  '                               ##############   ####   ##############                               ',
  '                                  ###############################                                   ',
  '                                          ################                                          ',
  '                                                ####                                                ',
  '                                                ####                                                ',
].join('\n')

// ── Diagnostic loading overlay — checklist + segmented progress bar ──────────
const DIAG_STEPS = [
  'VERIFYING AGENT IDENTITY',
  'CHECKING CLEARANCE LEVEL',
  'LOADING APTITUDE PROFILE',
  'CALIBRATING ASSESSMENT MODULE',
  'ESTABLISHING SECURE CHANNEL',
  'SYNCING MISSION DATA',
]
const BAR_SEGMENTS = 20

function CrtLoadingOverlay() {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 180)
    return () => clearInterval(id)
  }, [])

  // Each step resolves after ~3 ticks; cycle through steps
  const totalTicks   = DIAG_STEPS.length * 3
  const loopTick     = tick % totalTicks
  const resolvedCount = Math.floor(loopTick / 3)           // steps fully [OK]
  const activeStep    = Math.min(resolvedCount, DIAG_STEPS.length - 1)
  const activeDots    = loopTick % 3                        // 0,1,2 → ".", "..", "..."

  // Progress bar: fills proportionally to loopTick
  const fillCount = Math.round((loopTick / totalTicks) * BAR_SEGMENTS)

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[60] rounded-lg overflow-hidden flex flex-col items-center justify-center"
      style={{ background: 'rgba(3,13,24,0.92)', backdropFilter: 'blur(2px)' }}
    >
      <div
        className="flex flex-col gap-1 px-7 py-5 rounded font-mono text-xs"
        style={{ border: `1px solid ${G_DIM}`, minWidth: 300, background: 'rgba(6,16,30,0.85)' }}
      >
        {/* Diagnostic checklist */}
        {DIAG_STEPS.map((label, i) => {
          const resolved = i < resolvedCount
          const active   = i === activeStep && !resolved
          return (
            <div key={i} className="flex items-center gap-3" style={{ opacity: i > activeStep ? 0.25 : 1 }}>
              <span style={{
                color:      resolved ? G_BRIGHT : active ? G_AMBER : G_DIM,
                textShadow: resolved ? `0 0 8px ${G_BRIGHT}` : active ? `0 0 8px ${G_AMBER}` : 'none',
                minWidth:   36,
              }}>
                {resolved ? '[OK]' : active ? `[${'.'.repeat(activeDots + 1)}]` : '[  ]'}
              </span>
              <span style={{ color: resolved ? G_MID : active ? G_WHITE : G_DIM, letterSpacing: '0.08em' }}>
                {label}
              </span>
            </div>
          )
        })}

        {/* Divider */}
        <div style={{ borderTop: `1px solid ${G_DIM}`, margin: '6px 0 4px' }} />

        {/* Segmented progress bar */}
        <div className="flex flex-col gap-1">
          <div className="flex gap-[3px]">
            {Array.from({ length: BAR_SEGMENTS }, (_, i) => (
              <div
                key={i}
                style={{
                  flex:       1,
                  height:     8,
                  background: i < fillCount ? G_BRIGHT : G_DIM,
                  opacity:    i < fillCount ? 1 : 0.3,
                  boxShadow:  i < fillCount ? `0 0 4px ${G_BRIGHT}` : 'none',
                  transition: 'background 0.15s',
                }}
              />
            ))}
          </div>
          <div className="flex justify-between" style={{ color: G_DIM, letterSpacing: '0.1em' }}>
            <span>LOADING</span>
            <span style={{ color: G_BRIGHT }}>{Math.round((fillCount / BAR_SEGMENTS) * 100)}%</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Responsive ASCII logo panel — with CRT glitch effects ────────────────────
const GLITCH_CHARS = '!@/\\|<>[]{}01234*%$+-~^?#='

function AsciiLogo({ maxHeightPx = 220 }) {
  const wrapperRef = useRef(null)
  const preRef     = useRef(null)
  const [scale,       setScale]       = useState(1)
  const [wrapH,       setWrapH]       = useState(maxHeightPx)
  const [offsetX,     setOffsetX]     = useState(0)
  const [corruptions, setCorruptions] = useState(new Map())

  // ── Scale / ResizeObserver ────────────────────────────────────────────────
  useEffect(() => {
    const pre     = preRef.current
    const wrapper = wrapperRef.current
    if (!pre || !wrapper) return
    const naturalW = pre.scrollWidth
    const naturalH = pre.scrollHeight
    const update = () => {
      const containerW = wrapper.offsetWidth
      const parentH = wrapper.parentElement?.clientHeight ?? maxHeightPx
      const s = Math.min(1, containerW / naturalW, parentH / naturalH)
      setScale(s)
      setWrapH(Math.round(naturalH * s))
      // Centre the visually-scaled element: layout width stays naturalW,
      // visual width is naturalW*s, so shift right by half the difference.
      setOffsetX(Math.round((containerW - naturalW * s) / 2))
    }
    update()
    const obs = new ResizeObserver(update)
    obs.observe(wrapper)
    if (wrapper.parentElement) obs.observe(wrapper.parentElement)
    return () => obs.disconnect()
  }, [maxHeightPx])

  // ── Char corruption glitch ────────────────────────────────────────────────
  useEffect(() => {
    const activePosns = []
    for (let i = 0; i < SKYWATCH_ASCII_LOGO.length; i++) {
      const ch = SKYWATCH_ASCII_LOGO[i]
      if (ch !== ' ' && ch !== '\n') activePosns.push(i)
    }

    let tid
    const makeMap = (picks) => {
      const m = new Map()
      picks.forEach(idx => m.set(idx, GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)]))
      return m
    }

    const fire = () => {
      const count = 2 + Math.floor(Math.random() * 7)
      const pool  = [...activePosns]
      const picks = []
      for (let i = 0; i < count; i++) {
        picks.push(...pool.splice(Math.floor(Math.random() * pool.length), 1))
      }

      const hold = 50 + Math.random() * 110
      setCorruptions(makeMap(picks))

      if (Math.random() > 0.45) {
        // Double-flash: corrupt → clear → re-corrupt → clear
        setTimeout(() => {
          setCorruptions(new Map())
          setTimeout(() => {
            setCorruptions(makeMap(picks))
            setTimeout(() => setCorruptions(new Map()), 55)
          }, 55)
        }, hold)
      } else {
        setTimeout(() => setCorruptions(new Map()), hold)
      }

      tid = setTimeout(fire, 1200 + Math.random() * 2800)
    }

    tid = setTimeout(fire, 800 + Math.random() * 1600)
    return () => clearTimeout(tid)
  }, [])

  // ── Derive base + overlay text ────────────────────────────────────────────
  const { baseText, overlayText } = useMemo(() => {
    if (corruptions.size === 0) return { baseText: SKYWATCH_ASCII_LOGO, overlayText: null }
    const base    = [...SKYWATCH_ASCII_LOGO]
    const overlay = Array.from(SKYWATCH_ASCII_LOGO, ch => (ch === '\n' ? '\n' : ' '))
    corruptions.forEach((glitchCh, idx) => {
      base[idx]    = ' '
      overlay[idx] = glitchCh
    })
    return { baseText: base.join(''), overlayText: overlay.join('') }
  }, [corruptions])

  const sharedPreStyle = {
    display:             'inline-block',
    margin:              0,
    padding:             0,
    fontFamily:          "'Courier New', Courier, monospace",
    fontSize:            '12px',
    lineHeight:          1.2,
    whiteSpace:          'pre',
    WebkitFontSmoothing: 'none',
  }

  return (
    <>
      <style>{`
        @keyframes logo-scanline {
          0%   { top: -4px; opacity: 0; }
          4%   { opacity: 1; }
          96%  { opacity: 0.65; }
          100% { top: calc(100% + 4px); opacity: 0; }
        }
        @keyframes logo-flicker {
          0%,90%,100% { opacity: 1;    }
          91%          { opacity: 0.80; }
          92%          { opacity: 0.97; }
          93%          { opacity: 0.72; }
          94%          { opacity: 0.93; }
          95%          { opacity: 0.85; }
        }
      `}</style>

      <div
        ref={wrapperRef}
        style={{
          width:     '100%',
          height:    wrapH,
          overflow:  'hidden',
          position:  'relative',
          animation: 'logo-flicker 6s linear infinite',
        }}
      >
        {/* CRT scan line sweeping down */}
        <div
          style={{
            position:      'absolute',
            left: 0, right: 0,
            top:           '-4px',
            height:        '3px',
            background:    `linear-gradient(90deg, transparent 5%, ${G_BRIGHT}44 35%, ${G_BRIGHT}bb 50%, ${G_BRIGHT}44 65%, transparent 95%)`,
            animation:     'logo-scanline 9s linear infinite',
            zIndex:        3,
            pointerEvents: 'none',
          }}
        />

        {/* Scale wrapper — absolute so offsetX centres it regardless of natural layout width */}
        <div style={{ position: 'absolute', top: 0, left: offsetX, transformOrigin: 'top left', transform: `scale(${scale})` }}>
          {/* Base logo */}
          <pre
            ref={preRef}
            style={{
              ...sharedPreStyle,
              color:      G_MID,
              textShadow: scale > 0.45 ? `0 0 4px ${G_MID}` : 'none',
            }}
          >
            {baseText}
          </pre>

          {/* Glitch overlay — bright chars at corrupted positions only */}
          {overlayText && (
            <pre
              aria-hidden
              style={{
                ...sharedPreStyle,
                position:   'absolute',
                top: 0, left: 0,
                color:      G_BRIGHT,
                textShadow: `0 0 6px ${G_BRIGHT}, 0 0 14px ${G_BRIGHT}88`,
              }}
            >
              {overlayText}
            </pre>
          )}
        </div>
      </div>
    </>
  )
}

// ── Boot sequence lines ───────────────────────────────────────────────────────
function buildBootLines(username) {
  return [
    { text: `> /start skywatch APTITUDE_SYNC --agent=${username ?? 'UNKNOWN'}`, type: 'cmd'    },
    { text: '> © 2026 SKYWATCH INTELLIGENCE PLATFORM',                          type: 'system' },
    { text: '> BUILT FOR THOSE WHO TAKE THE RAF SERIOUSLY',                     type: 'system' },
    { text: '> LOADING APTITUDE_SYNC MODULE...',                                type: 'cmd'    },
    { text: '> CONNECTION ESTABLISHED',                                          type: 'cmd'    },
    { text: '> KNOWLEDGE DEBRIEF PROTOCOL ACTIVE',                              type: 'info'   },
  ]
}

function buildLockedLines(reason, usedToday, limitToday) {
  if (reason === 'disabled' || reason === 'tier') {
    return [
      { text: '> APTITUDE_SYNC INITIALISING...',      type: 'cmd'   },
      { text: '',                                      type: 'blank' },
      { text: '  ╔══════════════════════════╗',        type: 'logo'  },
      { text: '  ║   A C C E S S  D E N I E D   ║',   type: 'error' },
      { text: '  ╚══════════════════════════╝',        type: 'logo'  },
      { text: '',                                      type: 'blank' },
      { text: reason === 'tier'
          ? '> INSUFFICIENT CLEARANCE — UPGRADE REQUIRED'
          : '> SYSTEM OFFLINE — APTITUDE_SYNC DISABLED',              type: 'error' },
      { text: '> STAND DOWN, AGENT.',                                 type: 'system'},
    ]
  }
  // limit reached
  return [
    { text: '> APTITUDE_SYNC INITIALISING...',                       type: 'cmd'   },
    { text: '',                                                       type: 'blank' },
    { text: '  ╔══════════════════════════════════╗',                type: 'logo'  },
    { text: '  ║   D A I L Y  L I M I T  R E A C H E D   ║',        type: 'error' },
    { text: '  ╚══════════════════════════════════╝',                type: 'logo'  },
    { text: '',                                                       type: 'blank' },
    { text: `> SESSIONS USED TODAY: ${usedToday}/${limitToday}`,     type: 'info'  },
    { text: '> LIMIT RESETS AT 00:00 UTC',                           type: 'system'},
    { text: '> STAND DOWN, AGENT.',                                  type: 'system'},
  ]
}

// ── Typewriter hook ───────────────────────────────────────────────────────────
// Accepts a queue of { text, type } lines, types them out one by one.
// Calls onDone when the queue is exhausted.
function useTypewriter(queue, onDone) {
  const [displayed,  setDisplayed]  = useState([])  // fully typed lines
  const [partialText, setPartial]   = useState('')   // current line being typed
  const [queueIndex,  setQueueIndex] = useState(0)
  const [charIndex,   setCharIndex]  = useState(0)
  const onDoneRef = useRef(onDone)
  useEffect(() => { onDoneRef.current = onDone }, [onDone])

  // Reset when queue reference changes (new content)
  const queueRef = useRef(queue)
  useEffect(() => {
    if (queueRef.current === queue) return
    queueRef.current = queue
    setDisplayed([])
    setPartial('')
    setQueueIndex(0)
    setCharIndex(0)
  }, [queue])

  useEffect(() => {
    if (queueIndex >= queue.length) {
      if (queue.length > 0) onDoneRef.current?.()
      return
    }
    const line = queue[queueIndex]
    // Blank lines — add instantly with no typing
    if (line.text === '') {
      setDisplayed(d => [...d, line])
      setQueueIndex(i => i + 1)
      setCharIndex(0)
      return
    }
    if (charIndex >= line.text.length) {
      setDisplayed(d => [...d, line])
      setQueueIndex(i => i + 1)
      setCharIndex(0)
      return
    }
    const delay = line.type === 'logo' || line.type === 'divider' ? 4 : 18
    const t = setTimeout(() => {
      setPartial(line.text.slice(0, charIndex + 1))
      if (line.type !== 'logo' && line.type !== 'divider') playTypingSound()
      setCharIndex(i => i + 1)
    }, delay)
    return () => clearTimeout(t)
  }, [queue, queueIndex, charIndex])

  const currentLine = queueIndex < queue.length && queue[queueIndex]?.text !== ''
    ? { ...queue[queueIndex], text: partialText }
    : null

  return { displayed, currentLine }
}

// ── Terminal line renderer ────────────────────────────────────────────────────
function TermLine({ line }) {
  const color = LINE_COLORS[line.type] ?? G_BRIGHT
  const glow  = line.type !== 'blank' && line.type !== 'system' && line.type !== 'divider'
    ? `0 0 6px ${color}`
    : 'none'
  return (
    <div
      className="font-mono text-sm leading-relaxed whitespace-pre-wrap break-words"
      style={{ color, textShadow: glow, minHeight: '1.4em' }}
    >
      {line.text || '\u00A0'}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AptitudeSync() {
  const { briefId }  = useParams()
  const navigate     = useNavigate()
  const location     = useLocation()
  const { user, API, apiFetch, awardAircoins, isLoading } = useAuth()
  const { settings } = useAppSettings()

  // Brief title / category — may be passed via navigation state or fetched
  const [briefTitle, setBriefTitle]   = useState(location.state?.briefTitle ?? '')
  const categoryName                  = location.state?.category ?? ''

  // Phase: 'loading' | 'booting' | 'locked' | 'active' | 'complete' | 'error'
  const [phase,     setPhase]     = useState('loading')
  const [lockInfo,  setLockInfo]  = useState({ reason: '', usedToday: 0, limitToday: 0 })

  // Terminal output lines (after typewriter finishes, plus streamed AI lines)
  const [outputLines, setOutputLines] = useState([])

  // Boot queue — fed into the typewriter hook
  const [bootQueue,   setBootQueue]  = useState([])
  const bootDoneRef = useRef(false)

  // Active round state
  const [round,        setRound]       = useState(1)
  const [inputValue,   setInputValue]  = useState('')
  const [isSubmitting, setSubmitting]  = useState(false)
  const [sessionCoins, setSessionCoins] = useState(0)   // accumulated total
  const [history,      setHistory]     = useState([])   // [{role,content}] for AI context
  const maxRounds = settings?.aptitudeSyncMaxRounds ?? 3

  const [followUp,       setFollowUp]       = useState('')   // AI's specific follow-up prompt for next round
  const [pulseObjective, setPulseObjective] = useState(false)
  const [textGlitch,     setTextGlitch]     = useState(null) // { x, y, char } | null

  const inputRef  = useRef(null)
  const bottomRef = useRef(null)

  // ── Lock page scroll (keyboard on mobile causes unwanted page scroll) ────────
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  // ── Fetch brief title if not passed via state ─────────────────────────────
  useEffect(() => {
    if (briefTitle) return
    fetch(`${API}/api/briefs/${briefId}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d?.data?.brief?.title) setBriefTitle(d.data.brief.title) })
      .catch(() => {})
  }, [briefId, API, briefTitle])

  // ── Status check ──────────────────────────────────────────────────────────
  useEffect(() => {
    apiFetch(`${API}/api/aptitude-sync/status?briefId=${briefId}`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        const s = d?.data
        if (!s) { setPhase('error'); return }
        if (!s.canPlay) {
          setLockInfo({ reason: s.reason, usedToday: s.usedToday, limitToday: s.limitToday })
          setPhase('locked')
        } else {
          setPhase('booting')
        }
      })
      .catch(() => setPhase('error'))
  }, [briefId, API]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Start boot sequence once phase = 'booting' ────────────────────────────
  useEffect(() => {
    if (phase === 'booting') {
      setBootQueue(buildBootLines(user?.username ?? user?.email?.split('@')[0] ?? 'AGENT'))
    }
    if (phase === 'locked') {
      setBootQueue(buildLockedLines(lockInfo.reason, lockInfo.usedToday, lockInfo.limitToday))
    }
  }, [phase]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Typewriter for boot/locked queues ────────────────────────────────────
  const handleBootDone = useCallback(() => {
    if (bootDoneRef.current) return
    bootDoneRef.current = true
    if (phase === 'booting') {
      // Show session usage line then transition to active
      const limit    = lockInfo.limitToday
      const used     = lockInfo.usedToday
      const usageLine = limit != null
        ? `> SESSION ${used + 1}/${limit} READY`
        : '> SESSION READY — UNLIMITED ACCESS'
      setOutputLines(prev => [
        ...prev,
        { text: usageLine, type: 'info' },
        { text: '', type: 'blank' },
      ])
      setTimeout(() => setPhase('active'), 400)
    }
    // locked phase — stays on locked, no transition needed
  }, [phase, lockInfo])

  // Memoize so the empty array is a stable reference when the typewriter is idle —
  // an inline [] literal would be a new reference every render, causing an infinite reset loop.
  const typewriterQueue = useMemo(
    () => (phase === 'booting' || phase === 'locked') ? bootQueue : [],
    [phase, bootQueue],
  )

  const { displayed: bootDisplayed, currentLine: bootCurrent } = useTypewriter(
    typewriterQueue,
    handleBootDone,
  )

  // ── Auto-scroll to bottom ─────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [bootDisplayed, outputLines, isSubmitting])

  // ── Focus input when active ───────────────────────────────────────────────
  useEffect(() => {
    if (phase === 'active' && !isSubmitting) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
    // Pulse the objective on first arrival only
    if (phase === 'active' && round === 1) {
      setPulseObjective(true)
    }
  }, [phase, isSubmitting, round])

  // ── Random text-area glitch flashes ──────────────────────────────────────
  useEffect(() => {
    if (phase !== 'active' && phase !== 'complete') return
    let tid
    const fire = () => {
      const char = GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)]
      const x    = 4 + Math.random() * 88  // % — keep away from edges
      const y    = 4 + Math.random() * 88
      const hold = 55 + Math.random() * 110
      setTextGlitch({ x, y, char })
      if (Math.random() > 0.5) {
        // Double-flash
        setTimeout(() => {
          setTextGlitch(null)
          setTimeout(() => {
            setTextGlitch({ x, y, char: GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)] })
            setTimeout(() => setTextGlitch(null), 55)
          }, 55)
        }, hold)
      } else {
        setTimeout(() => setTextGlitch(null), hold)
      }
      tid = setTimeout(fire, 1800 + Math.random() * 3200)
    }
    tid = setTimeout(fire, 1000 + Math.random() * 2000)
    return () => clearTimeout(tid)
  }, [phase])

  // ── Submit handler ────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    const text = inputValue.trim()
    if (!text || isSubmitting || phase !== 'active') return
    setInputValue('')
    setSubmitting(true)

    // Echo user input to terminal
    setOutputLines(prev => [
      ...prev,
      { text: `> [AGENT — ROUND ${round}/${maxRounds}]`, type: 'system' },
      { text: text, type: 'user' },
      { text: '', type: 'blank' },
    ])

    // Build history for AI context
    const newHistory = [
      ...history,
      { role: 'user', content: text },
    ]

    try {
      const res  = await apiFetch(`${API}/api/aptitude-sync/${briefId}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ userText: text, round, history }),
      })
      const data = await res.json()

      if (!res.ok) {
        const errMsg = errorMessage(data?.error)
        setOutputLines(prev => [...prev, { text: `> ERROR: ${errMsg}`, type: 'error' }, { text: '', type: 'blank' }])
        setSubmitting(false)
        return
      }

      const { response, aircoins, done, followUp, summary, corrections } = data.data ?? {}
      const roundCoins = aircoins ?? 0
      const newTotal   = Math.min(20, sessionCoins + roundCoins)
      setSessionCoins(newTotal)

      // Add AI response lines
      const aiLines = [
        { text: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', type: 'divider' },
        { text: response ?? '', type: 'ai' },
        { text: '', type: 'blank' },
        { text: `> INTELLIGENCE VALUE THIS ROUND:  +${roundCoins} AIRCOIN${roundCoins !== 1 ? 'S' : ''}`, type: 'coin' },
        { text: `> RUNNING TOTAL:  ${newTotal}/20 AIRCOINS`, type: 'coin' },
        { text: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', type: 'divider' },
        { text: '', type: 'blank' },
      ]

      if (!done && followUp) {
        aiLines.push(
          { text: `> DEBRIEFER: ${followUp}`, type: 'info' },
          { text: '', type: 'blank' },
        )
      }

      if (done) {
        if (summary) {
          aiLines.push(
            { text: '┌─ DEBRIEF SUMMARY ──────────────────────────┐', type: 'divider' },
            { text: summary, type: 'summary' },
            { text: '└────────────────────────────────────────────┘', type: 'divider' },
            { text: '', type: 'blank' },
          )
        }
        if (corrections && corrections !== 'No significant gaps.') {
          aiLines.push(
            { text: '┌─ KNOWLEDGE GAPS — CORRECT ANSWERS ─────────┐', type: 'divider' },
            { text: corrections, type: 'ai' },
            { text: '└────────────────────────────────────────────┘', type: 'divider' },
            { text: '', type: 'blank' },
          )
        } else if (corrections === 'No significant gaps.') {
          aiLines.push(
            { text: '> KNOWLEDGE GAPS: NONE — OUTSTANDING RECALL, AGENT.', type: 'info' },
            { text: '', type: 'blank' },
          )
        }
        aiLines.push(
          { text: `> SESSION TOTAL: ${newTotal} AIRCOINS EARNED`, type: 'coin' },
          { text: '> AIRCOINS WILL BE CREDITED ON EXIT', type: 'system' },
          { text: '', type: 'blank' },
          { text: '> MISSION COMPLETE. WELL DONE, AGENT.', type: 'info' },
          { text: '> [PRESS ANY KEY TO STAND DOWN]', type: 'system' },
        )
      }

      setOutputLines(prev => [...prev, ...aiLines])
      // Include the follow-up question in history so the AI knows what it just asked
      // when evaluating the next round (important for the "I don't know" rule)
      const assistantHistoryContent = followUp
        ? `${response ?? ''}\n\nDebriefer follow-up question: ${followUp}`
        : (response ?? '')
      setHistory([...newHistory, { role: 'assistant', content: assistantHistoryContent }])

      if (done) {
        setPhase('complete')
        await triggerAward(newTotal)
      } else {
        if (followUp) setFollowUp(followUp)
        setRound(r => r + 1)
      }
    } catch {
      setOutputLines(prev => [
        ...prev,
        { text: '> SIGNAL LOST — PLEASE RETRY', type: 'error' },
        { text: '', type: 'blank' },
      ])
    } finally {
      setSubmitting(false)
    }
  }, [inputValue, isSubmitting, phase, round, maxRounds, history, sessionCoins, briefId, API, apiFetch]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Award coins on session complete ──────────────────────────────────────
  const awardedRef = useRef(false)
  const triggerAward = useCallback(async (total) => {
    if (awardedRef.current || total === 0) return
    awardedRef.current = true
    try {
      const res  = await apiFetch(`${API}/api/aptitude-sync/${briefId}/award`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ totalAircoins: total }),
      })
      const data = await res.json()
      if (res.ok && data?.data?.awarded > 0) {
        awardAircoins(data.data.awarded, 'APTITUDE_SYNC', {
          cycleAfter:    data.data.cycleAircoins,
          totalAfter:    data.data.totalAircoins,
          rankPromotion: data.data.rankPromotion ?? null,
        })
      }
    } catch { /* silent — coins can be re-attempted if page stays open */ }
  }, [briefId, API, apiFetch, awardAircoins])

  // ── Key handler for 'complete' phase (any key to exit) ───────────────────
  useEffect(() => {
    if (phase !== 'complete') return
    const handler = () => handleExit()
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [phase]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Escape during loading/booting — skip the loading sequence ────────────
  useEffect(() => {
    if (phase !== 'loading' && phase !== 'booting') return
    const handler = (e) => {
      if (e.key !== 'Escape') return
      if (phase === 'loading') {
        handleExit()
      } else {
        // Skip boot animation — jump straight to active
        if (bootDoneRef.current) return
        bootDoneRef.current = true
        const limit = lockInfo.limitToday
        const used  = lockInfo.usedToday
        const usageLine = limit != null
          ? `> SESSION ${used + 1}/${limit} READY`
          : '> SESSION READY — UNLIMITED ACCESS'
        setOutputLines(prev => [
          ...prev,
          { text: usageLine, type: 'info' },
          { text: '', type: 'blank' },
        ])
        setPhase('active')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [phase, lockInfo]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleExit() {
    if (categoryName) {
      navigate('/learn-priority', { state: { category: categoryName } })
    } else {
      navigate(`/brief/${briefId}`)
    }
  }

  // ── Input keydown ─────────────────────────────────────────────────────────
  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  // ── Error message mapping ─────────────────────────────────────────────────
  function errorMessage(code) {
    switch (code) {
      case 'INPUT_TOO_LONG':      return 'INPUT EXCEEDS 600 CHARACTER LIMIT'
      case 'SIGNAL_ANOMALY':      return 'ANOMALOUS SIGNAL DETECTED — INPUT REJECTED'
      case 'COOLDOWN_ACTIVE':     return 'COOLDOWN ACTIVE — WAIT A MOMENT'
      case 'DAILY_LIMIT_REACHED': return 'DAILY SESSION LIMIT REACHED'
      case 'NO_ACTIVE_SESSION':   return 'NO ACTIVE SESSION FOUND'
      default:                    return 'DEBRIEF FAILED — TRY AGAIN'
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* CRT global styles */}
      <style>{`
        @keyframes crt-flicker {
          0%,100% { opacity: 0.028; }
          50%      { opacity: 0.042; }
        }
        @keyframes cursor-blink {
          0%,100% { opacity: 1; }
          50%      { opacity: 0; }
        }
        .apt-cursor { animation: cursor-blink 1s step-end infinite; }

        @keyframes apt-objective-pulse {
          0%,100% { opacity: 1;   text-shadow: 0 0 8px #5baaff, 0 0 20px rgba(91,170,255,0.4); }
          50%     { opacity: 0.55; text-shadow: 0 0 4px #3d8fd9, 0 0 8px  rgba(91,170,255,0.15); }
        }
        .apt-objective-pulse {
          animation: apt-objective-pulse 1.6s ease-in-out infinite;
        }
      `}</style>

      {/* Page wrapper — flex column that fills exactly the available viewport height.
          100dvh (dynamic) excludes mobile browser chrome; 15rem covers topbar (3.5rem)
          + layout padding (3rem) + mobile bottom-nav (5rem) + back button (~2rem) + buffer. */}
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100dvh - 15rem)', minHeight: 0 }}>

      {/* Page back link */}
      <button
        onClick={handleExit}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 mb-3 shrink-0 transition-colors"
      >
        ← Back to {categoryName || 'brief'}
      </button>

      {/* Terminal container — fills remaining height inside the flex wrapper */}
      <div
        className="relative overflow-hidden rounded-lg flex flex-col"
        style={{
          background:  '#030d18',
          fontFamily:  "'Courier New', Courier, monospace",
          flex:        1,
          minHeight:   0,
          border:      `1px solid ${G_DIM}`,
          boxShadow:   `0 0 24px rgba(91,170,255,0.08), inset 0 0 40px rgba(0,0,0,0.4)`,
        }}
        onClick={() => phase === 'active' && inputRef.current?.focus()}
      >
        {/* Scanline overlay */}
        <div
          className="pointer-events-none absolute inset-0 z-10 rounded-lg"
          style={{
            background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.10) 2px, rgba(0,0,0,0.10) 4px)',
          }}
        />

        {/* Noise / flicker overlay */}
        <div
          className="pointer-events-none absolute inset-0 z-10 rounded-lg"
          style={{
            background: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
            opacity: 0.025,
            animation: 'crt-flicker 3s ease-in-out infinite',
          }}
        />

        {/* Vignette overlay */}
        <div
          className="pointer-events-none absolute inset-0 z-10 rounded-lg"
          style={{
            background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.5) 100%)',
          }}
        />

        {/* CRT loading overlay — shown only when apiFetch is in-flight on this page */}
        {isLoading && <CrtLoadingOverlay />}

        {/* ASCII logo watermark — behind CRT overlays and terminal text */}
        <div
          className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center overflow-hidden"
          style={{ opacity: 0.22 }}
        >
          <AsciiLogo maxHeightPx={99999} />
        </div>

        {/* Terminal content */}
        <div className="relative z-20 h-full flex flex-col overflow-hidden">
          {/* Random glitch character flash overlay */}
          {textGlitch && (
            <span
              className="pointer-events-none absolute font-mono text-sm"
              style={{
                left:       `${textGlitch.x}%`,
                top:        `${textGlitch.y}%`,
                color:      G_BRIGHT,
                textShadow: `0 0 8px ${G_BRIGHT}`,
                zIndex:     50,
              }}
            >
              {textGlitch.char}
            </span>
          )}

          {/* Header bar */}
          <div
            className="flex items-center justify-between px-4 py-2 border-b shrink-0"
            style={{ borderColor: G_DIM, color: G_DIM }}
          >
            <span className="font-mono text-xs tracking-widest">SKYWATCH // APTITUDE_SYNC</span>
            <button
              onClick={handleExit}
              className="font-mono text-xs tracking-widest hover:opacity-70 transition-opacity cursor-pointer"
              style={{ color: G_DIM }}
            >
              [EXIT]
            </button>
          </div>

          {/* Scrollable output */}
          <div className="flex-1 overflow-y-auto px-4 pt-4 pb-2" style={{ scrollbarWidth: 'none' }}>

            {/* Loading spinner */}
            {phase === 'loading' && (
              <div className="font-mono text-sm" style={{ color: G_MID }}>
                {'> INITIALISING...'}
              </div>
            )}

            {/* Boot / locked typewriter output */}
            {(phase === 'booting' || phase === 'locked') && (
              <>
                {bootDisplayed.map((line, i) => <TermLine key={i} line={line} />)}
                {bootCurrent && <TermLine line={bootCurrent} />}
              </>
            )}

            {/* Active / complete phase: boot lines collapsed + output lines */}
            {(phase === 'active' || phase === 'complete' || phase === 'error') && (
              <>
                {/* Show completed boot lines */}
                {bootDisplayed.map((line, i) => <TermLine key={`boot-${i}`} line={line} />)}

                {/* Brief prompt header */}
                {phase === 'active' && (
                  <div className="mt-2 mb-3">
                    <TermLine line={{ text: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', type: 'divider' }} />
                    <TermLine line={{ text: `> ROUND ${round}/${maxRounds} — KNOWLEDGE DEBRIEF`, type: 'info' }} />
                    {briefTitle && (
                      <TermLine line={{ text: `> SUBJECT: ${briefTitle.toUpperCase()}`, type: 'info' }} />
                    )}
                    <div className={pulseObjective ? 'apt-objective-pulse' : undefined}>
                      {round === 1 ? (
                        <TermLine line={{ text: '> TRANSMIT EVERYTHING YOU KNOW ABOUT THIS SUBJECT.', type: 'info' }} />
                      ) : followUp ? (
                        <TermLine line={{ text: `> ${followUp}`, type: 'info' }} />
                      ) : (
                        <TermLine line={{ text: `> ROUND ${round} — ADD TO YOUR DEBRIEF OR ADDRESS THE GAPS ABOVE.`, type: 'info' }} />
                      )}
                    </div>
                    <TermLine line={{ text: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', type: 'divider' }} />
                    <TermLine line={{ text: '', type: 'blank' }} />
                  </div>
                )}

                {/* Output lines (user echoes + AI responses) */}
                {outputLines.map((line, i) => <TermLine key={`out-${i}`} line={line} />)}

                {/* Submitting indicator */}
                {isSubmitting && (
                  <div className="font-mono text-sm" style={{ color: G_DIM, textShadow: `0 0 6px ${G_DIM}` }}>
                    {'> EVALUATING RESPONSE'}
                    <span className="apt-cursor">▋</span>
                  </div>
                )}

                {phase === 'error' && (
                  <TermLine line={{ text: '> SYSTEM ERROR — RETURN TO BASE', type: 'error' }} />
                )}
              </>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input area — only shown during active phase */}
          {phase === 'active' && !isSubmitting && (
            <div
              className="shrink-0 border-t px-4 py-3"
              style={{ borderColor: G_DIM }}
            >
              {/* Round indicator */}
              <div
                className="font-mono text-xs mb-2 tracking-widest"
                style={{ color: G_DIM }}
              >
                ROUND {round}/{maxRounds}
                {' · '}
                {sessionCoins} AIRCOINS EARNED
                {' · '}
                {inputValue.length}/600 CHARS
              </div>

              {/* Input row */}
              <div className="flex items-start gap-2">
                <span
                  className="font-mono text-sm pt-0.5 shrink-0"
                  style={{ color: G_MID, textShadow: `0 0 6px ${G_MID}` }}
                >
                  &gt;
                </span>
                <textarea
                  ref={inputRef}
                  value={inputValue}
                  onChange={e => { setPulseObjective(false); setInputValue(e.target.value.slice(0, 600)) }}
                  onKeyDown={handleKeyDown}
                  rows={3}
                  placeholder="Type your knowledge here... (Enter to submit, Shift+Enter for new line)"
                  className="flex-1 bg-transparent border-none outline-none resize-none font-mono text-sm leading-relaxed placeholder:opacity-30"
                  style={{
                    color:       G_BRIGHT,
                    textShadow:  `0 0 5px ${G_BRIGHT}`,
                    caretColor:  G_BRIGHT,
                  }}
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                />
              </div>

              {/* Submit hint */}
              <div
                className="font-mono text-xs mt-2 text-right"
                style={{ color: G_DIM }}
              >
                [ENTER] TRANSMIT · [SHIFT+ENTER] NEW LINE
              </div>
            </div>
          )}

          {/* Complete phase — tap/click to exit */}
          {phase === 'complete' && (
            <div
              className="shrink-0 border-t px-4 py-4 text-center cursor-pointer"
              style={{ borderColor: G_DIM }}
              onClick={handleExit}
            >
              <span
                className="font-mono text-sm tracking-widest apt-cursor"
                style={{ color: G_MID }}
              >
                [PRESS ANY KEY OR TAP TO STAND DOWN]
              </span>
            </div>
          )}

          {/* Locked phase — back button */}
          {phase === 'locked' && (
            <div
              className="shrink-0 border-t px-4 py-4 text-center"
              style={{ borderColor: G_DIM }}
            >
              <button
                onClick={handleExit}
                className="font-mono text-sm tracking-widest cursor-pointer hover:opacity-70 transition-opacity"
                style={{ color: G_DIM }}
              >
                [← RETURN TO BRIEF]
              </button>
            </div>
          )}
        </div>
      </div>

      </div>{/* end page wrapper */}
    </>
  )
}
