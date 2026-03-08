import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import ReadyForBriefing from '../components/ReadyForBriefing'
import TargetDossierModal from '../components/TargetDossierModal'
import OutOfAmmo from '../components/OutOfAmmo'
import TargetingHUD from '../components/TargetingHUD'
import BattleOfOrderModal from '../components/BattleOfOrderModal'
import { useAuth } from '../context/AuthContext'
import { playSound } from '../utils/sound'

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ── Classified loading overlay (matrix rain, no modal) ───────────────────────

const CO_CHARS = '01アイウエオカキクケコ0123456789ABCDEF!@#$[]{}|<>\\/~'

function ClassifiedOverlay() {
  const canvasRef = useRef(null)
  const rafRef    = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const fs = 20
    let cols, drops, w, h

    const init = () => {
      cancelAnimationFrame(rafRef.current)
      const dpr = window.devicePixelRatio || 1
      w = window.innerWidth
      h = window.innerHeight
      canvas.width        = Math.round(w * dpr)
      canvas.height       = Math.round(h * dpr)
      canvas.style.width  = w + 'px'
      canvas.style.height = h + 'px'
      const ctx = canvas.getContext('2d')
      ctx.scale(dpr, dpr)
      cols  = Math.floor(w / fs)
      drops = Array.from({ length: cols }, () => Math.random() * (h / fs) * 1.5 - (h / fs) * 0.5)
      start(ctx)
    }

    const start = (ctx) => {
      let last = 0
      const draw = (ts) => {
        rafRef.current = requestAnimationFrame(draw)
        if (ts - last < 110) return
        last = ts
        ctx.fillStyle = 'rgba(4, 8, 20, 0.22)'
        ctx.fillRect(0, 0, w, h)
        ctx.font = `${fs}px "Courier New", monospace`
        for (let i = 0; i < cols; i++) {
          const ch  = CO_CHARS[Math.floor(Math.random() * CO_CHARS.length)]
          const rnd = Math.random()
          ctx.fillStyle = rnd > 0.97 ? 'rgba(219,234,254,0.12)'
                        : rnd > 0.82 ? 'rgba(96,165,250,0.08)'
                        :              'rgba(29,78,216,0.05)'
          ctx.fillText(ch, i * fs, drops[i] * fs)
          if (drops[i] * fs > h && Math.random() > 0.975) drops[i] = 0
          else drops[i] += 0.22
        }
      }
      rafRef.current = requestAnimationFrame(draw)
    }

    init()
    window.addEventListener('resize', init)
    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', init)
    }
  }, [])

  return (
    <div className="classified-overlay" aria-hidden="true">
      <canvas ref={canvasRef} className="co-canvas" />
    </div>
  )
}

// ── System initialisation bar ─────────────────────────────────────────────────

const SYS_PHASES = [
  'DECRYPTING PAYLOAD',
  'VERIFYING CLEARANCE LEVEL',
  'LOADING INTEL PACKAGE',
  'CALIBRATING TARGETING MATRIX',
]

function SystemInitBar({ progress, online }) {
  const pct   = Math.round(progress * 100)
  const phase = SYS_PHASES[Math.min(Math.floor(progress * SYS_PHASES.length), SYS_PHASES.length - 1)]

  if (online) {
    return (
      <div className="sys-init sys-init--online" aria-live="polite">
        <div className="sys-init__header">
          <span className="sys-init__dot sys-init__dot--online" />
          <span className="sys-init__title">▸ TARGETING SYSTEM ONLINE</span>
        </div>
      </div>
    )
  }

  return (
    <div className="sys-init" aria-live="polite">
      <div className="sys-init__header">
        <span className="sys-init__dot" />
        <span className="sys-init__title">▸▸ ESTABLISHING SECURE CHANNEL</span>
        <span className="sys-init__pct">{pct}%</span>
      </div>
      <div className="sys-init__track">
        <div className="sys-init__fill" style={{ width: `${pct}%` }} />
        <div className="sys-init__scanline" />
      </div>
      <div className="sys-init__footer">
        <span className="sys-init__code">SYS:{phase}</span>
        <span className="sys-init__status">TARGETING OFFLINE · STAND BY</span>
      </div>
    </div>
  )
}

// ── Mobile targeting bar (fixed bottom strip) ─────────────────────────────────

function MobileTargetingBar({ ammoRemaining, ammoMax, scanWord }) {
  const isUnlimited = ammoMax >= 9999
  const isDepleted  = !isUnlimited && ammoRemaining === 0
  const maxBlocks   = isUnlimited ? 8 : Math.min(ammoMax || 8, 8)

  return (
    <div className="mobile-targeting-bar" aria-hidden="true">
      <div className="mtb__left">
        <div className="mtb__status-row">
          <span className="mtb__dot" />
          <span className="mtb__label">TARGETING</span>
        </div>
        <div className="mtb__ammo-row">
          <span className={`mtb__ammo-num${isDepleted ? ' mtb__ammo-num--depleted' : ''}`}>
            {isUnlimited ? '∞' : String(ammoRemaining).padStart(2, '0')}
          </span>
          <span className="mtb__ammo-label">{isUnlimited ? 'UNLIMITED' : isDepleted ? 'DEPLETED' : 'RDS'}</span>
        </div>
      </div>

      <div className="mtb__blocks">
        {Array.from({ length: maxBlocks }, (_, i) => (
          <span key={i} className={`mtb__block${i < ammoRemaining || isUnlimited ? ' mtb__block--live' : ' mtb__block--spent'}`}>
            {i < ammoRemaining || isUnlimited ? '■' : '□'}
          </span>
        ))}
      </div>

      <div className="mtb__scan">
        <span className="mtb__scan-label">{scanWord ? 'SCAN' : 'TAP'}</span>
        <span className="mtb__scan-word">{scanWord ? scanWord.word.toUpperCase() : 'KEYWORDS'}</span>
      </div>
    </div>
  )
}

