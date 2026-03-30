import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { motion, AnimatePresence, useMotionValue, useTransform, useAnimationControls } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { useAppTutorial } from '../../context/AppTutorialContext'
import TutorialModal from '../../components/tutorial/TutorialModal'
import LockedCategoryModal from '../../components/LockedCategoryModal'
import MissionDetectedModal from '../../components/MissionDetectedModal'
import { requiredTier } from '../../utils/subscription'
import { useAppSettings } from '../../context/AppSettingsContext'
import { playSound } from '../../utils/sound'
import RafBasesMap from '../../components/RafBasesMap'
import { buildImageZones } from '../../utils/briefImageZones'

// ── Keyword bottom-sheet ──────────────────────────────────────────────────
function KeywordSheet({ kw, onClose, navigate }) {
  const isLinked = !!kw?.linkedBriefId
  const hasDesc  = !!kw?.generatedDescription

  const handleOpenBrief = () => {
    onClose()
    navigate(`/brief/${kw.linkedBriefId}`)
  }

  return (
    <AnimatePresence>
      {kw && (
        <>
          <motion.div
            key="kw-bg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-900/40"
            onClick={onClose}
          />
          <motion.div
            key="kw-sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="fixed bottom-0 inset-x-0 z-50 bg-surface rounded-t-3xl p-6 pb-10 max-w-lg mx-auto shadow-2xl"
          >
            {/* Drag handle */}
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-5" />

            <div className="flex items-start gap-3">
              <span className="text-3xl">{isLinked ? '📋' : '🔑'}</span>
              <div>
                <h3 className="text-lg font-extrabold text-slate-900 mb-1">{kw.keyword}</h3>
                {isLinked && kw.linkedBriefCategory && (
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-1">{kw.linkedBriefCategory}</p>
                )}
                {hasDesc ? (
                  <p className="text-sm text-slate-600 leading-relaxed">{kw.generatedDescription}</p>
                ) : isLinked ? (
                  <p className="text-sm text-slate-600 leading-relaxed">
                    This subject has its own Intel Brief. Open it to learn more.
                  </p>
                ) : null}
              </div>
            </div>

            {isLinked ? (
              <div className="mt-5 flex flex-col gap-2">
                <button
                  onClick={handleOpenBrief}
                  className="w-full py-3 rounded-2xl bg-brand-600 hover:bg-brand-700 text-white font-bold transition-colors"
                >
                  Open Intel Brief →
                </button>
                <button
                  onClick={onClose}
                  className="w-full py-2 rounded-2xl text-slate-500 text-sm font-semibold hover:text-slate-700 transition-colors"
                >
                  Dismiss
                </button>
              </div>
            ) : (
              <button
                onClick={onClose}
                className="mt-5 w-full py-3 rounded-2xl bg-brand-600 hover:bg-brand-700 text-white font-bold transition-colors"
              >
                Got it ✓
              </button>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ── Stat mnemonic bottom-sheet ────────────────────────────────────────────
function StatMnemonicSheet({ stat, onClose }) {
  return (
    <AnimatePresence>
      {stat && (
        <>
          <motion.div
            key="sm-bg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-900/40"
            onClick={onClose}
          />
          <motion.div
            key="sm-sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="fixed bottom-0 inset-x-0 z-50 bg-surface rounded-t-3xl p-6 pb-10 max-w-lg mx-auto shadow-2xl"
          >
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-5" />

            <div className="flex items-start gap-3">
              <span className="text-3xl">💡</span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-brand-400 mb-1">{stat.label}</p>
                <p className="text-base font-bold text-slate-900 mb-3">{stat.value}</p>
                <p className="text-sm text-slate-600 leading-relaxed">{stat.mnemonic}</p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="mt-5 w-full py-3 rounded-2xl bg-brand-600 hover:bg-brand-700 text-white font-bold transition-colors"
            >
              Got it ✓
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ── Flashcard (final section) ─────────────────────────────────────────────
function FlashCard({ sectionIdx, total, title, subtitle, category, subcategory, text, keywords, learnedKws, onKeywordTap }) {
  return (
    <div className="rounded-2xl overflow-hidden border border-slate-300" style={{ background: 'var(--color-surface)' }}>
      {/* Header bar */}
      <div className="flex items-center justify-between px-5 pt-5 pb-4">
        <motion.div
          key={sectionIdx}
          initial={{ scale: 1.35, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.25 }}
          className="inline-flex items-center gap-2 bg-white/8 rounded-full px-3 py-1"
        >
          <span className="text-xs font-bold text-text-muted">{sectionIdx + 1} / {total}</span>
          <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-brand-400">Flashcard</span>
        </motion.div>
        <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-text-faint">Intel Brief</span>
      </div>

      {/* Clue — description as the context/question */}
      <div className="px-5 pb-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-text-faint mb-3">Context</p>
        <div className="text-text-muted text-sm leading-6 [&_p]:mb-2 [&_li]:text-text-muted [&_button]:border-white/20 [&_button]:text-text-muted [&_button]:bg-white/6 [&_button:hover]:bg-white/12">
          <SectionText text={text} keywords={keywords} learnedKws={learnedKws} onKeywordTap={onKeywordTap} />
        </div>
      </div>

      {/* Divider */}
      <div className="h-px mx-5" style={{ background: 'var(--color-slate-300)' }} />

      {/* Answer — title + classification revealed prominently */}
      <div className="px-5 py-5" style={{ background: 'var(--color-surface-raised)' }}>
        <h2 className="text-xl font-extrabold text-text leading-snug">{title}</h2>
        {subtitle && (
          <p className="text-sm text-text-muted mt-1 leading-snug">{subtitle}</p>
        )}
        {(category || subcategory) && (
          <p className="text-[10px] font-semibold text-text-faint mt-2 uppercase tracking-widest">
            {category}{subcategory ? ` · ${subcategory}` : ''}
          </p>
        )}
      </div>
    </div>
  )
}

// ── Section card (image zone + stat + text) ───────────────────────────────
function SectionCard({ imageZone, stat, sectionIdx, total, isLast, tutorialActive, highlightedBaseNames, mapOpen, setMapOpen, centreOn, title, subtitle, category, subcategory, text, keywords, learnedKws, onKeywordTap, onStatTap }) {
  const hasBases = (highlightedBaseNames ?? []).length > 0

  if (isLast) {
    return (
      <FlashCard
        sectionIdx={sectionIdx}
        total={total}
        title={title}
        subtitle={subtitle}
        category={category}
        subcategory={subcategory}
        text={text}
        keywords={keywords}
        learnedKws={learnedKws}
        onKeywordTap={onKeywordTap}
      />
    )
  }

  return (
    <div className="rounded-2xl overflow-hidden border border-slate-200 bg-surface">
      {/* Image zone */}
      <div className="relative h-44 bg-slate-100 overflow-hidden">
        <img
          src={imageZone.src}
          alt={title}
          draggable={false}
          className={`w-full h-full object-cover select-none transition-all duration-300 ${hasBases && mapOpen ? 'opacity-20 blur-sm' : ''}`}
          style={{ objectPosition: imageZone.position }}
        />
        {hasBases && mapOpen && (
          <div
            className={`absolute inset-0${tutorialActive ? ' pointer-events-none' : ''}`}
            onPointerDownCapture={e => e.stopPropagation()}
          >
            <RafBasesMap mode="view" height="100%" highlightedBaseNames={highlightedBaseNames} centreOn={centreOn} />
          </div>
        )}
        {hasBases && !tutorialActive && (
          <button
            onClick={() => setMapOpen(o => !o)}
            className="absolute bottom-2 right-2 z-[1000] text-xs font-semibold px-2.5 py-1 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors backdrop-blur-sm"
          >
            {mapOpen ? 'Hide map' : 'View map'}
          </button>
        )}
        <motion.div
          key={sectionIdx}
          initial={{ scale: 1.35, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.25 }}
          className="absolute top-2 left-2 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1"
        >
          <span className="text-xs font-bold text-white">{sectionIdx + 1} / {total}</span>
        </motion.div>
      </div>

      {/* Stat row */}
      {stat && (
        stat.mnemonic ? (
          <button
            onClick={() => onStatTap?.(stat)}
            className="w-full flex items-baseline justify-between gap-4 px-5 py-2.5 border-b border-slate-100 bg-slate-50/50 hover:bg-brand-50/50 transition-colors text-left"
          >
            <span className="text-[10px] font-bold uppercase tracking-widest text-brand-400 shrink-0">{stat.label}</span>
            <span className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-text text-right">{stat.value}</span>
              <span className="text-base leading-none">💡</span>
            </span>
          </button>
        ) : (
          <div className="flex items-baseline justify-between gap-4 px-5 py-2.5 border-b border-slate-100 bg-slate-50/50">
            <span className="text-[10px] font-bold uppercase tracking-widest text-brand-400 shrink-0">{stat.label}</span>
            <span className="text-sm font-semibold text-text text-right">{stat.value}</span>
          </div>
        )
      )}

      <div className="p-5">
        <SectionText text={text} keywords={keywords} learnedKws={learnedKws} onKeywordTap={onKeywordTap} />
      </div>
    </div>
  )
}

// ── Swipe wrapper (Tinder-style drag) ─────────────────────────────────────
function SwipeCard({ navDir, canGoBack, onSwipeLeft, onSwipeRight, onFirstSwipe, showTutorial, children }) {
  const controls    = useAnimationControls()
  const x           = useMotionValue(0)
  const rotate      = useTransform(x, [-200, 200], [-8, 8])
  const isSwipingRef = useRef(false)

  useEffect(() => {
    x.set(navDir * 120)
    controls.start({ x: 0, opacity: 1, transition: { type: 'spring', stiffness: 280, damping: 26 } })
  }, []) // fires on mount — remounted via key on each section change

  // Tutorial idle oscillation — animate the real card so the user sees what to do
  useEffect(() => {
    if (showTutorial) {
      const timer = setTimeout(() => {
        controls.start({
          x: [0, -44, 0, 44, 0],
          rotate: [0, -5, 0, 5, 0],
          transition: { repeat: Infinity, duration: 2.4, ease: 'easeInOut' },
        })
      }, 600)
      return () => clearTimeout(timer)
    } else if (!isSwipingRef.current) {
      // Dismissed via tap — snap card back to rest; if swiping, let fly-off run uninterrupted
      controls.start({ x: 0, rotate: 0, transition: { type: 'spring', stiffness: 350, damping: 28 } })
    }
  }, [showTutorial]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleDragEnd(_, info) {
    isSwipingRef.current = true
    onFirstSwipe?.()
    const swipeLeft  = info.offset.x < -80 || info.velocity.x < -500
    const swipeRight = info.offset.x > 80  || info.velocity.x > 500
    if (swipeLeft) {
      await controls.start({ x: -(window.innerWidth + 100), rotate: -12, opacity: 0, transition: { duration: 0.22, ease: 'easeIn' } })
      onSwipeLeft()
    } else if (swipeRight && canGoBack) {
      await controls.start({ x: window.innerWidth + 100, rotate: 12, opacity: 0, transition: { duration: 0.22, ease: 'easeIn' } })
      onSwipeRight()
    } else {
      controls.start({ x: 0, rotate: 0, opacity: 1, transition: { type: 'spring', stiffness: 350, damping: 28 } })
    }
    isSwipingRef.current = false
  }

  return (
    <motion.div
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.6}
      style={{ x, rotate }}
      animate={controls}
      initial={{ opacity: 0 }}
      onDragEnd={handleDragEnd}
      className="cursor-grab active:cursor-grabbing touch-pan-y select-none"
    >
      {children}
    </motion.div>
  )
}

// ── First-visit swipe tutorial ────────────────────────────────────────────
function SwipeTutorial({ onDismiss }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-[1100] flex flex-col items-end justify-end pb-5 px-4 rounded-2xl pointer-events-none"
    >
      <motion.div
        animate={{ opacity: [1, 0.35, 1] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
        className="pointer-events-auto mx-auto bg-black/60 rounded-full px-5 py-2 flex items-center gap-2 cursor-pointer select-none"
        onClick={onDismiss}
      >
        <span className="text-white text-sm font-semibold">← Swipe to navigate →</span>
        <span className="text-white/50 text-xs">tap to dismiss</span>
      </motion.div>
    </motion.div>
  )
}

// ── Render one section with highlighted keywords ──────────────────────────
function parseSectionBlocks(text) {
  const raw = []
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    if (/^[-*•]\s+/.test(t)) {
      raw.push({ type: 'bullet', content: t.replace(/^[-*•]\s+/, '') })
    } else if (/^\d+\.\s+/.test(t)) {
      raw.push({ type: 'numbered', content: t.replace(/^\d+\.\s+/, '') })
    } else if (raw.length && raw[raw.length - 1].type === 'p') {
      raw[raw.length - 1].content += ' ' + t
    } else {
      raw.push({ type: 'p', content: t })
    }
  }
  // Group consecutive list items into list blocks
  const blocks = []
  for (const item of raw) {
    if (item.type === 'bullet') {
      if (blocks.length && blocks[blocks.length - 1].type === 'ul')
        blocks[blocks.length - 1].items.push(item.content)
      else
        blocks.push({ type: 'ul', items: [item.content] })
    } else if (item.type === 'numbered') {
      if (blocks.length && blocks[blocks.length - 1].type === 'ol')
        blocks[blocks.length - 1].items.push(item.content)
      else
        blocks.push({ type: 'ol', items: [item.content] })
    } else {
      blocks.push({ type: 'p', content: item.content })
    }
  }
  return blocks.length ? blocks : [{ type: 'p', content: text }]
}

function SectionText({ text, keywords, learnedKws, onKeywordTap }) {
  if (!text) return null

  const sorted  = keywords?.length ? [...keywords].sort((a, b) => b.keyword.length - a.keyword.length) : []
  const pattern = sorted.length
    ? new RegExp(`(?<![a-zA-Z0-9])(${sorted.map(k => k.keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![a-zA-Z0-9])`, 'gi')
    : null

  function segmentize(str) {
    if (!pattern) return [{ type: 'text', content: str }]
    const segs = []
    let last = 0
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(str)) !== null) {
      if (match.index > last) segs.push({ type: 'text', content: str.slice(last, match.index) })
      const kw = sorted.find(k => k.keyword.toLowerCase() === match[1].toLowerCase())
      segs.push({ type: 'keyword', content: match[1], keyword: kw })
      last = match.index + match[1].length
    }
    if (last < str.length) segs.push({ type: 'text', content: str.slice(last) })
    return segs
  }

  function renderSegs(segs) {
    return segs.map((seg, i) => {
      if (seg.type === 'text') return <span key={i}>{seg.content}</span>
      const learned = learnedKws.has(seg.keyword?.keyword?.toLowerCase())
      const linked  = !!seg.keyword?.linkedBriefId
      return (
        <button
          key={i}
          onClick={() => onKeywordTap(seg.keyword)}
          className={`inline rounded px-0.5 -mx-0.5 font-semibold transition-all
            border-b-2 focus:outline-none cursor-pointer
            ${learned
              ? 'text-emerald-700/70 border-emerald-300/60 bg-emerald-50/30'
              : linked
                ? 'text-amber-600/60 border-amber-200/40 bg-amber-50/20 hover:bg-amber-50/35 hover:border-amber-200/50'
                : 'text-brand-700 border-brand-300/70 bg-brand-50/50 hover:bg-brand-50/80 hover:border-brand-300'
            }`}
        >
          {seg.content}
        </button>
      )
    })
  }

  const blocks = parseSectionBlocks(text)

  return (
    <div className="space-y-3 text-base leading-8 text-slate-700">
      {blocks.map((block, bi) => {
        if (block.type === 'ul') return (
          <ul key={bi} className="list-disc list-outside pl-5 space-y-1">
            {block.items.map((item, ii) => <li key={ii}>{renderSegs(segmentize(item))}</li>)}
          </ul>
        )
        if (block.type === 'ol') return (
          <ol key={bi} className="list-decimal list-outside pl-5 space-y-1">
            {block.items.map((item, ii) => <li key={ii}>{renderSegs(segmentize(item))}</li>)}
          </ol>
        )
        return <p key={bi}>{renderSegs(segmentize(block.content))}</p>
      })}
    </div>
  )
}

// ── Stats panel (above brief content) ────────────────────────────────────
function StatRow({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 border-b border-brand-100 last:border-0">
      <span className="text-[10px] font-bold uppercase tracking-widest text-brand-400 shrink-0">{label}</span>
      <span className="text-sm font-semibold text-text text-right">{value}</span>
    </div>
  )
}

function buildStats(brief) {
  const gd  = brief.gameData ?? {}
  const mn  = brief.mnemonics ?? {}
  const cat = brief.category
  const mk  = (statKey, label, value) => ({ statKey, label, value, mnemonic: mn[statKey] || null })
  const stats = []
  if (cat === 'Aircrafts') {
    if (gd.topSpeedKph != null)
      stats.push(mk('topSpeedKph',    'Top Speed',  `${gd.topSpeedKph.toLocaleString()} km/h · ${Math.round(gd.topSpeedKph * 0.621).toLocaleString()} mph`))
    if (gd.yearIntroduced != null)
      stats.push(mk('yearIntroduced', 'Introduced', String(gd.yearIntroduced)))
    if (gd.yearIntroduced != null)
      stats.push(mk('status',         'Status',     gd.yearRetired != null ? `Retired ${gd.yearRetired}` : 'In Service'))
  } else if (cat === 'Ranks') {
    if (gd.rankHierarchyOrder != null)
      stats.push(mk('rankHierarchyOrder', 'Seniority', `#${gd.rankHierarchyOrder}${gd.rankHierarchyOrder === 1 ? ' — Most Senior' : ''}`))
  } else if (cat === 'Training') {
    if (gd.trainingWeekStart != null && gd.trainingWeekEnd != null)
      stats.push(mk('pipelinePosition', 'Pipeline Position', `Week ${gd.trainingWeekStart} – Week ${gd.trainingWeekEnd}`))
    if (gd.weeksOfTraining != null)
      stats.push(mk('trainingDuration', 'Duration', `${gd.weeksOfTraining} week${gd.weeksOfTraining === 1 ? '' : 's'}`))
  } else if (['Missions', 'Tech', 'Treaties'].includes(cat)) {
    if (gd.startYear != null)
      stats.push(mk('period', 'Period', `${gd.startYear} – ${gd.endYear != null ? gd.endYear : 'Present'}`))
  } else if (['Bases', 'Squadrons', 'Threats'].includes(cat)) {
    const L = {
      Bases:     { start: 'Opened',     active: 'Active',     closed: 'Closed'    },
      Squadrons: { start: 'Formed',     active: 'Active',     closed: 'Disbanded' },
      Threats:   { start: 'Introduced', active: 'In Service', closed: 'Retired'   },
    }[cat]
    if (gd.startYear != null)
      stats.push(mk('startYear', L.start, String(gd.startYear)))
    if (gd.startYear != null)
      stats.push(mk('status', 'Status', gd.endYear != null ? `${L.closed} ${gd.endYear}` : L.active))
  }
  return stats
}

function buildSections(brief) {
  const cat         = brief.category
  const bases       = (brief.associatedBaseBriefIds     ?? []).filter(b => b?._id)
  const squadrons   = (brief.associatedSquadronBriefIds ?? []).filter(b => b?._id)
  const aircraft    = (brief.associatedAircraftBriefIds ?? []).filter(b => b?._id)
  const missions    = (brief.associatedMissionBriefIds  ?? []).filter(b => b?._id)
  const training    = (brief.associatedTrainingBriefIds ?? []).filter(b => b?._id)
  const related         = (brief.relatedBriefIds ?? []).filter(b => b?._id)
  const historicRelated = (brief.relatedHistoric ?? []).filter(b => b?._id)

  const sections = []
  if (['Aircrafts', 'Squadrons'].includes(cat) && bases.length > 0)
    sections.push({ label: `Home Base${bases.length > 1 ? 's' : ''}`, items: bases, isBasesSection: true })
  if (['Bases', 'Aircrafts'].includes(cat) && squadrons.length > 0)
    sections.push({ label: 'Squadrons', items: squadrons })
  if (['Bases', 'Squadrons', 'Tech'].includes(cat) && aircraft.length > 0)
    sections.push({ label: 'Aircraft', items: aircraft })
  if (['Aircrafts', 'Squadrons'].includes(cat) && missions.length > 0)
    sections.push({ label: 'Missions', items: missions })
  if (['Roles'].includes(cat) && training.length > 0)
    sections.push({ label: 'Training', items: training })
  if (related.length > 0)
    sections.push({ label: 'Related', items: related })
  if (['Bases', 'Squadrons', 'Missions', 'AOR'].includes(cat) && historicRelated.length > 0)
    sections.push({ label: 'Historic Intelligence', items: historicRelated, historic: true })
  return sections
}


function BriefPill({ b, navigate, onClick }) {
  const isStub = b.status === 'stub'
  return (
    <button
      onClick={onClick ?? (() => navigate(`/brief/${b._id}`))}
      className={`text-xs font-semibold px-2.5 py-1 rounded-full transition-all ${
        isStub
          ? 'bg-slate-200 text-slate-500 opacity-50 hover:opacity-70'
          : 'bg-brand-200 text-brand-700 hover:bg-brand-300 hover:text-brand-800'
      }`}
    >
      {isStub ? `🔒 ${b.title}` : b.title}
    </button>
  )
}

// ── Connections panel (below brief content) ───────────────────────────────
function BriefConnectionsPanel({ brief, navigate, autoExpand, onBasePillClick }) {
  const sections = buildSections(brief)
  const [openSections, setOpenSections] = useState({})

  // Auto-expand all sections after the panel has animated into place
  useEffect(() => {
    if (!autoExpand) return
    const t = setTimeout(() => {
      const all = {}
      sections.forEach(s => { all[s.label] = true })
      setOpenSections(all)
    }, 420)
    return () => clearTimeout(t)
  }, [autoExpand]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSection = label => setOpenSections(s => ({ ...s, [label]: !s[label] }))

  if (sections.length === 0) return null

  return (
    <div className="border border-brand-200 rounded-2xl overflow-hidden mb-5">
      <div className="px-4 py-2.5 bg-surface-raised border-b border-brand-200">
        <span className="text-[10px] font-bold uppercase tracking-widest text-brand-400">Connections</span>
      </div>
      {sections.map((sec, i) => {
        const isOpen = !!openSections[sec.label]
        return (
          <div key={sec.label} className={i > 0 ? 'border-t border-brand-100' : ''}>
            <button
              onClick={() => toggleSection(sec.label)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-brand-50 transition-colors text-left"
            >
              <span className={`text-[10px] font-bold uppercase tracking-widest ${sec.historic ? 'text-amber-500' : 'text-brand-500'}`}>
                {sec.label}
                {sec.items.length > 0 && (
                  <span className="ml-1.5 font-normal text-brand-300 normal-case tracking-normal text-[10px]">
                    ({sec.items.length})
                  </span>
                )}
              </span>
              <span className="text-brand-300 text-sm leading-none">{isOpen ? '−' : '+'}</span>
            </button>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  key="content"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: 'easeInOut' }}
                  style={{ overflow: 'hidden' }}
                >
                  <div className="px-4 pb-3">
                    <div className="flex flex-wrap gap-1.5">
                      {sec.items.map(b => (
                        <BriefPill
                          key={b._id}
                          b={b}
                          navigate={navigate}
                          onClick={sec.isBasesSection && onBasePillClick
                            ? () => onBasePillClick(b.title)
                            : undefined}
                        />
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )
      })}
    </div>
  )
}

// ── Continue Learning cards ───────────────────────────────────────────────
function ContinueLearning({ brief, navigate, fallbackCards }) {
  const seen = new Set()
  const cards = [
    ...(brief.associatedBaseBriefIds     ?? []),
    ...(brief.associatedSquadronBriefIds ?? []),
    ...(brief.associatedAircraftBriefIds ?? []),
    ...(brief.associatedMissionBriefIds  ?? []),
    ...(brief.associatedTrainingBriefIds ?? []),
    ...(brief.relatedBriefIds            ?? []),
  ]
    .filter(b => b?._id && !seen.has(String(b._id)) && seen.add(String(b._id)))
    .sort((a, b) => (a.status === 'stub' ? 1 : 0) - (b.status === 'stub' ? 1 : 0))
    .slice(0, 5)

  const displayCards = cards.length > 0 ? cards : (fallbackCards ?? [])

  if (displayCards.length === 0) return null

  return (
    <div className="bg-surface rounded-2xl p-4 border border-slate-200 mb-6 card-shadow">
      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
        📡 Continue Learning
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {displayCards.map(b => (
          <button
            key={b._id}
            onClick={() => navigate(`/brief/${b._id}`)}
            className="shrink-0 flex flex-col gap-1 p-3 rounded-xl border border-slate-200 hover:border-brand-300 hover:bg-brand-50 transition-all text-left w-36"
          >
            <span className="text-[10px] font-bold text-brand-600 uppercase tracking-wide">
              {b.category}
            </span>
            <span className={`text-xs font-semibold leading-tight ${b.status === 'stub' ? 'text-slate-400' : 'text-slate-700'}`}>
              {b.status === 'stub' ? `🔒 ${b.title}` : b.title}
            </span>
            {b.status === 'stub' && (
              <span className="text-[10px] text-slate-400 font-medium">Coming soon</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Completion screen ─────────────────────────────────────────────────────
function CompletionScreen({ brief, onQuiz, booState, onBattleOrder, onBack, onReRead, user, isFirstCompletion, coinReward, navigate, quizPassed, quizAvailable }) {
  const { API, setUser, awardAircoins } = useAuth()
  const [email, setEmail]             = useState('')
  const [showEmailInput, setShowEmailInput] = useState(false)
  const googleBtnRef                  = useRef(null)

  // Google One Tap + inline button — guests only
  useEffect(() => {
    if (user) return
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
    if (!clientId || !window.google) return

    const handleCredential = async (response) => {
      try {
        // 1. Authenticate
        const authRes  = await fetch(`${API}/api/auth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ credential: response.credential }),
        })
        const authData = await authRes.json()
        if (!authData?.data?.user) return
        setUser(authData.data.user)

        // 2. Complete the brief now that we're authenticated — cookie is set by the auth response above
        const completeRes  = await fetch(`${API}/api/briefs/${brief._id}/complete`, {
          method: 'POST', credentials: 'include',
        })
        const completeData = await completeRes.json()

        // 3. Award coins directly — no navigation needed, we're already on the completion screen
        if (completeRes.ok && completeData?.data) {
          const d     = completeData.data
          const total = (d.aircoinsEarned ?? 0) + (d.dailyCoinsEarned ?? 0)
          if (total > 0) {
            awardAircoins(total, d.dailyCoinsEarned > 0 ? 'Daily Brief' : 'Brief read', {
              cycleAfter:    d.newCycleAircoins,
              totalAfter:    d.newTotalAircoins,
              rankPromotion: d.rankPromotion ?? null,
            })
          }
        }
      } catch { /* ignore */ }
    }

    window.google.accounts.id.initialize({ client_id: clientId, callback: handleCredential })
    window.google.accounts.id.prompt() // One Tap overlay
    if (googleBtnRef.current) {
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        theme: 'outline', size: 'large', text: 'signup_with', width: 280, logo_alignment: 'center',
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleEmailContinue() {
    localStorage.setItem('sw_pending_brief', brief._id)
    navigate(`/login?tab=register&pendingBrief=${brief._id}${email ? `&email=${encodeURIComponent(email)}` : ''}`)
  }

  const heading    = isFirstCompletion && user ? 'First Brief — Mission Complete' : 'Brief Complete'
  const subheading = isFirstCompletion && user
    ? 'Your first intel brief is done. Now test what you\'ve learned.'
    : 'You\'ve read all sections of this brief.'

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="text-center py-8"
    >
      {/* Badge icon */}
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', damping: 14, delay: 0.1 }}
        className="flex justify-center mb-4"
      >
        <svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="28" cy="28" r="27" stroke="#1d4ed8" strokeWidth="2" fill="#eff6ff" />
          <circle cx="28" cy="28" r="20" stroke="#1d4ed8" strokeWidth="1" strokeDasharray="3 3" fill="none" />
          <line x1="28" y1="8" x2="28" y2="13" stroke="#1d4ed8" strokeWidth="2" strokeLinecap="round" />
          <line x1="28" y1="43" x2="28" y2="48" stroke="#1d4ed8" strokeWidth="2" strokeLinecap="round" />
          <line x1="8" y1="28" x2="13" y2="28" stroke="#1d4ed8" strokeWidth="2" strokeLinecap="round" />
          <line x1="43" y1="28" x2="48" y2="28" stroke="#1d4ed8" strokeWidth="2" strokeLinecap="round" />
          <polyline points="21,28 26,33 35,22" stroke="#1d4ed8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </motion.div>

      <h2 className="text-2xl font-extrabold text-slate-900 mb-2">{heading}</h2>
      <p className="text-slate-500 mb-8">{subheading}</p>

      <div className="space-y-3">
        {user ? (
          <>
            {/* Primary: Quiz */}
            {quizAvailable ? (
              <button
                onClick={onQuiz}
                className="w-full py-4 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-2xl text-lg transition-colors shadow-lg shadow-brand-200"
              >
                🧠 {quizPassed ? 'Retake Quiz' : 'Take the Quiz → Earn Aircoins'}
              </button>
            ) : (
              <div className="quiz-unavailable-block">
                <div className="quiz-unavailable-btn" aria-disabled="true">
                  🧠 Quiz Locked
                </div>
                <p className="quiz-unavailable-msg">
                  Intel is still being compiled for this quiz — check back soon.
                </p>
              </div>
            )}

            {/* Secondary: Battle of Order */}
            {booState === 'available' && (
              <button
                onClick={onBattleOrder}
                className="w-full py-3.5 border-2 border-brand-600 text-brand-600 hover:bg-brand-600 hover:text-white font-bold rounded-2xl text-base transition-colors"
              >
                🗺️ Battle of Order — Earn Aircoins
              </button>
            )}
            {booState === 'completed' && (
              <button
                onClick={onBattleOrder}
                className="w-full py-3.5 border-2 border-brand-600 text-brand-600 hover:bg-brand-600 hover:text-white font-bold rounded-2xl text-base transition-colors"
              >
                🗺️ Replay Battle of Order
              </button>
            )}
            {booState === 'locked-quiz' && (
              <div className="w-full py-3 border border-dashed border-slate-200 text-slate-400 font-semibold rounded-2xl text-sm flex items-center justify-center gap-2">
                <span>🗺️ Battle of Order</span>
                <span className="text-xs bg-slate-100 px-2 py-0.5 rounded-full">
                  {quizAvailable ? '🔒 Pass the quiz first' : '🔒 Intel Pending'}
                </span>
              </div>
            )}

            {/* Continue Learning — shown when quiz passed and BOO is done or unavailable */}
            {quizPassed && (booState === 'completed' || booState === 'unavailable' || booState === 'no-game-data') && (
              <ContinueLearning brief={brief} navigate={navigate} />
            )}
          </>
        ) : (
          <>
            {/* Coin hook */}
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 text-left flex items-center gap-3 coin-hook-pulse">
              <span className="text-xl shrink-0">⭐</span>
              <div>
                <p className="text-sm font-bold text-amber-800">{coinReward} Aircoins waiting to be claimed</p>
                <p className="text-xs text-amber-700">Sign up to collect your reward and track your streak</p>
              </div>
            </div>

            {/* Google button */}
            <div ref={googleBtnRef} className="flex justify-center" />
            {!import.meta.env.VITE_GOOGLE_CLIENT_ID && (
              <p className="text-xs text-slate-400 text-center">Google sign-in unavailable</p>
            )}

            {/* Email — collapsed by default */}
            {showEmailInput ? (
              <div className="flex gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleEmailContinue() }}
                  placeholder="your@email.com"
                  autoFocus
                  className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none text-sm"
                />
                <button
                  onClick={handleEmailContinue}
                  className="px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors"
                >
                  Continue →
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowEmailInput(true)}
                className="w-full py-2.5 text-sm text-slate-500 hover:text-slate-700 transition-colors"
              >
                or continue with email →
              </button>
            )}

            <p className="text-xs text-slate-400">
              Already have an account?{' '}
              <button
                onClick={() => { localStorage.setItem('sw_pending_brief', brief._id); navigate(`/login?tab=signin&pendingBrief=${brief._id}`) }}
                className="text-brand-600 font-semibold hover:underline"
              >
                Sign in
              </button>
            </p>
          </>
        )}

        {/* Tertiary actions */}
        <button
          onClick={onReRead}
          className="w-full py-2.5 text-sm text-slate-500 hover:text-slate-700 font-medium transition-colors border border-slate-200 rounded-2xl hover:bg-slate-50"
        >
          ↩ Re-read Brief
        </button>
      </div>
    </motion.div>
  )
}

// ── Already-read screen ──────────────────────────────────────────────────
const BOO_CATS = ['Aircrafts', 'Ranks', 'Training', 'Missions', 'Tech', 'Treaties', 'Bases']

function AlreadyReadScreen({ brief, quizPassed, booState, onReRead, navigate, quizAvailable }) {
  const showBoo    = BOO_CATS.includes(brief.category)
  const booVisible = showBoo && booState !== 'unavailable' && booState !== 'no-game-data'

  return (
    <div>
      {/* Back */}
      <button
        onClick={() => navigate(`/learn/${encodeURIComponent(brief.category)}`)}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-5 transition-colors"
      >
        ← {brief.category}
      </button>

      {/* Brief header */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-bold bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full border border-brand-200">
            {brief.category}
          </span>
          {brief.subcategory && (
            <span className="text-xs text-slate-400 font-medium">{brief.subcategory}</span>
          )}
        </div>
        <h1 className="text-2xl font-extrabold text-slate-900 leading-tight">{brief.title}</h1>
        {brief.nickname && (
          <p className="text-sm text-slate-400 italic mt-0.5">"{brief.nickname}"</p>
        )}
        {brief.subtitle && (
          <p className="text-sm text-slate-500 mt-1.5">{brief.subtitle}</p>
        )}
      </div>

      {/* Read badge / re-read */}
      <button
        onClick={onReRead}
        className="w-full flex items-center gap-2.5 bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3 mb-6 hover:bg-emerald-100 hover:border-emerald-300 transition-colors text-left cursor-pointer"
      >
        <span className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
          <span className="text-white text-xs font-bold">✓</span>
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-emerald-800">Intel brief classified as read</p>
          <p className="text-xs text-emerald-600">You've completed this brief before</p>
        </div>
        <span className="text-xs font-semibold text-emerald-700 shrink-0">↩ Re-read →</span>
      </button>

      {/* Game cards */}
      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Test your knowledge</p>
      <div className="space-y-3 mb-6">

        {/* Quiz card */}
        {quizPassed === null ? (
          <div className="h-20 bg-slate-100 rounded-2xl animate-pulse" />
        ) : !quizAvailable ? (
          <div className="flex items-center gap-4 p-4 rounded-2xl border border-slate-100 bg-slate-50 opacity-60">
            <div className="w-11 h-11 rounded-xl bg-slate-200 flex items-center justify-center shrink-0 text-xl">
              🧠
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm text-slate-500">Intel Quiz</p>
              <p className="text-xs text-slate-400 mt-0.5">Still compiling intel for this quiz</p>
            </div>
            <span className="text-xs font-semibold text-slate-400 shrink-0">🔒 Intel Pending</span>
          </div>
        ) : (
          <button
            onClick={() => navigate(`/quiz/${brief._id}`)}
            className={`w-full text-left flex items-center gap-4 p-4 rounded-2xl border transition-all group cursor-pointer
              ${quizPassed
                ? 'bg-emerald-50 border-emerald-200 hover:border-emerald-300'
                : 'bg-surface border-slate-200 hover:border-brand-300 hover:bg-brand-50 card-shadow hover:card-shadow-hover'
              }`}
          >
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 text-xl
              ${quizPassed ? 'bg-emerald-100' : 'bg-brand-100'}`}
            >
              🧠
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm text-slate-800">Intel Quiz</p>
              <p className={`text-xs mt-0.5 ${quizPassed ? 'text-emerald-600' : 'text-slate-400'}`}>
                {quizPassed ? '✓ Passed' : 'Test your understanding of this brief'}
              </p>
            </div>
            <span className={`text-sm font-bold shrink-0 ${quizPassed ? 'text-emerald-600' : 'text-brand-600 group-hover:text-brand-700'}`}>
              {quizPassed ? 'Replay →' : 'Take Quiz →'}
            </span>
          </button>
        )}

        {/* BOO card */}
        {booVisible && quizPassed !== null && (
          booState === 'completed' ? (
            <button
              onClick={() => navigate(`/battle-of-order/${brief._id}`)}
              className="w-full text-left flex items-center gap-4 p-4 rounded-2xl border bg-emerald-50 border-emerald-200 hover:border-emerald-300 transition-all group cursor-pointer"
            >
              <div className="w-11 h-11 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0 text-xl">
                🗺️
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm text-slate-800">Battle of Order</p>
                <p className="text-xs text-emerald-600 mt-0.5">✓ Completed</p>
              </div>
              <span className="text-sm font-bold text-emerald-600 shrink-0">Replay →</span>
            </button>
          ) : booState === 'available' ? (
            <button
              onClick={() => navigate(`/battle-of-order/${brief._id}`)}
              className="w-full text-left flex items-center gap-4 p-4 rounded-2xl border bg-surface border-slate-200 hover:border-brand-300 hover:bg-brand-50 transition-all group card-shadow hover:card-shadow-hover cursor-pointer"
            >
              <div className="w-11 h-11 rounded-xl bg-brand-100 flex items-center justify-center shrink-0 text-xl">
                🗺️
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm text-slate-800">Battle of Order</p>
                <p className="text-xs text-slate-400 mt-0.5">Rank and order {brief.category.toLowerCase()} by performance data</p>
              </div>
              <span className="text-sm font-bold text-brand-600 group-hover:text-brand-700 shrink-0">Play →</span>
            </button>
          ) : (
            <div className="flex items-center gap-4 p-4 rounded-2xl border border-slate-100 bg-slate-50 opacity-60">
              <div className="w-11 h-11 rounded-xl bg-slate-200 flex items-center justify-center shrink-0 text-xl">
                🗺️
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm text-slate-500">Battle of Order</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {booState === 'locked-aircraft-reads'
                    ? 'Read more Aircrafts briefs to unlock'
                    : booState === 'locked-bases-reads'
                    ? 'Read more Bases briefs to unlock'
                    : 'Pass the quiz to unlock'
                  }
                </p>
              </div>
              <span className="text-xs font-semibold text-slate-400 shrink-0">🔒 Locked</span>
            </div>
          )
        )}
      </div>

      {/* Continue Learning */}
      <ContinueLearning brief={brief} navigate={navigate} />

    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────
export default function BriefReader() {
  const { briefId }    = useParams()
  const navigate       = useNavigate()
  const { user, API, awardAircoins, setUser } = useAuth()
  const { start, visible } = useAppTutorial()
  const startRef = useRef(start)
  useEffect(() => { startRef.current = start }, [start])
  const { settings }            = useAppSettings()
  const [brief, setBrief]         = useState(null)
  const [mentionedBriefs, setMentionedBriefs] = useState([])
  const [loading, setLoading]   = useState(true)
  const [locked, setLocked]     = useState(false)
  const [lockedCategory, setLockedCategory] = useState(null)
  const [sectionIdx, setSection] = useState(() => {
    const saved = sessionStorage.getItem(`sw_brief_sec_${briefId}`)
    return saved ? parseInt(saved, 10) : 0
  })
  const [isFirstCompletion, setIsFirstCompletion] = useState(false)
  const [done, setDone]          = useState(
    () => sessionStorage.getItem('sw_brief_just_completed') === briefId
  )
  const [activeKw, setActiveKw]     = useState(null)
  const [activeStat, setActiveStat] = useState(null)
  const [learnedKws, setLearned]    = useState(new Set())
  const [readRecord, setReadRecord] = useState(null)
  // 'unavailable' | 'no-game-data' | 'locked-aircraft-reads' | 'locked-bases-reads' | 'locked-quiz' | 'available' | 'completed'
  const [booState, setBooState]   = useState('unavailable')
  const [quizPassed, setQuizPassed] = useState(null) // null=loading, true/false once fetched
  const [reReadMode, setReReadMode] = useState(false)
  const [missionData,       setMissionData]       = useState(null)  // spawn-check result when spawn: true
  const [spawnCheckPending, setSpawnCheckPending] = useState(false) // true while spawn-check is in-flight
  const [wtaSpawn,          setWtaSpawn]          = useState(null)  // { remaining, prereqsMet } from API
  const [navDir, setNavDir]        = useState(1) // 1 = forward, -1 = backward
  const [showTutorial, setShowTutorial] = useState(false)
  const [hasSwiped, setHasSwiped]       = useState(false)
  const [mapOpen, setMapOpen]           = useState(false)
  const [mapCentreOn, setMapCentreOn]   = useState(null)
  const [randomBriefs, setRandomBriefs] = useState([])
  const [startedAtZero] = useState(() => {
    const saved = sessionStorage.getItem(`sw_brief_sec_${briefId}`)
    return !saved || Number(saved) === 0
  })
  const [topFaded, setTopFaded] = useState(!startedAtZero)
  const markingRef                 = useRef(false)
  const contentRef                 = useRef(null)
  const briefOpenedRef             = useRef(false)
  const accSecondsRef              = useRef(0)
  const lastTickRef                = useRef(null)
  const prevVisibleRef             = useRef(false)

  // Quiz availability — true when the user's difficulty pool has ≥5 questions
  const MIN_QUIZ_QUESTIONS = 5
  const quizAvailable = brief
    ? (user?.difficultySetting === 'medium'
        ? (brief.quizQuestionsMedium?.length ?? 0) >= MIN_QUIZ_QUESTIONS
        : (brief.quizQuestionsEasy?.length   ?? 0) >= MIN_QUIZ_QUESTIONS)
    : false

  // Layer 2 safety net: if user navigated away before spawn modal appeared, restore it
  useEffect(() => {
    const pending = localStorage.getItem('pendingWtaGame')
    if (pending) {
      try { setMissionData(JSON.parse(pending)) } catch { localStorage.removeItem('pendingWtaGame') }
    }
  }, [])

  const BOO_CATEGORIES = BOO_CATS

  // Reset map and map centre when section changes
  useEffect(() => { setMapOpen(false); setMapCentreOn(null) }, [sectionIdx])

  // Trigger top-chrome fade on section-1 entry
  useEffect(() => {
    if (!startedAtZero) return
    const t = setTimeout(() => setTopFaded(true), 600)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Flush accumulated read time to the server
  const flushTime = useCallback(() => {
    const secs = Math.round(accSecondsRef.current)
    if (!user || secs < 1 || !brief) return
    accSecondsRef.current = 0
    fetch(`${API}/api/briefs/${briefId}/time`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seconds: secs }),
    }).catch(() => {})
  }, [user, brief, briefId, API])

  // Accumulate read time while the user is on the page reading
  useEffect(() => {
    if (!user || loading || !brief || done || brief.status === 'stub') return

    lastTickRef.current   = Date.now()
    accSecondsRef.current = 0

    const tick = () => {
      if (document.hidden) return
      const now   = Date.now()
      const delta = (now - (lastTickRef.current ?? now)) / 1000
      lastTickRef.current = now
      // Ignore gaps > 2 min (tab suspended / device slept)
      if (delta > 0 && delta < 120) accSecondsRef.current += delta
    }

    const interval = setInterval(() => { tick(); flushTime() }, 10_000)

    const onVisibility = () => {
      if (document.hidden) { tick(); flushTime() }
      else lastTickRef.current = Date.now()
    }

    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
      tick()
      flushTime()
    }
  }, [user, loading, brief, done, flushTime])

  useEffect(() => {
    fetch(`${API}/api/briefs/${briefId}`, { credentials: 'include' })
      .then(r => {
        if (r.status === 403) {
          r.json().then(d => setLockedCategory(d?.category ?? null)).catch(() => {})
          setLocked(true); return null
        }
        return r.json()
      })
      .then(data => {
        if (data?.data?.brief) {
          const b = data.data.brief
          setBrief(b)
          if (b.status === 'stub') {
            fetch(`${API}/api/briefs/random-sample?count=5&exclude=${b._id}`, { credentials: 'include' })
              .then(r => r.json())
              .then(d => { if (d?.data) setRandomBriefs(d.data) })
              .catch(() => {})
          }
        }
        if (data?.data?.readRecord) setReadRecord(data.data.readRecord)
        if (data?.data?.mentionedBriefs) setMentionedBriefs(data.data.mentionedBriefs)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [briefId, API])

  // Fetch WTA spawn status whenever brief or user resolves — handles mobile where auth loads after brief
  useEffect(() => {
    if (!brief || brief.category !== 'Aircrafts' || !user) return
    fetch(`${API}/api/users/me/wta-spawn`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d?.data) setWtaSpawn(d.data) })
      .catch(() => {})
  }, [brief, user, API])

  // Clean up the sw_brief_just_completed signal after mount (kept out of the lazy
  // init to avoid render-phase side effects, which React can invoke multiple times)
  useEffect(() => {
    if (sessionStorage.getItem('sw_brief_just_completed') === briefId) {
      sessionStorage.removeItem('sw_brief_just_completed')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fire coin notification if we arrived here after a post-login brief completion.
  // Depends on [user] so it waits until auth resolves — prevents stale sessionStorage
  // from triggering a phantom notification when a logged-out user visits a brief.
  useEffect(() => {
    if (!user) return
    const raw = sessionStorage.getItem('sw_brief_coins')
    if (!raw) return
    sessionStorage.removeItem('sw_brief_coins')
    try {
      const d           = JSON.parse(raw)
      const briefCoins  = d.aircoinsEarned  ?? 0
      const dailyCoins  = d.dailyCoinsEarned ?? 0
      const totalEarned = briefCoins + dailyCoins
      if (totalEarned > 0) {
        awardAircoins(totalEarned, dailyCoins > 0 ? 'Daily Brief' : 'Brief read', {
          cycleAfter:    d.newCycleAircoins,
          totalAfter:    d.newTotalAircoins,
          rankPromotion: d.rankPromotion ?? null,
        })
      }
      if (d.loginStreak !== undefined) {
        setUser(u => u ? {
          ...u,
          loginStreak:    d.loginStreak,
          lastStreakDate: d.lastStreakDate ?? u.lastStreakDate,
        } : u)
      }
    } catch { /* malformed — skip */ }
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fallback: if user just logged in and this brief was the pending one, complete it
  // here rather than relying purely on the sessionStorage signal from consumePendingBrief
  useEffect(() => {
    if (!user || !brief) return
    const pendingId = localStorage.getItem('sw_pending_brief')
    if (!pendingId || pendingId !== String(brief._id)) return
    localStorage.removeItem('sw_pending_brief')
    fetch(`${API}/api/briefs/${brief._id}/complete`, { method: 'POST', credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (!data?.data) return
        const briefCoins  = data.data.aircoinsEarned  ?? 0
        const dailyCoins  = data.data.dailyCoinsEarned ?? 0
        const total = briefCoins + dailyCoins
        if (total > 0) {
          awardAircoins(total, dailyCoins > 0 ? 'Daily Brief' : 'Brief read', {
            cycleAfter:    data.data.newCycleAircoins,
            totalAfter:    data.data.newTotalAircoins,
            rankPromotion: data.data.rankPromotion ?? null,
          })
        }
        setDone(true)
      })
      .catch(() => {})
  }, [user, brief]) // eslint-disable-line react-hooks/exhaustive-deps

  // Check quiz status + BOO availability once the brief is completed (covers both
  // the fresh CompletionScreen and returning visits via the AlreadyReadScreen)
  useEffect(() => {
    if (!(done || readRecord?.completed) || !brief || !user) return
    let cancelled = false
    async function check() {
      try {
        const quizRes  = await fetch(`${API}/api/games/quiz/status/${briefId}`, { credentials: 'include' })
        const quizData = await quizRes.json()
        if (cancelled) return
        const passed = quizData.data?.hasCompleted ?? false
        setQuizPassed(passed)

        if (!BOO_CATEGORIES.includes(brief.category)) return
        const booRes  = await fetch(`${API}/api/games/battle-of-order/options?briefId=${briefId}`, { credentials: 'include' })
        const booData = await booRes.json()
        if (cancelled) return
        const booAvail = booData.data?.available ?? false
        if (!booAvail) {
          const reason = booData.data?.reason
          if      (reason === 'needs-aircraft-reads') setBooState('locked-aircraft-reads')
          else if (reason === 'needs-bases-reads')    setBooState('locked-bases-reads')
          else if (reason === 'quiz_not_passed')      setBooState('locked-quiz')
          else if (reason === 'insufficient_briefs')  setBooState('no-game-data')
          else                                        setBooState('unavailable')
          return
        }
        if (!passed) { setBooState('locked-quiz'); return }
        const statusRes  = await fetch(`${API}/api/games/battle-of-order/status/${briefId}`, { credentials: 'include' })
        const statusData = await statusRes.json()
        if (cancelled) return
        const booCompleted = statusData.data?.hasCompleted ?? false
        setBooState(booCompleted ? 'completed' : 'available')
      } catch { /* silently ignore */ }
    }
    check()
    return () => { cancelled = true }
  }, [done, readRecord?.completed, brief, user, briefId, API]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset the "opened" flag when the user enters re-read mode so the sound re-fires
  useEffect(() => {
    if (reReadMode) briefOpenedRef.current = false
  }, [reReadMode])

  // Tutorial on first visit (and on re-read entry)
  useEffect(() => {
    // Don't play while on the AlreadyReadScreen (completed brief, not yet in re-read mode)
    const onAlreadyReadScreen = readRecord?.completed && user && !reReadMode
    if (!loading && brief && !briefOpenedRef.current && !done && !onAlreadyReadScreen) {
      briefOpenedRef.current = true
      playSound('intel_brief_opened')
      const t = setTimeout(() => startRef.current('briefReader'), 800)
      return () => { clearTimeout(t); briefOpenedRef.current = false }
    }
  }, [loading, brief, readRecord, reReadMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Show the swipe mini-tutorial only AFTER the briefReader tutorial has played (or if already seen)
  useEffect(() => {
    const uid = user?._id
    const swipeKey = uid ? `sw_tut_v2_${uid}_swipe` : 'sw_tut_v2_anon_swipe'
    if (localStorage.getItem(swipeKey)) return
    const briefReaderAlreadySeen = !!(
      (uid && localStorage.getItem(`sw_tut_v2_${uid}_briefReader`)) ||
      localStorage.getItem('sw_tut_v2_anon_briefReader')
    )
    const mainTutJustClosed = prevVisibleRef.current && !visible
    if (!visible && (briefReaderAlreadySeen || mainTutJustClosed)) {
      setShowTutorial(true)
    }
    prevVisibleRef.current = visible
  }, [visible, user?._id]) // eslint-disable-line react-hooks/exhaustive-deps

  const sections = brief?.descriptionSections?.filter(Boolean) ?? []
  const total    = sections.length
  const isLast   = sectionIdx >= total - 1
  const topOpacity = isLast ? 1 : topFaded ? 0.3 : 1

  const markRead = useCallback(() => {
    if (markingRef.current || !user) return
    markingRef.current = true
  }, [briefId, user])

  const scrollToContentIfNeeded = () => {
    const el = contentRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.top < 0) {
      window.scrollTo({ top: window.scrollY + rect.top, behavior: 'smooth' })
    }
  }

  const handleGoBack = () => {
    if (sectionIdx <= 0) return
    setNavDir(-1)
    setSection(i => {
      const prev = i - 1
      sessionStorage.setItem(`sw_brief_sec_${briefId}`, String(prev))
      return prev
    })
    scrollToContentIfNeeded()
  }

  const handleContinue = () => {
    if (isLast) {
      const first = !localStorage.getItem('skywatch_first_brief')
      if (first) localStorage.setItem('skywatch_first_brief', '1')
      setIsFirstCompletion(first)
      if (!user) playSound('first_brief_complete')
      markRead()
      sessionStorage.removeItem(`sw_brief_sec_${briefId}`)
      setDone(true)
      // Award coins now that the user has finished reading
      if (user) {
        fetch(`${API}/api/briefs/${briefId}/complete`, {
          method: 'POST',
          credentials: 'include',
        })
          .then(r => r.json())
          .then(data => {
            const briefCoins = data?.data?.aircoinsEarned ?? 0
            const dailyCoins = data?.data?.dailyCoinsEarned ?? 0
            const totalEarned = briefCoins + dailyCoins
            if (totalEarned > 0) {
              awardAircoins(totalEarned, dailyCoins > 0 ? 'Daily Brief' : 'Brief read', {
                cycleAfter:    data.data.newCycleAircoins,
                totalAfter:    data.data.newTotalAircoins,
                rankPromotion: data.data.rankPromotion ?? null,
              })
            }
            if (data?.data?.loginStreak !== undefined) {
              setUser(u => u ? {
                ...u,
                loginStreak:    data.data.loginStreak,
                lastStreakDate: data.data.lastStreakDate ?? u.lastStreakDate,
              } : u)
            }
          })
          .then(() => {
            // Spawn-check for Where's That Aircraft (Aircrafts category only)
            if (brief?.category !== 'Aircrafts') return
            const willSpawn = wtaSpawn?.prereqsMet && wtaSpawn?.remaining === 1
            if (willSpawn) setSpawnCheckPending(true)
            fetch(`${API}/api/games/wheres-aircraft/spawn-check`, {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ briefId }),
            })
              .then(r => r.json())
              .then(d => {
                setSpawnCheckPending(false)
                if (d?.data?.spawn) {
                  const data = {
                    aircraftBriefId: d.data.aircraftBriefId,
                    aircraftTitle:   d.data.aircraftTitle,
                    mediaUrl:        d.data.mediaUrl,
                  }
                  localStorage.setItem('pendingWtaGame', JSON.stringify(data))
                  setMissionData(data)
                }
              })
              .catch(() => { setSpawnCheckPending(false) })
          })
          .catch(() => {})
      }
    } else {
      setNavDir(1)
      setSection(i => {
        const next = i + 1
        sessionStorage.setItem(`sw_brief_sec_${briefId}`, String(next))
        return next
      })
      scrollToContentIfNeeded()
    }
  }

  const handleKeywordTap = (kw) => {
    if (kw) playSound('target_locked_keyword')
    setActiveKw(kw)
    if (kw) setLearned(s => new Set([...s, kw.keyword.toLowerCase()]))
  }

  const handleStatTap = (stat) => {
    if (!stat?.mnemonic) return
    setActiveStat(stat)
    if (user && brief?._id) {
      fetch(`${API}/api/briefs/${brief._id}/mnemonic-viewed`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statKey: stat.statKey }),
      }).catch(() => {})
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-6 bg-slate-200 rounded-xl w-1/2" />
        <div className="h-4 bg-slate-100 rounded w-3/4" />
        <div className="h-32 bg-slate-100 rounded-2xl" />
      </div>
    )
  }

  if (locked) {
    return (
      <>
        <button
          onClick={() => navigate('/learn')}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-5 transition-colors"
        >
          ← Back
        </button>
        <LockedCategoryModal
          category={lockedCategory ?? ''}
          tier={lockedCategory ? requiredTier(lockedCategory, settings) : 'silver'}
          user={user}
          pendingBriefId={briefId}
          onClose={() => navigate('/learn')}
        />
      </>
    )
  }

  if (!brief) {
    return (
      <div className="text-center py-16 text-slate-400">
        <div className="text-4xl mb-3">📭</div>
        <p>Brief not found.</p>
        <button onClick={() => navigate(-1)} className="mt-4 text-brand-600 font-semibold">← Go back</button>
      </div>
    )
  }

  if (brief.status === 'stub') {
    return (
      <>
        <button
          onClick={() => navigate(`/learn/${encodeURIComponent(brief.category)}`)}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-5 transition-colors"
        >
          ← {brief.category}
        </button>
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs font-bold bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full border border-brand-200">
            {brief.category}
          </span>
          {brief.subcategory && (
            <span className="text-xs text-slate-400 font-medium">{brief.subcategory}</span>
          )}
        </div>
        <h1 className="text-2xl font-extrabold text-slate-900 leading-tight mb-6">{brief.title}</h1>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-slate-900 rounded-2xl p-8 text-center"
        >
          <div className="text-5xl mb-4">🔒</div>
          <h2 className="text-xl font-extrabold text-white mb-2 tracking-wide">
            Intelligence Surveillance Underway
          </h2>
          <p className="text-slate-400 text-sm leading-relaxed max-w-xs mx-auto">
            Our analysts are currently compiling this brief. Check back here soon for the full intelligence report.
          </p>
          <div className="mt-6 flex justify-center">
            <motion.div
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              className="flex items-center gap-2 text-xs font-bold tracking-[0.2em] text-red-400 uppercase"
            >
              <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
              Surveillance Active
            </motion.div>
          </div>
          {user?.isAdmin && (
            <button
              onClick={() => navigate('/admin', { state: { openLeads: true, leadsSearch: brief.title } })}
              className="mt-5 px-4 py-2 rounded-xl bg-brand-600 text-white text-xs font-bold hover:bg-brand-700 transition-colors"
            >
              ✦ Generate Brief →
            </button>
          )}
        </motion.div>
        <div className="mt-5">
          <ContinueLearning brief={brief} navigate={navigate} fallbackCards={randomBriefs} />
        </div>
      </>
    )
  }

  if (!sections.length && !done) {
    return (
      <>
        <button
          onClick={() => navigate(`/learn/${encodeURIComponent(brief.category)}`)}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-5 transition-colors"
        >
          ← {brief.category}
        </button>
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs font-bold bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full border border-brand-200">
            {brief.category}
          </span>
          {brief.subcategory && (
            <span className="text-xs text-slate-400 font-medium">{brief.subcategory}</span>
          )}
        </div>
        <h1 className="text-2xl font-extrabold text-slate-900 leading-tight mb-6">{brief.title}</h1>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-slate-900 rounded-2xl p-8 text-center"
        >
          <div className="text-5xl mb-4">🔒</div>
          <h2 className="text-xl font-extrabold text-white mb-2 tracking-wide">
            Intelligence Surveillance Underway
          </h2>
          <p className="text-slate-400 text-sm leading-relaxed max-w-xs mx-auto">
            Our analysts are currently compiling this brief. Check back here soon for the full intelligence report.
          </p>
          <div className="mt-6 flex justify-center">
            <motion.div
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              className="flex items-center gap-2 text-xs font-bold tracking-[0.2em] text-red-400 uppercase"
            >
              <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
              Surveillance Active
            </motion.div>
          </div>
          {user?.isAdmin && (
            <button
              onClick={() => navigate('/admin', { state: { openLeads: true, leadsSearch: brief.title } })}
              className="mt-5 px-4 py-2 rounded-xl bg-brand-600 text-white text-xs font-bold hover:bg-brand-700 transition-colors"
            >
              ✦ Generate Brief →
            </button>
          )}
        </motion.div>
        <button
          onClick={() => navigate(`/learn/${encodeURIComponent(brief.category)}`)}
          className="mt-5 w-full py-3 border border-slate-200 text-slate-600 font-semibold rounded-2xl hover:bg-slate-50 transition-colors"
        >
          ← Back to {brief.category}
        </button>
      </>
    )
  }

  // Already-read screen: shown when returning to a previously completed brief
  if (readRecord?.completed && user && !reReadMode && !done) {
    return (
      <AlreadyReadScreen
        brief={brief}
        quizPassed={quizPassed}
        booState={booState}
        onReRead={() => { setReReadMode(true); setSection(0); setNavDir(1) }}
        navigate={navigate}
        quizAvailable={quizAvailable}
      />
    )
  }

  return (
    <>
      <TutorialModal />
      <KeywordSheet kw={activeKw} onClose={() => { playSound('stand_down'); setActiveKw(null) }} navigate={navigate} />
      <StatMnemonicSheet stat={activeStat} onClose={() => setActiveStat(null)} />

      {/* Layer 1: block navigation while spawn-check is in-flight */}
      {spawnCheckPending && (
        <motion.div
          key="spawn-check-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-[300] bg-slate-950/85 flex flex-col items-center justify-center gap-5 pointer-events-all"
        >
          <motion.div
            animate={{ scale: [1, 1.5, 1], opacity: [0.6, 0.1, 0.6] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
            className="w-14 h-14 rounded-full border-2 border-red-500"
          />
          <p className="text-xs font-bold tracking-[0.3em] text-red-400 uppercase">
            Incoming message
          </p>
        </motion.div>
      )}

      {/* Where's That Aircraft — mission spawn */}
      {missionData && (
        <MissionDetectedModal
          aircraftBriefId={missionData.aircraftBriefId}
          aircraftTitle={missionData.aircraftTitle}
          mediaUrl={missionData.mediaUrl}
          onAccept={() => localStorage.removeItem('pendingWtaGame')}
          onDismiss={() => { localStorage.removeItem('pendingWtaGame'); setMissionData(null) }}
        />
      )}

      {/* Back + header — fades to 50% after section-1 intro */}
      <motion.div
        animate={{ opacity: topOpacity }}
        transition={{ duration: 1.6, ease: 'easeInOut' }}
      >
        {/* Back */}
        <button
          onClick={() => navigate(`/learn/${encodeURIComponent(brief.category)}`)}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-5 transition-colors"
        >
          ← {brief.category}
        </button>

        {/* Brief header */}
        <div className="mb-5 overflow-hidden">
          <AnimatePresence initial={false}>
            {!isLast && (
              <motion.div
                key="header-content"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
                style={{ overflow: 'hidden' }}
              >
                <p className="text-xs font-semibold text-brand-500 mb-1.5">
                  {brief.category}{brief.subcategory ? ` · ${brief.subcategory}` : ''}
                </p>
                <h1 className="text-2xl font-extrabold text-text leading-tight">{brief.title}</h1>
                {brief.nickname && (
                  <p className="text-sm text-text-muted italic mt-0.5">"{brief.nickname}"</p>
                )}
                {brief.subtitle && (
                  <p className="text-sm text-text-muted mt-1.5">{brief.subtitle}</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>


      {/* Completion screen */}
      {done ? (
        <CompletionScreen
          brief={brief}
          user={user}
          isFirstCompletion={isFirstCompletion}
          coinReward={settings?.aircoinsPerBriefRead ?? 5}
          onQuiz={() => navigate(`/quiz/${briefId}`)}
          booState={booState}
          onBattleOrder={booState === 'available' || booState === 'completed' ? () => navigate(`/battle-of-order/${briefId}`) : null}
          onBack={() => navigate(`/learn/${encodeURIComponent(brief.category)}`)}
          onReRead={() => { setDone(false); setReReadMode(true); setSection(0); setNavDir(1) }}
          navigate={navigate}
          quizPassed={quizPassed}
          quizAvailable={quizAvailable}
        />
      ) : (
        <>
          <div ref={contentRef} />
          {/* Section progress bar — fades to 50% after section-1 intro */}
          <motion.div
            animate={{ opacity: topOpacity }}
            transition={{ duration: 1.6, ease: 'easeInOut' }}
          >
            {total > 1 && !isLast && (
              <div className="mb-5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-slate-500">
                    Section {sectionIdx + 1} of {total}
                  </span>
                  <span className="text-xs text-slate-400">
                    {Math.round(((sectionIdx + 1) / total) * 100)}% through
                  </span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-brand-500 rounded-full"
                    animate={{ width: `${((sectionIdx + 1) / total) * 100}%` }}
                    transition={{ duration: 0.4 }}
                  />
                </div>
              </div>
            )}
          </motion.div>

          {/* Swipeable section card */}
          {(() => {
            const imageZones = buildImageZones(brief.media, total)
            const stats      = buildStats(brief)
            const kwList     = [
              ...(brief.keywords || []).map(kw => ({ ...kw, linkedBriefCategory: kw.linkedBriefId?.category ?? null })),
              ...(brief.associatedBaseBriefIds || []).map(b => ({ keyword: b.title, linkedBriefId: b._id, generatedDescription: b.subtitle, linkedBriefCategory: b.category })),
              ...(brief.associatedSquadronBriefIds || []).map(b => ({ keyword: b.title, linkedBriefId: b._id, generatedDescription: b.subtitle, linkedBriefCategory: b.category })),
              ...mentionedBriefs.map(b => ({ keyword: b.matchTerm, linkedBriefId: b._id, generatedDescription: b.subtitle, linkedBriefCategory: b.category })),
            ]
            return (
              <div className="relative mb-4">
                <AnimatePresence>
                  {showTutorial && !visible && (
                    <SwipeTutorial onDismiss={() => {
                      setShowTutorial(false)
                      const _swipeKey = user?._id ? `sw_tut_v2_${user._id}_swipe` : 'sw_tut_v2_anon_swipe'
                      localStorage.setItem(_swipeKey, '1')
                    }} />
                  )}
                </AnimatePresence>
                <SwipeCard
                  key={sectionIdx}
                  navDir={navDir}
                  canGoBack={sectionIdx > 0}
                  onSwipeLeft={handleContinue}
                  onSwipeRight={handleGoBack}
                  showTutorial={showTutorial && !visible}
                  onFirstSwipe={() => {
                    if (!hasSwiped) {
                      setHasSwiped(true)
                      setShowTutorial(false)
                      const _swipeKey = user?._id ? `sw_tut_v2_${user._id}_swipe` : 'sw_tut_v2_anon_swipe'
                      localStorage.setItem(_swipeKey, '1')
                    }
                  }}
                >
                  <SectionCard
                    imageZone={imageZones[sectionIdx]}
                    stat={stats[sectionIdx] ?? null}
                    sectionIdx={sectionIdx}
                    total={total}
                    isLast={isLast}
                    tutorialActive={visible}
                    highlightedBaseNames={
                      brief.category === 'Bases'
                        ? [brief.title]
                        : (brief.associatedBaseBriefIds ?? []).filter(b => b?._id).map(b => b.title)
                    }
                    mapOpen={mapOpen}
                    setMapOpen={setMapOpen}
                    centreOn={mapCentreOn}
                    title={brief.title}
                    subtitle={brief.subtitle}
                    category={brief.category}
                    subcategory={brief.subcategory}
                    text={sections[sectionIdx]}
                    keywords={kwList}
                    learnedKws={learnedKws}
                    onKeywordTap={handleKeywordTap}
                    onStatTap={handleStatTap}
                  />
                </SwipeCard>
              </div>
            )
          })()}

          {/* Keyword hint — first section only */}
          {sectionIdx === 0 && brief.keywords?.some(kw =>
            sections[sectionIdx]?.toLowerCase().includes(kw.keyword.toLowerCase())
          ) && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: showTutorial ? 0.5 : 1 }}
              transition={{ delay: showTutorial ? 0 : 0.5 }}
              className="text-xs text-brand-500 text-center mb-4"
            >
              💡 Tap a <span className="font-semibold text-brand-700 border-b-2 border-brand-300/70 bg-brand-50/50 rounded px-0.5">highlighted word</span> to learn its meaning
            </motion.p>
          )}

          {/* Swipe hint — shown until first swipe */}
          {!hasSwiped && !visible && (
            <p className="text-xs text-slate-400 text-center mb-4">← swipe to navigate →</p>
          )}

          {/* Connections */}
          <motion.div
            animate={{ opacity: isLast ? 1 : 0.3 }}
            transition={{ opacity: { duration: 1.6, ease: 'easeInOut' } }}
            className="mt-6"
          >
            <BriefConnectionsPanel
              brief={brief}
              navigate={navigate}
              autoExpand={isLast}
              onBasePillClick={isLast ? undefined : name => { setMapOpen(true); setMapCentreOn(name) }}
            />
          </motion.div>

          {/* Sources */}
          {brief.sources?.length > 0 && (
            <div className="mt-6 pt-4 border-t border-slate-100">
              <p className="text-xs text-slate-300 mb-1">Sources</p>
              <div className="space-y-0.5">
                {brief.sources.map((s, i) => (
                  <a
                    key={i}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-xs text-slate-300 hover:text-slate-400 truncate"
                  >
                    {s.siteName || s.url}
                    {s.articleDate && <span className="ml-1">· {new Date(s.articleDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}
