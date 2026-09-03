import { useEffect, useState, useMemo, Suspense, lazy } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { useAppSettings } from '../context/AppSettingsContext'
import { useSlimMode } from '../hooks/useSlimMode'
import { captureEvent } from '../lib/posthog'
import WelcomeAgentFlow from '../components/onboarding/WelcomeAgentFlow'
import SocialLinks from '../components/SocialLinks'
import { CBAT_GUIDE_HREF, prepareGuideChrome } from '../utils/guideHref'
import SEO from '../components/SEO'
import PreviewWindow from '../components/homePreview/PreviewWindow'
import LiveGameGrid from '../components/landingGames/LiveGameGrid'
import { buildIntelBriefScenes } from '../components/homePreview/registries/intelBriefRegistry'
import { buildCbatScenes } from '../components/homePreview/registries/cbatRegistry'

// Lazy purely to keep Recharts out of the landing page's first chunk — the wall
// sits at the bottom of the page and nothing above it needs charting.
const PlayerProgressWall = lazy(() => import('../components/landingGames/PlayerProgressWall'))

const FEATURES = [
  { icon: '✈️', title: 'Learn About Military Aviation', body: 'Structured intel briefs covering aircraft, bases, roles, operations, and more — designed for aspiring aviators.' },
  { icon: '🧠', title: 'Section-by-Section Reading', body: 'Each brief is broken into short, clear sections. Read at your own pace and build genuine knowledge.' },
  { icon: '🎙️', title: 'Live Debrief Sessions',       body: 'Step into a one-on-one debrief — targeted recall questions, follow-ups on what you missed, and an instant feedback report when you wrap.', badge: 'New format' },
  { icon: '🔥', title: 'Daily Streaks',              body: 'Return every day to keep your streak alive. Consistent learning beats last-minute cramming every time.' },
  { icon: '🏆', title: 'Climb the Rankings',         body: 'Compete with other learners on the leaderboard as you progress through subjects.' },
  { icon: '📰', title: 'Daily Aviation News',        body: 'Stay up to date with real defence aviation news — automatically sourced and formatted as intel briefs.' },
]

const PREVIEW_CATEGORIES = [
  { emoji: '📰', label: 'News'        },
  { emoji: '✈️', label: 'Aircrafts'   },
  { emoji: '🏔️', label: 'Bases'       },
  { emoji: '🎖️', label: 'Ranks'       },
  { emoji: '⚡', label: 'Squadrons'   },
  { emoji: '🎯', label: 'Training'    },
  { emoji: '🛡️', label: 'Roles'       },
  { emoji: '⚠️', label: 'Threats'     },
  { emoji: '🤝', label: 'Allies'      },
  { emoji: '🚀', label: 'Missions'    },
  { emoji: '🌍', label: 'AOR'         },
  { emoji: '💡', label: 'Tech'        },
  { emoji: '📖', label: 'Terminology' },
  { emoji: '📜', label: 'Treaties'    },
  { emoji: '🏅', label: 'Heritage'    },
]

const fadeUp = {
  hidden:  { opacity: 0, y: 24 },
  visible: (i = 0) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.07, duration: 0.5, ease: [0.22, 1, 0.36, 1] },
  }),
}

function CrosshairSVG() {
  return (
    <svg width="24" height="24" viewBox="0 0 40 40" fill="none">
      <circle cx="20" cy="20" r="17" stroke="#1d4ed8" strokeWidth="2.2"/>
      <line x1="20" y1="1"  x2="20" y2="12" stroke="#1d4ed8" strokeWidth="2.2" strokeLinecap="round"/>
      <line x1="20" y1="28" x2="20" y2="39" stroke="#1d4ed8" strokeWidth="2.2" strokeLinecap="round"/>
      <line x1="1"  y1="20" x2="12" y2="20" stroke="#1d4ed8" strokeWidth="2.2" strokeLinecap="round"/>
      <line x1="28" y1="20" x2="39" y2="20" stroke="#1d4ed8" strokeWidth="2.2" strokeLinecap="round"/>
      <circle cx="20" cy="20" r="7" stroke="#5baaff" strokeWidth="1.8"/>
      <circle cx="20" cy="20" r="2.5" fill="#5baaff"/>
    </svg>
  )
}