// ── Keyword-aware description renderer ───────────────────────────────────────

function DescriptionArea({ description, keywords, hasAmmo, onKeywordClick, onHoverChange, isMobile, systemReady, unlockedKws, targeting, onScanWord, dossierOpen }) {
  const [reticlePos, setReticlePos] = useState({ x: 0, y: 0 })
  const [reticleOn,  setReticleOn]  = useState(false)
  const [hoveredKw,  setHoveredKw]  = useState(null)
  const [kwFlashIdx, setKwFlashIdx] = useState(-1)
  const areaRef          = useRef(null)
  const flashTimerRef    = useRef(null)
  const lastScannedRef   = useRef(null)

  // Parse description into text + keyword segments (memoised so effect can read it)
  const segments = useMemo(() => {
    if (!keywords?.length) return [{ type: 'text', content: description }]
    const sorted  = [...keywords].sort((a, b) => b.keyword.length - a.keyword.length)
    const pattern = new RegExp(
      `(?<![a-zA-Z0-9])(${sorted.map(k => escapeRegex(k.keyword)).join('|')})(?![a-zA-Z0-9])`,
      'gi'
    )
    const parts = []
    let last = 0, match
    while ((match = pattern.exec(description)) !== null) {
      if (match.index > last) parts.push({ type: 'text', content: description.slice(last, match.index) })
      const kw = keywords.find(k => k.keyword.toLowerCase() === match[1].toLowerCase())
      parts.push({ type: 'keyword', content: match[1], keyword: kw })
      last = match.index + match[1].length
    }
    if (last < description.length) parts.push({ type: 'text', content: description.slice(last) })
    return parts
  }, [description, keywords])

  const countInstances = (content) =>
    segments.filter(s => s.type === 'keyword' && s.content.toLowerCase() === content.toLowerCase()).length

  const emitScanWord = (content) => {
    if (!content) { onScanWord?.(null); return }
    onScanWord?.({ word: content, count: countInstances(content) })
  }

  // Flash keywords in sequence when targeting activates; report current word via onScanWord
  useEffect(() => {
    if (!targeting) {
      clearInterval(flashTimerRef.current)
      setKwFlashIdx(-1)
      lastScannedRef.current = null
      onScanWord?.(null)
      return
    }
    const kwSegs = segments.filter(s => s.type === 'keyword')
    if (kwSegs.length === 0) return
    clearInterval(flashTimerRef.current)
    let idx = 0
    setKwFlashIdx(0)
    lastScannedRef.current = kwSegs[0].content
    emitScanWord(kwSegs[0].content)
    playSound('target_locked_keyword')
    flashTimerRef.current = setInterval(() => {
      idx++
      if (idx >= kwSegs.length) {
        clearInterval(flashTimerRef.current)
        setKwFlashIdx(-1)
      } else {
        lastScannedRef.current = kwSegs[idx].content
        setKwFlashIdx(idx)
        emitScanWord(kwSegs[idx].content)
        playSound('target_locked_keyword')
      }
    }, 70)
    return () => clearInterval(flashTimerRef.current)
  }, [targeting]) // eslint-disable-line react-hooks/exhaustive-deps

  // Track cursor globally while dossier is open so reticle follows the mouse over the modal
  useEffect(() => {
    if (!dossierOpen) return
    const handler = (e) => setReticlePos({ x: e.clientX, y: e.clientY })
    document.addEventListener('mousemove', handler)
    return () => document.removeEventListener('mousemove', handler)
  }, [dossierOpen])

  const handleMouseMove  = (e) => setReticlePos({ x: e.clientX, y: e.clientY })
  const handleMouseEnter = ()  => { setReticleOn(true);  if (systemReady) onHoverChange?.(true)  }
  const handleMouseLeave = ()  => { if (dossierOpen) return; setReticleOn(false); setHoveredKw(null); if (systemReady) onHoverChange?.(false) }

  // Track keyword instance index separately from segment index
  let kwInstanceIdx = -1

  return (
    <div
      ref={areaRef}
      className="description-area"
      onMouseMove={isMobile ? undefined : handleMouseMove}
      onMouseEnter={isMobile ? undefined : handleMouseEnter}
      onMouseLeave={isMobile ? undefined : handleMouseLeave}
    >
      {/* Custom reticle cursor — desktop only, shows even during system init */}
      {!isMobile && reticleOn && (
        <div
          className={`custom-reticle ${hoveredKw ? 'custom-reticle--targeted' : ''} ${!hasAmmo ? 'custom-reticle--grey' : ''}`}
          style={{ left: reticlePos.x, top: reticlePos.y }}
          aria-hidden="true"
        >
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="5.5" stroke="currentColor" strokeWidth="1.5"/>
            <circle cx="16" cy="16" r="1.5" fill="currentColor"/>
            <path d="M16 2v6M16 24v6M2 16h6M24 16h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            {hoveredKw && <circle cx="16" cy="16" r="10" stroke="currentColor" strokeWidth="0.75" strokeDasharray="3 3" opacity="0.6"/>}
          </svg>
        </div>
      )}

      {(() => {
        // Group segments into paragraphs on \n\n boundaries within text segments
        const paragraphs = []
        let currentPara  = []
        for (const seg of segments) {
          if (seg.type === 'text') {
            const parts = seg.content.split('\n\n')
            currentPara.push({ ...seg, content: parts[0] })
            for (let j = 1; j < parts.length; j++) {
              paragraphs.push(currentPara)
              currentPara = [{ type: 'text', content: parts[j] }]
            }
          } else {
            currentPara.push(seg)
          }
        }
        if (currentPara.length > 0) paragraphs.push(currentPara)

        return paragraphs.map((para, pi) => (
          <p key={pi} className={`description-text ${hoveredKw ? 'description-text--dimmed' : ''}`}>
            {para.map((seg, i) => {
              if (seg.type === 'text') return <span key={i}>{seg.content}</span>
              kwInstanceIdx++
              const thisIdx    = kwInstanceIdx
              const isHovered  = hoveredKw?.keyword === seg.keyword?.keyword
              const isUnlocked = unlockedKws?.has(seg.keyword?.keyword)
              const isFlashing = kwFlashIdx === thisIdx
              return (
                <span
                  key={i}
                  className={`kw-highlight${isUnlocked ? ' kw-highlight--unlocked' : ''}${isHovered ? ' kw-highlight--targeted' : ''}${isFlashing ? ' kw-highlight--flash' : ''}`}
                  onMouseEnter={isMobile ? undefined : () => { setHoveredKw(seg.keyword); lastScannedRef.current = seg.content; emitScanWord(seg.content) }}
                  onMouseLeave={isMobile ? undefined : () => setHoveredKw(null)}
                  onTouchEnd={isMobile ? (e) => { e.preventDefault(); onKeywordClick(e, seg.keyword) } : undefined}
                  onClick={isMobile ? undefined : (e) => onKeywordClick(e, seg.keyword)}
                >
                  {seg.content}
                </span>
              )
            })}
          </p>
        ))
      })()}
    </div>
  )
}

