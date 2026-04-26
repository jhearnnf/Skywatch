import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { useAppSettings } from '../context/AppSettingsContext'
import { captureEvent } from '../lib/posthog'
import WelcomeAgentFlow from '../components/onboarding/WelcomeAgentFlow'
import SocialLinks from '../components/SocialLinks'
import SEO from '../components/SEO'

const FEATURES = [
  { icon: '✈️', title: 'Learn About the RAF',        body: 'Structured intel briefs covering aircraft, bases, roles, operations, and more — designed for aspiring aviators.' },
  { icon: '🧠', title: 'Section-by-Section Reading', body: 'Each brief is broken into short, clear sections. Read at your own pace and build genuine knowledge.' },
  { icon: '🎮', title: 'Test Yourself',              body: 'After each brief, take a quiz to reinforce what you\'ve learned and earn Airstars.', badge: 'Now includes CBAT games!' },
  { icon: '🔥', title: 'Daily Streaks',              body: 'Return every day to keep your streak alive. Consistent learning beats last-minute cramming every time.' },
  { icon: '🏆', title: 'Climb the Rankings',         body: 'Compete with other learners on the leaderboard as you progress through subjects.' },
  { icon: '📰', title: 'Daily RAF News',             body: 'Stay up to date with real RAF news — automatically sourced and formatted as intel briefs.' },
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
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [liveStats, setLiveStats] = useState(null)

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
      <SEO description="Master military aviation knowledge with structured intel briefs, quizzes, and interactive games. Study aircraft, bases, ranks, and operations." />

      {/* ── Header ─────────────────────────────────────────── */}
      <header className="fixed top-0 inset-x-0 z-40 bg-slate-50/80 backdrop-blur-md border-b border-slate-200/50">
        <div className="max-w-5xl mx-auto px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CrosshairSVG />
            <span className="font-bold tracking-widest text-brand-600 text-sm">SKYWATCH</span>
          </div>
          <div className="flex items-center gap-3">
            {user ? (
              <Link to="/home" className="bg-brand-600 hover:bg-brand-700 text-slate-50 text-sm font-bold px-4 py-1.5 rounded-full transition-colors">
                Continue Learning
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
      <section className="pt-36 pb-24 px-5 text-center max-w-3xl mx-auto">
        <motion.div
          initial="hidden" animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.08 } } }}
        >
          {/* Classified badge row */}
          <motion.div variants={fadeUp} custom={0} className="flex items-center justify-center gap-2 mb-8">
            <span className="classified-tag">CLASSIFIED</span>
            <span className="intel-tag">FREE TO START</span>
          </motion.div>

          <motion.h1 variants={fadeUp} custom={1} className="text-5xl sm:text-6xl font-extrabold text-slate-900 mb-5 leading-tight tracking-tight">
            Master{' '}
            <span className="text-gradient">RAF Knowledge</span>
          </motion.h1>

          <motion.p variants={fadeUp} custom={2} className="text-lg sm:text-xl text-slate-600 mb-6 max-w-xl mx-auto leading-relaxed">
            Not a Wikipedia article. A structured, gamified path through RAF aircraft, operations, doctrine, and more.
          </motion.p>

          {settings?.cbatEnabled && (
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

          <motion.div variants={fadeUp} custom={4} className="flex flex-col sm:flex-row gap-3 justify-center">
            {user ? (
              <Link
                to="/home"
                className="bg-brand-600 hover:bg-brand-700 text-slate-50 font-bold px-8 py-4 rounded-2xl text-lg transition-all hover:shadow-lg hover:-translate-y-0.5"
                style={{ boxShadow: '0 0 24px rgba(91,170,255,0.25)' }}
              >
                Continue Learning
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
            <Link
              to="/learn-priority"
              className="bg-surface hover:bg-surface-raised text-slate-700 font-bold px-8 py-4 rounded-2xl text-lg border border-slate-200 transition-all hover:-translate-y-0.5"
            >
              Browse Subjects
            </Link>
          </motion.div>
        </motion.div>

        {/* Stats strip */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.5 }}
          className="mt-16 flex flex-wrap justify-center gap-10 text-center"
        >
          {[
            { value: '15',                                                 label: 'Subject Areas'  },
            { value: briefCount    != null ? briefCount.toLocaleString()    : '—', label: 'Intel Briefs',   caption: 'Expanding daily' },
            { value: questionCount != null ? questionCount.toLocaleString() : '—', label: 'Quiz Questions', caption: 'Every brief covered' },
            { value: 'Daily',                                              label: 'Streak System'  },
          ].map(({ value, label, caption }) => (
            <div key={label} className="relative px-4 py-3" style={{ border: '1px solid rgba(91,170,255,0.12)', borderRadius: 8 }}>
              <CornerBrackets size={8} />
              <div className="text-2xl font-extrabold text-brand-600 intel-mono">{value}</div>
              <div className="text-xs text-slate-500 intel-mono mt-0.5">{label}</div>
              {caption && <div className="text-[10px] text-slate-500/80 intel-mono mt-0.5">{caption}</div>}
            </div>
          ))}
        </motion.div>
      </section>

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
          <p className="text-slate-500 max-w-lg mx-auto">Fifteen subject areas covering the full breadth of modern RAF knowledge.</p>
        </motion.div>

        <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
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
                className="relative flex flex-col items-center gap-2 rounded-2xl p-4 border transition-all card-intel hover:card-intel hover:-translate-y-0.5 group"
              >
                <CornerBrackets size={10} />
                <span className="text-3xl group-hover:scale-110 transition-transform">{emoji}</span>
                <span className="text-sm font-semibold text-slate-700">{label}</span>
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
          <p className="text-slate-500">Every feature built around one goal — deep RAF knowledge.</p>
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

      {/* ── CTA ───────────────────────────────────────────── */}
      <section className="py-20 px-5">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="relative max-w-2xl mx-auto rounded-3xl p-10 text-center overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, #0f2850 0%, #081930 100%)',
            border: '1px solid rgba(91,170,255,0.2)',
            boxShadow: '0 0 60px rgba(91,170,255,0.08), 0 20px 40px rgba(0,0,0,0.4)',
          }}
        >
          <CornerBrackets size={20} color="#5baaff" opacity={0.5} />

          <div className="flex items-center justify-center gap-2 mb-4">
            <span className="classified-tag">PRIORITY ACCESS</span>
          </div>

          <div className="text-5xl mb-4">🎯</div>
          <h2 className="text-3xl font-extrabold mb-3" style={{ color: '#ffffff' }}>Aim Higher.</h2>
          <p className="text-lg mb-8 max-w-md mx-auto" style={{ color: '#a8c4e0' }}>
            Stop skimming Wikipedia. Start actually knowing the RAF.
          </p>
          {user ? (
            <Link
              to="/home"
              className="inline-block bg-brand-600 hover:bg-brand-700 text-slate-50 font-bold px-8 py-4 rounded-2xl text-lg transition-colors"
              style={{ boxShadow: '0 0 20px rgba(91,170,255,0.3)' }}
            >
              Access the Briefings →
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
        <p className="text-slate-500 intel-mono text-xs">© {new Date().getFullYear()} SKYWATCH · BUILT FOR THOSE WHO TAKE THE RAF SERIOUSLY</p>
        <SocialLinks source="landing" className="mt-4" />
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