/* Corner bracket decoration — tactical UI feel */
function CornerBrackets({ size = 18, color = '#5baaff', opacity = 0.4 }) {
  const s = `${size}px`
  const style = { color, opacity, pointerEvents: 'none' }
  const line = `2px solid currentColor`
  return (
    <>
      <span style={{ ...style, position: 'absolute', top: 0,    left: 0,  width: s, height: s, borderTop: line, borderLeft:  line }} />
      <span style={{ ...style, position: 'absolute', top: 0,    right: 0, width: s, height: s, borderTop: line, borderRight: line }} />
      <span style={{ ...style, position: 'absolute', bottom: 0, left: 0,  width: s, height: s, borderBottom: line, borderLeft:  line }} />
      <span style={{ ...style, position: 'absolute', bottom: 0, right: 0, width: s, height: s, borderBottom: line, borderRight: line }} />
    </>
  )
}

export default function Landing() {
  const { user, API } = useAuth()
  const { settings } = useAppSettings()
  const slim = useSlimMode()
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [liveStats, setLiveStats] = useState(null)
  // Imported lazily inside the registry; here we just need the metadata list
  // to feed the CBAT registry's scene-filtering pass. Sync import is fine —
  // it's a tiny static array, no perf cost.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const [cbatGamesMeta, setCbatGamesMeta] = useState(null)
  useEffect(() => {
    let aborted = false
    import('../data/cbatGames').then(m => { if (!aborted) setCbatGamesMeta(m.CBAT_GAMES) })
    return () => { aborted = true }
  }, [])

  const intelBriefScenes = useMemo(
    () => buildIntelBriefScenes(settings, user),
    [settings, user],
  )
  const cbatScenes = useMemo(
    () => cbatGamesMeta ? buildCbatScenes(settings, user, cbatGamesMeta) : [],
    [settings, user, cbatGamesMeta],
  )

  // In slim (CBAT-only) mode the intel-brief preview is irrelevant, and the
  // CBAT preview window is replaced outright by the live game wall.
  const showIntelBriefWindow = !slim && (settings?.previewWindowIntelBriefEnabled !== false) && intelBriefScenes.length > 0
  const showCbatWindow       = !slim && (settings?.previewWindowCbatEnabled !== false) && cbatScenes.length > 0

  useEffect(() => {
    let aborted = false
    fetch(`${API}/api/briefs/public-stats`)
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (!aborted && j?.data) setLiveStats(j.data) })
      .catch(() => {})
    return () => { aborted = true }
  }, [API])

  const briefCount    = liveStats?.totalBriefs
  const questionCount = liveStats?.totalQuestions

  return (
    <div className="min-h-screen" style={{ background: '#06101e' }}>
      {/* Both descriptions lead on CBAT: it is the term people search for, and
          the home page is what ranks for it. The full-site variant adds the
          wider library afterwards rather than opening with it. */}
      <SEO description={slim
        ? 'Practise the aircrew CBAT-style aptitude subtests, from FLAG and ANT to DPT and ACT. Free to play in the browser, with every score tracked.'
        : 'Free CBAT-style practice tests for every aircrew aptitude subtest, from FLAG and ANT to DPT and ACT, plus a full library of military aviation briefs.'} />

      {/* ── Header ─────────────────────────────────────────── */}
      <header className="fixed top-0 inset-x-0 z-40 bg-slate-50/80 backdrop-blur-md border-b border-slate-200/50">
        <div className="max-w-5xl mx-auto px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CrosshairSVG />
            <span className="font-bold tracking-widest text-brand-600 text-sm">SKYWATCH</span>
          </div>
          <div className="flex items-center gap-3">
            {user ? (
              <Link to={slim ? '/cbat' : '/home'} className="bg-brand-600 hover:bg-brand-700 text-slate-50 text-sm font-bold px-4 py-1.5 rounded-full transition-colors">
                {slim ? 'Play CBAT' : 'Continue Learning'}
              </Link>
            ) : (
              <>
                <Link to="/login" className="text-sm font-semibold text-slate-600 hover:text-slate-800 transition-colors">
                  Sign In
                </Link>
                <Link to="/login?tab=register" className="bg-brand-600 hover:bg-brand-700 text-slate-50 text-sm font-bold px-4 py-1.5 rounded-full transition-colors">
                  Enlist
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────── */}
      <section className="pt-20 sm:pt-36 pb-10 sm:pb-24 px-5 text-center max-w-3xl mx-auto">
        <motion.div
          initial="hidden" animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.08 } } }}
        >
          {/* Classified badge row */}
          <motion.div variants={fadeUp} custom={0} className="flex items-center justify-center gap-2 mb-8">
            <span className="classified-tag">{slim ? 'CBAT TRAINING' : 'CLASSIFIED'}</span>
            <span className="intel-tag">FREE</span>
          </motion.div>

          <motion.h1 variants={fadeUp} custom={1} className="text-5xl sm:text-6xl font-extrabold text-slate-900 mb-5 leading-tight tracking-tight">
            {slim ? (
              <>Train for the{' '}<span className="text-gradient">Aircrew CBAT</span></>
            ) : (
              <>Master{' '}<span className="text-gradient">Aviation Knowledge</span></>
            )}
          </motion.h1>

          <motion.p variants={fadeUp} custom={2} className="text-lg sm:text-xl text-slate-600 mb-6 max-w-xl mx-auto leading-relaxed">
            {slim
              ? 'Targeted practice games for the aircrew Computer-Based Aptitude Test. Sharpen each subtest, track your scores, and build the speed the real thing demands.'
              : 'Not a Wikipedia article. A structured, gamified path through military aircraft, operations, doctrine, and more.'}
          </motion.p>

          {!slim && settings?.cbatEnabled && (
            <motion.div variants={fadeUp} custom={3} className="flex justify-center mb-10">
              <Link
                to="/cbat"
                onClick={() => captureEvent('landing_cbat_badge_clicked')}
                className="group inline-flex items-center gap-2.5 rounded-full pl-1.5 pr-4 py-1.5 border border-amber-500/50 bg-amber-500/[0.08] hover:bg-amber-500/[0.14] hover:border-amber-500/80 transition-colors"
              >
                <span className="inline-flex items-center gap-1 text-[10px] font-extrabold tracking-wider px-2.5 py-1 rounded-full bg-amber-500 text-slate-50">
                  <span className="text-xs leading-none">🎯</span>
                  PRACTICE
                </span>
                <span className="text-sm font-semibold text-slate-800">Here for CBAT practice games?</span>
                <span className="text-amber-500 text-base leading-none group-hover:translate-x-0.5 transition-transform">→</span>
              </Link>
            </motion.div>
          )}

          <motion.div variants={fadeUp} custom={4} className="flex flex-col sm:flex-row gap-2 sm:gap-3 justify-center items-center">
            {user ? (
              <Link
                to={slim ? '/cbat' : '/home'}
                className="bg-brand-600 hover:bg-brand-700 text-slate-50 font-bold px-8 py-4 rounded-2xl text-lg transition-all hover:shadow-lg hover:-translate-y-0.5"
                style={{ boxShadow: '0 0 24px rgba(91,170,255,0.25)' }}
              >
                {slim ? 'Play CBAT Games' : 'Continue Learning'}
              </Link>
            ) : slim ? (
              <Link
                to="/login?tab=register"
                className="bg-brand-600 hover:bg-brand-700 text-slate-50 font-bold px-8 py-4 rounded-2xl text-lg transition-all hover:shadow-lg hover:-translate-y-0.5"
                style={{ boxShadow: '0 0 24px rgba(91,170,255,0.25)' }}
              >
                Start Practising Free →
              </Link>
            ) : (
              <button
                onClick={() => setShowOnboarding(true)}
                className="bg-brand-600 hover:bg-brand-700 text-slate-50 font-bold px-8 py-4 rounded-2xl text-lg transition-all hover:shadow-lg hover:-translate-y-0.5"
                style={{ boxShadow: '0 0 24px rgba(91,170,255,0.25)' }}
              >
                Start for Free →
              </button>
            )}
            {!slim && (
              <Link
                to="/learn-priority"
                className="
                  sm:bg-surface sm:hover:bg-surface-raised
                  text-slate-700 sm:font-bold font-semibold
                  sm:px-8 sm:py-4 px-2 py-1
                  sm:rounded-2xl
                  text-sm sm:text-lg
                  sm:border sm:border-slate-200
                  transition-all sm:hover:-translate-y-0.5
                  underline sm:no-underline
                  decoration-slate-500/40 underline-offset-4
                "
              >
                Browse Subjects
              </Link>
            )}
          </motion.div>
        </motion.div>

        {/* Stats strip — RAF-learning oriented, hidden in slim CBAT mode */}
        {!slim && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.5 }}
          className="mt-8 sm:mt-16 grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-6 max-w-md sm:max-w-none mx-auto text-center"
        >
          {[
            { value: '15',                                                 label: 'Subject Areas'  },
            { value: briefCount    != null ? briefCount.toLocaleString()    : '—', label: 'Intel Briefs',   caption: 'Expanding daily' },
            { value: questionCount != null ? questionCount.toLocaleString() : '—', label: 'Practice Questions', caption: 'Every brief covered' },
            { value: 'Daily',                                              label: 'Streak System'  },
          ].map(({ value, label, caption }) => (
            <div key={label} className="relative px-2 sm:px-4 py-2 sm:py-3" style={{ border: '1px solid rgba(91,170,255,0.12)', borderRadius: 8 }}>
              <CornerBrackets size={8} />
              <div className="text-xl sm:text-2xl font-extrabold text-brand-600 intel-mono">{value}</div>
              <div className="text-[11px] sm:text-xs text-slate-500 intel-mono mt-0.5 leading-tight">{label}</div>
              {caption && <div className="hidden sm:block text-[10px] text-slate-500/80 intel-mono mt-0.5">{caption}</div>}
            </div>
          ))}
        </motion.div>
        )}
      </section>

      {/* ── Intel Brief preview window ─────────────────────── */}
      {showIntelBriefWindow && (
        <Suspense fallback={null}>
          <PreviewWindow
            eyebrow="INTEL BRIEF GAMES"
            heading="Your training, in 25 seconds"
            scenes={intelBriefScenes}
            dataTestId="preview-window-intel-brief"
          />
        </Suspense>
      )}

      {/* ── CBAT games ─────────────────────────────────────────
          Slim (CBAT-only) mode leads with the live game wall: a grid of the
          real games playing themselves. Everywhere else keeps the cycling
          preview window. */}
      {slim ? (
        <Suspense fallback={null}>
          <LiveGameGrid />
        </Suspense>
      ) : showCbatWindow && (
        <Suspense fallback={null}>
          <PreviewWindow
            eyebrow="CBAT PRACTICE GAMES"
            heading="Train for CBAT"
            scenes={cbatScenes}
            dataTestId="preview-window-cbat"
          />
        </Suspense>
      )}

      {/* ── CBAT field guide ───────────────────────────────────
          Sits directly under the games in both modes, because that is where the
          question it answers gets asked: someone who has just watched the games
          play themselves and doesn't yet know what CBAT *is* needs the reading,
          not another button. Blue rather than the hero badge's amber — amber is
          this page's "go and play", blue its "go and read", and keeping them
          apart stops the two CBAT routes competing for the same glance.

          A plain <a>, not a react-router <Link>: the guide is a standalone
          document in public/, not an app route (see App.jsx), so a <Link> would
          push a history entry and land on the SPA's 404. The href comes from
          CBAT_GUIDE_HREF because the native app has no server rewrite and needs
          the file's real name — see utils/guideHref.js. That also makes it a
          real crawlable anchor, which matters — the landing page is the site's
          most-crawled URL and until this card existed nothing on the public site
          linked to the guide at all. Google had only the sitemap to find it by
          and reported "URL is not on Google", never having fetched it once.

          Rendered unconditionally, deliberately. Every other CBAT block here is
          gated behind a settings flag that arrives over the network, and a crawl
          that missed that request would see no link. The guide is a public
          document that stands up on its own even with the games switched off. */}
      {/* py-8 sm:py-12 is the rhythm every band on this page uses (PreviewWindow,
          LiveGameGrid). Top padding alone left the card jammed against the proof
          wall below it, which carries pb only and leans on its predecessor for
          the gap above. */}
      <section className="py-8 sm:py-12 px-5 max-w-4xl mx-auto">
        <motion.a
          href={CBAT_GUIDE_HREF}
          onClick={() => { captureEvent('landing_cbat_guide_clicked'); prepareGuideChrome() }}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.45 }}
          className="group relative flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6 card-intel rounded-2xl p-5 sm:p-7 no-underline transition-all hover:-translate-y-0.5"
        >
          <CornerBrackets size={14} />
          <span className="text-4xl sm:text-5xl shrink-0 group-hover:scale-110 transition-transform">📖</span>
          <div className="min-w-0 flex-1">
            <span className="intel-tag inline-block">FIELD GUIDE</span>
            <h3 className="text-lg sm:text-xl font-bold text-slate-900 mt-2.5 mb-1.5">The Complete Guide to CBAT</h3>
            <p className="text-sm text-slate-500 leading-relaxed">
              What each subtest is really like, how the test day runs, and the details that catch
              people out. Free to read, no account needed.
            </p>
          </div>
          <span className="shrink-0 inline-flex items-center gap-2 text-sm font-bold text-brand-600">
            Read the guide
            <span className="text-base leading-none group-hover:translate-x-0.5 transition-transform">→</span>
          </span>
        </motion.a>
      </section>

      {/* Subject areas + Features — RAF-learning sections, hidden in slim CBAT mode */}
      {!slim && (<>
      {/* ── Subject areas ──────────────────────────────────── */}
      <section className="py-16 px-5 max-w-4xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-10"
        >
          <div className="flex items-center justify-center gap-2 mb-3">
            <span className="intel-tag">SUBJECT INDEX</span>
          </div>
          <h2 className="text-3xl font-bold text-slate-900 mb-3">Everything You Need to Know</h2>
          <p className="text-slate-500 max-w-lg mx-auto">Fifteen subject areas covering the full breadth of modern military aviation.</p>
        </motion.div>

        <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 sm:gap-3">
          {PREVIEW_CATEGORIES.map(({ emoji, label }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, scale: 0.92 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05, duration: 0.35 }}
            >
              <Link
                to="/learn-priority"
                state={{ category: label }}
                className="relative flex flex-col items-center gap-1.5 sm:gap-2 rounded-xl sm:rounded-2xl p-2.5 sm:p-4 border transition-all card-intel hover:card-intel hover:-translate-y-0.5 group"
              >
                <CornerBrackets size={10} />
                <span className="text-2xl sm:text-3xl group-hover:scale-110 transition-transform">{emoji}</span>
                <span className="text-[11px] sm:text-sm font-semibold text-slate-700 leading-tight text-center">{label}</span>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────── */}
      <section className="py-16 px-5 max-w-4xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-10"
        >
          <div className="flex items-center justify-center gap-2 mb-3">
            <span className="intel-tag">MISSION BRIEFING</span>
          </div>
          <h2 className="text-3xl font-bold text-slate-900 mb-3">How It Works</h2>
          <p className="text-slate-500">Every feature built around one goal — deep aviation knowledge.</p>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map(({ icon, title, body, badge }, i) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.07, duration: 0.4 }}
              className="relative card-intel rounded-2xl p-5"
            >
              <CornerBrackets size={12} />
              {badge && (
                <span
                  className="absolute -top-2 right-3 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full intel-mono"
                  style={{
                    background: 'linear-gradient(135deg, #5baaff 0%, #1d4ed8 100%)',
                    color: '#ffffff',
                    boxShadow: '0 0 12px rgba(91,170,255,0.5)',
                    border: '1px solid rgba(91,170,255,0.6)',
                  }}
                >
                  {badge}
                </span>
              )}
              <span className={`text-3xl${icon === '🔥' ? ' flame-blue' : ''}`}>{icon}</span>
              <h3 className="font-bold text-slate-900 mt-3 mb-1.5">{title}</h3>
              <p className="text-sm text-slate-500 leading-relaxed">{body}</p>
            </motion.div>
          ))}
        </div>
      </section>
      </>)}

      {/* ── Proof wall ─────────────────────────────────────────
          Real players' score histories, three picked at random per page load.
          Renders nothing when no player qualifies.

          It sits directly ABOVE the closing CTA, not below it: evidence first,
          then the ask. The other order let the page make its final request
          before it had shown any reason to say yes, and left the page trailing
          off on charts with no button — a visitor the charts convinced had to
          scroll back up to act. */}
      <Suspense fallback={null}>
        <PlayerProgressWall />
      </Suspense>

      {/* ── CTA ───────────────────────────────────────────── */}
      <section className="py-12 sm:py-20 px-5">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="relative max-w-2xl mx-auto rounded-3xl p-6 sm:p-10 text-center overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, #0f2850 0%, #081930 100%)',
            border: '1px solid rgba(91,170,255,0.2)',
            boxShadow: '0 0 60px rgba(91,170,255,0.08), 0 20px 40px rgba(0,0,0,0.4)',
          }}
        >
          <CornerBrackets size={20} color="#5baaff" opacity={0.5} />

          {/* "PRIORITY ACCESS" is kept for the briefings, where access is the
              thing being offered. In slim mode the ask is a free signup, and an
              exclusivity tag on a free product reads as a paywall — so the tag
              states the fact that makes the heading below credible instead: the
              boards really do reset weekly (CbatLeaderboard renders a countdown
              off `resetsAt`), which is why a stranger can expect to place. */}
          <div className="flex items-center justify-center gap-2 mb-4">
            <span className="classified-tag">{slim ? 'WEEKLY RESET' : 'PRIORITY ACCESS'}</span>
          </div>

          <div className="text-5xl mb-4">🎯</div>
          {/* Slim copy states the payoff and the reason to sign up; the button
              below carries the verb. The old "Start Your Own Run." spent the
              heading on the button's own word ("Start" ran three times in one
              card) and leant on "run", which the page only defines in the wall
              above — a section that renders nothing when no player qualifies,
              leaving "every line above" pointing at nothing. This version reads
              the same with or without it.

              "This week's" rather than bare "the leaderboard": the boards reset
              weekly and CbatLeaderboard opens on that tab, so the bar being
              offered is one week of scores, not a year of them — a far smaller
              thing to ask a stranger to believe they can clear. */}
          <h2 className="text-3xl font-extrabold mb-3" style={{ color: '#ffffff' }}>{slim ? "Get on this week's leaderboard." : 'Aim Higher.'}</h2>
          <p className="text-lg mb-8 max-w-md mx-auto" style={{ color: '#a8c4e0' }}>
            {slim
              ? 'Create an account and every game scores you instantly, tracking your progress from the first play.'
              : 'Stop skimming Wikipedia. Start actually knowing military aviation.'}
          </p>
          {user ? (
            <Link
              to={slim ? '/cbat' : '/home'}
              className="inline-block bg-brand-600 hover:bg-brand-700 text-slate-50 font-bold px-8 py-4 rounded-2xl text-lg transition-colors"
              style={{ boxShadow: '0 0 20px rgba(91,170,255,0.3)' }}
            >
              {slim ? 'Play CBAT Games →' : 'Access the Briefings →'}
            </Link>
          ) : slim ? (
            <Link
              to="/login?tab=register"
              className="inline-block bg-brand-600 hover:bg-brand-700 text-slate-50 font-bold px-8 py-4 rounded-2xl text-lg transition-colors"
              style={{ boxShadow: '0 0 20px rgba(91,170,255,0.3)' }}
            >
              Start Practising Free →
            </Link>
          ) : (
            <button
              onClick={() => setShowOnboarding(true)}
              className="inline-block bg-brand-600 hover:bg-brand-700 text-slate-50 font-bold px-8 py-4 rounded-2xl text-lg transition-colors"
              style={{ boxShadow: '0 0 20px rgba(91,170,255,0.3)' }}
            >
              Access the Briefings →
            </button>
          )}
        </motion.div>
      </section>

      {/* ── Footer ────────────────────────────────────────── */}
      <footer className="py-8 px-5 border-t border-slate-200 text-center">
        <p className="text-slate-500 intel-mono text-xs">© {new Date().getFullYear()} SKYWATCH · BUILT FOR THOSE WHO TAKE AVIATION SERIOUSLY</p>
        <SocialLinks source="landing" className="mt-4" />
        <div className="mt-4 flex items-center justify-center gap-3">
          {/* Second, always-present path to the guide. The card above can scroll
              past unread; a footer link is the one anchor every crawl of this
              page is guaranteed to reach. Plain <a>, and the same platform-aware
              href, for the same reasons as the card — it is a document, not a
              route. */}
          <a href={CBAT_GUIDE_HREF} onClick={prepareGuideChrome} className="text-xs text-slate-500 hover:text-slate-700 transition-colors">
            CBAT Guide
          </a>
          <span className="text-xs text-slate-300">·</span>
          <Link to="/privacy" className="text-xs text-slate-500 hover:text-slate-700 transition-colors">
            Privacy Policy
          </Link>
          <span className="text-xs text-slate-300">·</span>
          {/* Play wants the deletion URL discoverable without installing the app. */}
          <Link to="/delete-account" className="text-xs text-slate-500 hover:text-slate-700 transition-colors">
            Delete Account
          </Link>
        </div>
      </footer>

      {/* ── Onboarding overlay ────────────────────────────── */}
      <AnimatePresence>
        {showOnboarding && (
          <WelcomeAgentFlow onClose={() => setShowOnboarding(false)} />
        )}
      </AnimatePresence>
    </div>
  )
}