// ── Media carousel ────────────────────────────────────────────────────────────

function MediaCarousel({ media }) {
  const [idx, setIdx] = useState(0)
  const [imgError, setImgError] = useState(false)
  if (!media?.length) return null
  const item = media[idx]

  const handleNext = (dir) => {
    setImgError(false)
    setIdx(i => Math.max(0, Math.min(media.length - 1, i + dir)))
  }

  return (
    <div className="media-carousel">
      {item.mediaType === 'picture'
        ? imgError
          ? <div className="carousel-img-error">Image could not be loaded — URL may be invalid or blocked.</div>
          : <img src={item.mediaUrl} alt="" className="carousel-img" onError={() => setImgError(true)} />
        : <video src={item.mediaUrl} controls className="carousel-img" />
      }
      {media.length > 1 && (
        <div className="carousel-controls">
          <button onClick={() => handleNext(-1)} disabled={idx === 0} aria-label="Previous">‹</button>
          <span>{idx + 1} / {media.length}</span>
          <button onClick={() => handleNext(1)} disabled={idx === media.length - 1} aria-label="Next">›</button>
        </div>
      )}
    </div>
  )
}

// ── Brief game-data intel panel ───────────────────────────────────────────────

const GAMEDATA_FIELDS = {
  Aircrafts: [
    { key: 'topSpeedKph',    label: 'TOP SPEED',       format: v => `${Number(v).toLocaleString()} KPH` },
    { key: 'yearIntroduced', label: 'YEAR INTRODUCED', format: v => String(v) },
    { key: 'yearRetired',    label: 'YEAR RETIRED',    format: v => v != null ? String(v) : 'IN SERVICE' },
  ],
  Ranks: [
    { key: 'rankHierarchyOrder', label: 'RANK TIER', format: v => `#${v}` },
  ],
  Training: [
    { key: 'trainingWeekStart', label: 'PHASE START', format: v => `WEEK ${v}` },
    { key: 'trainingWeekEnd',   label: 'PHASE END',   format: v => `WEEK ${v}` },
  ],
  Missions: [
    { key: 'startYear', label: 'COMMENCED', format: v => String(v) },
    { key: 'endYear',   label: 'CONCLUDED', format: v => v != null ? String(v) : 'ONGOING' },
  ],
  Tech: [
    { key: 'startYear', label: 'INTRODUCED', format: v => String(v) },
    { key: 'endYear',   label: 'RETIRED',    format: v => v != null ? String(v) : 'ACTIVE' },
  ],
  Treaties: [
    { key: 'startYear', label: 'RATIFIED',  format: v => String(v) },
    { key: 'endYear',   label: 'DISSOLVED', format: v => v != null ? String(v) : 'IN FORCE' },
  ],
}

function BriefGameDataPanel({ brief }) {
  // Historic ranks: show decommissioned status only, no numeric stats
  if (brief.category === 'Ranks' && brief.historic) {
    return (
      <div className="brief-gamedata-panel">
        <span className="brief-gamedata-eyebrow">// CLASSIFIED TECHNICAL DATA</span>
        <div className="brief-gamedata-grid">
          <div className="brief-gamedata-row">
            <span className="brief-gamedata-label">STATUS</span>
            <span className="brief-gamedata-val brief-gamedata-val--historic">HISTORIC RANK — No longer in use</span>
          </div>
        </div>
      </div>
    )
  }
  const fields = GAMEDATA_FIELDS[brief.category]
  if (!fields || !brief.gameData) return null
  const visibleRows = fields.filter(f => {
    if (f.key === 'yearRetired')  return brief.gameData.yearIntroduced != null
    if (f.key === 'endYear')      return brief.gameData.startYear != null
    return brief.gameData[f.key] != null
  })
  if (visibleRows.length === 0) return null
  return (
    <div className="brief-gamedata-panel">
      <span className="brief-gamedata-eyebrow">// CLASSIFIED TECHNICAL DATA</span>
      <div className="brief-gamedata-grid">
        {visibleRows.map(f => (
          <div key={f.key} className="brief-gamedata-row">
            <span className="brief-gamedata-label">{f.label}</span>
            <span className="brief-gamedata-val">{f.format(brief.gameData[f.key])}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function IntelligenceBrief({ briefId, navigate }) {
  const { user, setUser, API, awardAircoins } = useAuth()

  // Touch-only devices don't hover — disable focus mode for them
  const isMobile = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches

  const [brief,         setBrief]         = useState(null)
  const [ammoRemaining, setAmmoRemaining] = useState(0)
  const [ammoMax,       setAmmoMax]       = useState(0)
  const [loading,       setLoading]       = useState(true)
  const [notFound,      setNotFound]      = useState(false)
  const [accessDenied,  setAccessDenied]  = useState(false)
  const [dossier,       setDossier]       = useState(null)
  const [ammoItems,     setAmmoItems]     = useState([])
  const [quizOpen,      setQuizOpen]      = useState(false)
  const [battleOpen,    setBattleOpen]    = useState(false)
  const [unlockedKws,   setUnlockedKws]   = useState(() => new Set())
  const [quizCompleted, setQuizCompleted] = useState(null) // null=unknown, true/false
  const [quizAircoinReward, setQuizAircoinReward] = useState(0) // kept for quiz modal visibility gate
  const [booCompleted,     setBooCompleted]     = useState(false)
  const [booAvailable,     setBooAvailable]     = useState(null) // null=fetching, true, false
  const [booOptions,       setBooOptions]       = useState([])   // available orderType strings
  const [booCompletedSet,  setBooCompletedSet]  = useState(new Set()) // won orderType strings
  const pendingBooComplete = useRef(null) // deferred until modal close
  const [descHovered,     setDescHovered]     = useState(false)
  const [scanWord,        setScanWord]        = useState(null)
  const [descRect,        setDescRect]        = useState(null)
  const [descScrollY,     setDescScrollY]     = useState(0)
  const aircoinRewardRef      = useRef(0)
  const aircoinCycleRef       = useRef(null)
  const aircoinRankPromoRef   = useRef(null)
  const [systemReady,     setSystemReady]     = useState(false)
  const [systemProgress,  setSystemProgress]  = useState(0)
  const [sysOnline,       setSysOnline]       = useState(false)
  const [pageRevealed,    setPageRevealed]    = useState(false)
  const systemReadyRef    = useRef(false)   // stable ref for callbacks
  const pageRevealedRef   = useRef(false)   // stable ref for callbacks
  const [loadingBarDisabled, setLoadingBarDisabled] = useState(null) // null = not yet fetched
  const openSoundRef        = useRef(false)
  const aircoinSoundRef     = useRef(false)
  const targetingActiveRef  = useRef(false)
  const descWrapRef    = useRef(null)
  const mainRef        = useRef(null)
  const rfbRef         = useRef(null)
  const isScrollingRef = useRef(false)
  const scrollTimerRef = useRef(null)
  const mousePosRef    = useRef({ x: 0, y: 0 })

  // Mobile scroll-based targeting
  const [mobileTargeting, setMobileTargeting] = useState(false)
  const mobileTargetingRef = useRef(false)

  // ── Time-spent-reading tracker ──────────────────────────────────────────────
  // Counts elapsed seconds in a ref and flushes to the API every 30s and on unmount/quiz-open.
  const readTimeRef      = useRef(0)
  const timerIntervalRef = useRef(null)

  // Always-current flush function stored in a ref so the timer interval
  // can call it without needing to be in its dependency array.
  const flushTimeRef = useRef(null)
  flushTimeRef.current = () => {
    if (!user || readTimeRef.current <= 0 || !briefId) return
    const secs = readTimeRef.current
    readTimeRef.current = 0
    fetch(`${API}/api/briefs/${briefId}/time`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seconds: secs }),
    }).catch(() => {})
  }

  // Start timer when brief loads and user is logged in.
  // Pause (flush + stop) when quiz opens, resume when quiz closes.
  // Flush remaining seconds when navigating away (effect cleanup / unmount).
  useEffect(() => {
    if (!brief || !user) return

    if (quizOpen) {
      clearInterval(timerIntervalRef.current)
      flushTimeRef.current()
      return
    }

    timerIntervalRef.current = setInterval(() => {
      readTimeRef.current += 1
      if (readTimeRef.current % 30 === 0) flushTimeRef.current()
    }, 1000)

    return () => {
      clearInterval(timerIntervalRef.current)
      flushTimeRef.current()
    }
  }, [brief, user, quizOpen])

  // ── Global mouse tracking — needed for cursor-position checks ───────────────
  useEffect(() => {
    const onMove = (e) => { mousePosRef.current = { x: e.clientX, y: e.clientY } }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  // ── Scroll detection — desktop only ──────────────────────────────────────────
  // Block targeting while scrolling. When scroll ends, re-check cursor position —
  // onMouseEnter only fires once (boundary crossing), so if the cursor is already
  // over the description when scrolling stops we must activate manually.
  useEffect(() => {
    if (isMobile) return
    const onScroll = () => {
      isScrollingRef.current = true
      clearTimeout(scrollTimerRef.current)
      scrollTimerRef.current = setTimeout(() => {
        isScrollingRef.current = false
        if (!systemReadyRef.current) return
        const { x, y } = mousePosRef.current
        const rect = descWrapRef.current?.getBoundingClientRect()
        if (rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          setDescHovered(true)
        }
      }, 200)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      clearTimeout(scrollTimerRef.current)
    }
  }, [isMobile])

  // ── Mobile: engage targeting when description scrolls into view ───────────
  // Scroll-driven targeting for mobile.
  // Runs on every scroll event so it re-evaluates correctly on any screen size —
  // IntersectionObserver was unreliable on larger screens because it only fires on
  // threshold crossings, meaning if the desc never dropped below 0.45 after a
  // disengage, it would never re-fire isIntersecting:true and targeting stayed dead.
  useEffect(() => {
    if (!isMobile || !pageRevealed) return
    const descEl = descWrapRef.current
    const rfbEl  = rfbRef.current
    if (!descEl) return

    let userHasScrolled = false

    const engage = () => {
      if (!userHasScrolled || mobileTargetingRef.current) return
      mobileTargetingRef.current = true
      setMobileTargeting(true)
      playSound('target_locked')
    }

    const disengage = () => {
      if (!mobileTargetingRef.current) return
      mobileTargetingRef.current = false
      setMobileTargeting(false)
      playSound('stand_down')
    }

    const checkTargeting = () => {
      const rect = descEl.getBoundingClientRect()
      const visible = rect.height > 0
        ? Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0)) / rect.height
        : 0
      // Disengage when RFB top enters the lower 80% of screen, or when near page bottom
      const rfbRect   = rfbEl?.getBoundingClientRect()
      const pastRfb   = rfbRect && rfbRect.top <= window.innerHeight * 0.8
      const nearBottom = (window.scrollY + window.innerHeight) >= (document.documentElement.scrollHeight - 120)
      if (visible >= 0.45 && !pastRfb && !nearBottom) engage()
      else disengage()
    }

    const onScroll = () => {
      if (!userHasScrolled) userHasScrolled = true
      checkTargeting()
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [isMobile, pageRevealed]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── HUD position ───────────────────────────────────────────────────────────
  // Keep descRect alive while the dossier modal is open so the HUDs don't disappear
  // when the mouse moves from the description into the modal.
  // Capture scrollY at the same moment so HUDs can be absolutely positioned in
  // document space (they then scroll naturally with the page).
  const [mainOffsetY, setMainOffsetY] = useState(0)

  useEffect(() => {
    if (descHovered && descWrapRef.current) {
      setDescRect(descWrapRef.current.getBoundingClientRect())
      setDescScrollY(window.scrollY)
      setMainOffsetY(mainRef.current ? mainRef.current.offsetTop : 0)
    } else if (!descHovered && !dossier) {
      setDescRect(null)
    }
  }, [descHovered, dossier])

  // ── Fetch brief ────────────────────────────────────────────────────────────
  // Uses optional auth — works for guests (no readRecord) and logged-in users.
  useEffect(() => {
    if (!briefId) { setNotFound(true); setLoading(false); return }
    setLoading(true)
    setNotFound(false)
    setAccessDenied(false)

    fetch(`${API}/api/briefs/${briefId}`, { credentials: 'include' })
      .then(r => {
        if (r.status === 404) { setNotFound(true); return null }
        if (r.status === 403) { setAccessDenied(true); return null }
        return r.json()
      })
      .then(data => {
        if (!data) return
        setBrief(data?.data?.brief ?? null)
        const initAmmo = data?.data?.readRecord?.ammunitionRemaining ?? 0
        setAmmoRemaining(initAmmo)
        setAmmoMax(initAmmo)
        if (data?.data?.aircoinsEarned > 0) {
          aircoinRewardRef.current    = data.data.aircoinsEarned
          aircoinCycleRef.current     = data.data.newCycleAircoins ?? null
          aircoinRankPromoRef.current = data.data.rankPromotion ?? null
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [API, briefId])

  // ── Fetch quiz completion status ─────────────────────────────────────────────
  useEffect(() => {
    if (!user || !briefId) return
    fetch(`${API}/api/games/quiz/status/${briefId}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => setQuizCompleted(data?.data?.hasCompleted ?? false))
      .catch(() => {})
  }, [API, briefId, user])

  // ── Fetch BOO completion + availability status ────────────────────────────────
  useEffect(() => {
    if (!user || !brief?._id) return
    const BOO_CATS = ['Aircrafts','Ranks','Training','Missions','Tech','Treaties']
    // Completion status — which orderTypes has this user won for this brief?
    fetch(`${API}/api/games/battle-of-order/status/${brief._id}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        const completed = data?.data?.completedOrderTypes ?? []
        setBooCompleted(data?.data?.hasCompleted ?? false)
        // Deduplicate by orderType (any difficulty counts as "done")
        setBooCompletedSet(new Set(completed.map(c => c.orderType)))
      })
      .catch(() => {})
    // Availability — which orderTypes have enough briefs in this category?
    if (!BOO_CATS.includes(brief.category)) return
    fetch(`${API}/api/games/battle-of-order/options?briefId=${brief._id}`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        setBooAvailable(data?.data?.available ?? false)
        setBooOptions((data?.data?.options ?? []).map(o => o.orderType))
      })
      .catch(() => setBooAvailable(false))
  }, [API, brief?._id, user])

  // Lock body scroll during loading sequence, restore on reveal or unmount
  useEffect(() => {
    if (pageRevealed) {
      document.body.style.overflow = ''
    } else {
      document.body.style.overflow = 'hidden'
    }
    return () => { document.body.style.overflow = '' }
  }, [pageRevealed])

  // Fetch app settings to check disableLoadingBar flag
  useEffect(() => {
    fetch(`${API}/api/settings`)
      .then(r => r.json())
      .then(data => setLoadingBarDisabled(data.disableLoadingBar ?? false))
      .catch(() => setLoadingBarDisabled(false))
  }, [API])

  // Play open sound once, track its progress to gate the targeting system.
  // systemReady stays false until the sound ends (or fails), so hover/clicks
  // are disabled while the "ESTABLISHING SECURE CHANNEL" bar is visible.
  useEffect(() => {
    if (!brief || loadingBarDisabled === null || openSoundRef.current) return
    openSoundRef.current = true

    if (loadingBarDisabled) {
      setSystemProgress(1)
      setSystemReady(true)
      systemReadyRef.current = true
      setPageRevealed(true)
      pageRevealedRef.current = true
      if (aircoinRewardRef.current > 0 && !aircoinSoundRef.current) {
        aircoinSoundRef.current = true
        awardAircoins(aircoinRewardRef.current, 'BRIEF READ REWARD', { cycleAfter: aircoinCycleRef.current, rankPromotion: aircoinRankPromoRef.current })
      }
      return
    }

    playSound('intel_brief_opened', {
        onAudio: (audio) => {
          const tick = () => {
            if (audio.duration) {
              setSystemProgress(Math.min(audio.currentTime / audio.duration, 1))
            }
          }
          audio.addEventListener('loadedmetadata', tick)
          audio.addEventListener('timeupdate', tick)
        },
      }).then(() => {
        setSystemProgress(1)
        setSystemReady(true)
        systemReadyRef.current = true
        setSysOnline(true)
        // Hold "TARGETING SYSTEM ONLINE" for 1s while page stays greyed,
        // then reveal page and remove bar simultaneously.
        setTimeout(() => {
          setSysOnline(false)
          setPageRevealed(true)
          pageRevealedRef.current = true

          // Trigger aircoin reward notification once page is revealed — one-time guard
          // avoids StrictMode double-fire since the ref lives outside the component.
          if (aircoinRewardRef.current > 0 && !aircoinSoundRef.current) {
            aircoinSoundRef.current = true
            awardAircoins(aircoinRewardRef.current, 'BRIEF READ REWARD', { cycleAfter: aircoinCycleRef.current, rankPromotion: aircoinRankPromoRef.current })
          }

          // If cursor is already over the description when the page reveals,
          // mouseenter was blocked until now — manually activate targeting.
          if (!window.matchMedia('(hover: none)').matches) {
            const { x, y } = mousePosRef.current
            const rect = descWrapRef.current?.getBoundingClientRect()
            if (rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
              targetingActiveRef.current = true
              setDescHovered(true)
              playSound('target_locked')
            }
          }
        }, 1000)
      })
  }, [brief, loadingBarDisabled])

  // ── Desc hover — ignore activations that fire during a scroll or before ready
  const handleDescHoverChange = useCallback((hovered) => {
    if (!systemReadyRef.current || !pageRevealedRef.current) return
    if (hovered && isScrollingRef.current) return
    if (hovered && !targetingActiveRef.current) playSound('target_locked')
    if (!hovered && targetingActiveRef.current) playSound('stand_down')
    targetingActiveRef.current = hovered
    setDescHovered(hovered)
  }, [])

  // ── Dossier close — keep targeting only if cursor is still over the description
  const handleDossierClose = useCallback(() => {
    setDossier(null)
    if (isMobile) return // mobile targeting is scroll-driven, unaffected by dossier close
    const { x, y } = mousePosRef.current
    const rect = descWrapRef.current?.getBoundingClientRect()
    const overDesc = systemReadyRef.current && rect &&
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    targetingActiveRef.current = overDesc
    setDescHovered(overDesc)
  }, [isMobile])

  // ── Keyword click ──────────────────────────────────────────────────────────
  const hasAmmo = ammoRemaining > 0

  const handleKeywordClick = useCallback((e, keyword) => {
    if (!systemReadyRef.current) return
    e.stopPropagation()
    const touch = e.changedTouches?.[0]
    const clientX = touch ? touch.clientX : e.clientX
    const clientY = touch ? touch.clientY : e.clientY
    const kwKey = keyword.keyword
    const alreadyUnlocked = unlockedKws.has(kwKey)

    if (alreadyUnlocked || hasAmmo) {
      playSound('fire')
      // Update scan word so the mobile bar shows this keyword when dossier closes
      if (isMobile) {
        const desc = brief?.description ?? ''
        const count = desc
          ? (desc.match(new RegExp(`(?<![a-zA-Z0-9])${escapeRegex(kwKey)}(?![a-zA-Z0-9])`, 'gi')) ?? []).length || 1
          : 1
        setScanWord({ word: kwKey, count })
      }
      if (!alreadyUnlocked) {
        // First use — consume ammo and mark as unlocked
        fetch(`${API}/api/briefs/${briefId}/use-ammo`, {
          method: 'POST',
          credentials: 'include',
        })
          .then(r => r.json())
          .then(data => {
            if (data?.data?.ammunitionRemaining !== undefined) {
              setAmmoRemaining(data.data.ammunitionRemaining)
            }
          })
          .catch(() => {})
        setUnlockedKws(prev => new Set(prev).add(kwKey))
      }
      setDossier({ keyword, clickX: clientX, clickY: clientY, scrollY: window.scrollY })
    } else {
      setAmmoItems(prev => [...prev, { id: Date.now(), x: clientX, y: clientY }])
    }
  }, [API, brief, briefId, hasAmmo, isMobile, unlockedKws])

  // ── Render states ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <main className="page brief-page">
        <div className="section-inner">
          <div className="feed-loading"><div className="app-loading__spinner" /></div>
        </div>
      </main>
    )
  }

  if (accessDenied) {
    return (
      <main className="page brief-page">
        <div className="section-inner">
          <div className="brief-access-denied">
            <span className="brief-access-denied__icon">🔒</span>
            <h2 className="brief-access-denied__title">Subscription Required</h2>
            <p className="brief-access-denied__msg">
              This category is not available on your current subscription tier.
              Upgrade to unlock access to this intel brief.
            </p>
            <button className="btn-ghost" onClick={() => navigate('intel-feed')}>← Back to Intel Feed</button>
          </div>
        </div>
      </main>
    )
  }

  if (notFound || !brief) {
    return (
      <main className="page brief-page">
        <div className="section-inner">
          <p className="empty-state">Brief not found.</p>
          <button className="btn-ghost" onClick={() => navigate('intel-feed')}>← Back to Intel Feed</button>
        </div>
      </main>
    )
  }

  // ── Main render ────────────────────────────────────────────────────────────

  const targetingActive = !isMobile && (descHovered || !!dossier)
  const hasSpaceLeft    = descRect && descRect.left > 220
  const hasSpaceRight   = descRect && (window.innerWidth - descRect.right) > 220
  const showSideHUDs    = pageRevealed && targetingActive && !!descRect && hasSpaceLeft && hasSpaceRight
  const showBelowHUDs   = pageRevealed && targetingActive && !!descRect && !(hasSpaceLeft && hasSpaceRight)

  return (
    <main ref={mainRef} className={`page brief-page${targetingActive ? ' targeting-active' : ''}${!pageRevealed ? ' brief-page--initializing' : ''}`}>

      {!pageRevealed && <ClassifiedOverlay />}

      <div className="section-inner brief-layout">

        {/* ── Back nav ───────────────────────────────────── */}
        <button className="back-link" onClick={() => navigate('intel-feed')}>
          ← Intel Feed
        </button>

        {/* ── Category / subcategory ──────────────────────── */}
        <div className="brief-category-row">
          <span className="brief-category-badge">▸ {brief.category}</span>
          {brief.subcategory && brief.category !== 'News' && (
            <>
              <span className="brief-category-sep">//</span>
              <span className="brief-subcategory-badge">{brief.subcategory}</span>
            </>
          )}
        </div>

        {/* ── Title block ────────────────────────────────── */}
        <h1 className="brief-title">{brief.title}</h1>
        {brief.subtitle && (
          <p className="brief-subtitle">
            <span className="brief-subtitle__marker" aria-hidden="true">◈</span>
            {brief.subtitle}
          </p>
        )}

        {/* ── Media ──────────────────────────────────────── */}
        <MediaCarousel media={brief.media} />

        {/* ── Game-data intel panel ───────────────────── */}
        <BriefGameDataPanel brief={brief} />

        {/* ── System init bar ─────────────────────────────── */}
        {!pageRevealed && (
          <SystemInitBar progress={systemProgress} online={sysOnline} />
        )}

        {/* ── Description ────────────────────────────────── */}
        <div ref={descWrapRef}>
          <DescriptionArea
            description={brief.description}
            keywords={brief.keywords}
            hasAmmo={hasAmmo}
            onKeywordClick={handleKeywordClick}
            onHoverChange={handleDescHoverChange}
            isMobile={isMobile}
            systemReady={systemReady}
            unlockedKws={unlockedKws}
            targeting={isMobile ? mobileTargeting : descHovered}
            onScanWord={setScanWord}
            dossierOpen={!!dossier}
          />
        </div>

        {/* ── Below HUDs — shown when screen too narrow for side panels ── */}
        {showBelowHUDs && (
          <div className="targeting-hud-below">
            <TargetingHUD
              side="left"
              below
              descRect={descRect}
              scrollY={descScrollY}
              ammoRemaining={ammoRemaining}
              ammoMax={ammoMax}
              description={brief.description}
              keywordCount={brief.keywords?.length ?? 0}
              loggedIn={!!user}
              onLoginClick={() => navigate('login')}
            />
            <TargetingHUD
              side="right"
              below
              descRect={descRect}
              scrollY={descScrollY}
              ammoRemaining={ammoRemaining}
              ammoMax={ammoMax}
              description={brief.description}
              keywordCount={brief.keywords?.length ?? 0}
              loggedIn={!!user}
              onLoginClick={() => navigate('login')}
              scanWord={scanWord}
            />
          </div>
        )}

        {/* ── Sources ────────────────────────────────────── */}
        {brief.sources?.length > 0 && (
          <div className="brief-sources">
            <h3 className="brief-sources__title">▸ Intel Sources</h3>
            <ul className="brief-sources__list">
              {brief.sources.map((src, i) => (
                <li key={i}>
                  <a href={src.url} target="_blank" rel="noreferrer" className="brief-source-link">
                    <span className="brief-source-link__arrow" aria-hidden="true">↗</span>
                    <span className="brief-source-link__name">{src.siteName || src.url}</span>
                    {src.articleDate && (
                      <span className="brief-source-date">
                        {new Date(src.articleDate).toLocaleDateString('en-GB')}
                      </span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Ready for Briefing ─────────────────────────── */}
        <div ref={rfbRef}>
          <ReadyForBriefing
            briefId={brief._id}
            hasQuestions={(brief.quizQuestionsEasy?.length ?? 0) > 0 || (brief.quizQuestionsMedium?.length ?? 0) > 0}
            hasCompleted={quizCompleted === true}
            quizOpen={quizOpen}
            targetingActive={mobileTargeting}
            loggedIn={!!user}
            onLoginClick={() => navigate('login')}
            onQuizOpen={() => setQuizOpen(true)}
            onQuizClose={() => setQuizOpen(false)}
            onQuizComplete={(coins, { rankPromotion, cycleAircoins } = {}) => {
              setQuizCompleted(true)
              if (coins > 0) {
                setQuizAircoinReward(coins)
                awardAircoins(coins, 'QUIZ REWARD', { cycleAfter: cycleAircoins, rankPromotion })
              }
            }}
          />
        </div>

        {/* ── Battle of Order ────────────────────────────────── */}
        {user && pageRevealed && ['Aircrafts','Ranks','Training','Missions','Tech','Treaties'].includes(brief.category) && (booAvailable !== null || (brief.category === 'Ranks' && brief.historic)) && (() => {
          const booHistoricLocked = brief.category === 'Ranks' && brief.historic === true
          const allBooComplete  = !booHistoricLocked && booOptions.length > 0 && booOptions.every(ot => booCompletedSet.has(ot))
          const booQuizLocked   = !booHistoricLocked && quizCompleted !== true
          const booLocked       = booHistoricLocked || booAvailable === false || booQuizLocked
          return (
            <div className={`boa-trigger-wrap${booLocked ? ' boa-trigger-wrap--locked' : ''}`}>
              {booHistoricLocked && (
                <div className="boa-trigger-badge boa-trigger-badge--historic" aria-hidden="true">
                  <span className="boa-trigger-badge__icon">⬡</span>
                  <span className="boa-trigger-badge__text">DECOMMISSIONED</span>
                  <span className="boa-trigger-badge__sub">Historic Rank</span>
                </div>
              )}
              {!booHistoricLocked && booAvailable === false && (
                <div className="boa-trigger-badge" aria-hidden="true">
                  <span className="boa-trigger-badge__icon">⬡</span>
                  <span className="boa-trigger-badge__text">CLASSIFIED</span>
                  <span className="boa-trigger-badge__sub">Insufficient Intel Assets</span>
                </div>
              )}
              {!booHistoricLocked && booAvailable !== false && booQuizLocked && (
                <div className="boa-trigger-badge boa-trigger-badge--quiz-locked" aria-hidden="true">
                  <span className="boa-trigger-badge__icon">⬡</span>
                  <span className="boa-trigger-badge__text">MISSION LOCKED</span>
                  <span className="boa-trigger-badge__sub">Complete Knowledge Check</span>
                </div>
              )}
              <div className="boa-trigger-inner">
                <span className="boa-trigger-eyebrow">Intelligence Game</span>
                {allBooComplete && !booLocked ? (
                  <h3 className="boa-trigger-title boa-trigger-title--done">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" style={{ verticalAlign: 'middle', marginRight: '0.4rem' }}>
                      <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M6 10l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Battle of Order — Mission Successful
                  </h3>
                ) : (
                  <h3 className="boa-trigger-title">Battle of Order</h3>
                )}
                <p className="boa-trigger-subtitle">
                  {allBooComplete && !booLocked
                    ? 'All sequences completed. Replay any game type — no extra Aircoins awarded.'
                    : 'Arrange intel assets in the correct sequence to earn Aircoins. The game type is randomly selected.'}
                </p>
                {booHistoricLocked ? (
                  <p className="boa-trigger-locked-msg">
                    This rank has been decommissioned and is no longer active. Historic ranks are excluded from Battle of Order.
                  </p>
                ) : booAvailable === false ? (
                  <p className="boa-trigger-locked-msg">
                    Not enough intel briefs in this category yet. More classified assets must be added before this mission can be unlocked.
                  </p>
                ) : booQuizLocked ? (
                  <p className="boa-trigger-locked-msg">
                    Complete the Knowledge Check for this intel brief to unlock Battle of Order.
                  </p>
                ) : (
                  <button className={`rfb__cta${allBooComplete ? ' rfb__cta--retake' : ''}`} onClick={() => setBattleOpen(true)}>
                    {!allBooComplete && (
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                    {allBooComplete ? 'Replay Battle of Order' : booCompleted ? 'Regenerate Battle of Order' : 'Generate Battle of Order'}
                  </button>
                )}
              </div>
            </div>
          )
        })()}
        {battleOpen && (
          <BattleOfOrderModal
            briefId={brief._id}
            category={brief.category}
            onClose={() => {
              // Flush accumulated coin rewards deferred from the game results
              if (pendingBooComplete.current) {
                const { totalCoins, lastMeta } = pendingBooComplete.current
                pendingBooComplete.current = null
                if (totalCoins > 0) awardAircoins(totalCoins, 'BATTLE OF ORDER', lastMeta)
              }
              setBattleOpen(false)
            }}
            onComplete={(coins, meta) => {
              // Accumulate across multiple wins in one session — avoids overlapping BOO sounds
              const prev = pendingBooComplete.current
              pendingBooComplete.current = { totalCoins: (prev?.totalCoins ?? 0) + coins, lastMeta: meta }
              setBooCompleted(true)
              if (meta?.orderType) {
                setBooCompletedSet(prev => new Set([...prev, meta.orderType]))
              }
            }}
          />
        )}

      </div>

      {/* ── Side Targeting HUDs — desktop, wide screen only ── */}
      {showSideHUDs && (
        <TargetingHUD
          side="left"
          descRect={descRect}
          scrollY={descScrollY}
          mainOffsetY={mainOffsetY}
          ammoRemaining={ammoRemaining}
          ammoMax={ammoMax}
          description={brief.description}
          keywordCount={brief.keywords?.length ?? 0}
          loggedIn={!!user}
          onLoginClick={() => navigate('login')}
        />
      )}
      {showSideHUDs && (
        <TargetingHUD
          side="right"
          descRect={descRect}
          scrollY={descScrollY}
          mainOffsetY={mainOffsetY}
          ammoRemaining={ammoRemaining}
          ammoMax={ammoMax}
          description={brief.description}
          keywordCount={brief.keywords?.length ?? 0}
          loggedIn={!!user}
          onLoginClick={() => navigate('login')}
          scanWord={scanWord}
        />
      )}

      {/* ── Mobile targeting bar ──────────────────────────── */}
      {isMobile && mobileTargeting && pageRevealed && !dossier && (
        <MobileTargetingBar
          ammoRemaining={ammoRemaining}
          ammoMax={ammoMax}
          scanWord={scanWord}
        />
      )}

      {/* ── Overlays ──────────────────────────────────────── */}
      {dossier && (
        <TargetDossierModal
          keyword={dossier.keyword}
          clickX={dossier.clickX}
          clickY={dossier.clickY}
          scrollY={dossier.scrollY}
          descRect={descRect}
          descScrollY={descScrollY}
          onClose={handleDossierClose}
        />
      )}

      {ammoItems.map(item => (
        <OutOfAmmo
          key={item.id}
          x={item.x}
          y={item.y}
          onDone={() => setAmmoItems(prev => prev.filter(a => a.id !== item.id))}
        />
      ))}

    </main>
  )
}
