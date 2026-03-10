import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'

const FEATURES = [
  { emoji: '✈️', title: 'Learn About the RAF',         body: 'Structured intel briefs covering aircraft, bases, roles, operations, and more — written for RAF applicants.' },
  { emoji: '🧠', title: 'Section-by-Section Reading',  body: 'Each brief is broken into short, clear sections. Read at your own pace and build genuine knowledge.' },
  { emoji: '🎮', title: 'Test Yourself',               body: 'After each brief, take a quiz to reinforce what you\'ve learned and earn Aircoins.' },
  { emoji: '🔥', title: 'Daily Streaks',               body: 'Return every day to keep your streak alive. Consistent learning beats last-minute cramming every time.' },
  { emoji: '🏆', title: 'Climb the Rankings',          body: 'Compete with other RAF applicants on the leaderboard as you progress through subjects.' },
  { emoji: '📰', title: 'Live RAF News',               body: 'Stay up to date with real RAF news — automatically sourced and formatted as intel briefs.' },
]

const CATEGORIES = [
  { emoji: '✈️', label: 'Aircrafts'   },
  { emoji: '🏔️', label: 'Bases'       },
  { emoji: '🎯', label: 'Training'    },
  { emoji: '🪖', label: 'Roles'       },
  { emoji: '🚀', label: 'Missions'    },
  { emoji: '🎖️', label: 'Ranks'       },
  { emoji: '⚡', label: 'Squadrons'   },
  { emoji: '📰', label: 'News'        },
]

const fadeUp = {
  hidden:  { opacity: 0, y: 24 },
  visible: (i = 0) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.07, duration: 0.5, ease: [0.22, 1, 0.36, 1] },
  }),
}

export default function Landing() {
  const { user } = useAuth()

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50 via-white to-white">

      {/* ── Minimal header ─────────────────────────────────── */}
      <header className="fixed top-0 inset-x-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-200/60">
        <div className="max-w-5xl mx-auto px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg width="24" height="24" viewBox="0 0 28 28" fill="none">
              <circle cx="14" cy="14" r="10" stroke="#1a76e4" strokeWidth="1.8"/>
              <circle cx="14" cy="14" r="3.5" stroke="#1a76e4" strokeWidth="1.8"/>
              <line x1="14" y1="1"  x2="14" y2="7"  stroke="#1a76e4" strokeWidth="1.8" strokeLinecap="round"/>
              <line x1="14" y1="21" x2="14" y2="27" stroke="#1a76e4" strokeWidth="1.8" strokeLinecap="round"/>
              <line x1="1"  y1="14" x2="7"  y2="14" stroke="#1a76e4" strokeWidth="1.8" strokeLinecap="round"/>
              <line x1="21" y1="14" x2="27" y2="14" stroke="#1a76e4" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
            <span className="font-bold tracking-widest text-slate-800 text-sm">SKYWATCH</span>
          </div>
          <div className="flex items-center gap-3">
            {user ? (
              <Link to="/home" className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold px-4 py-1.5 rounded-full transition-colors">
                Continue Learning
              </Link>
            ) : (
              <>
                <Link to="/login" className="text-sm font-semibold text-slate-600 hover:text-slate-800 transition-colors">
                  Sign In
                </Link>
                <Link to="/login?tab=register" className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-bold px-4 py-1.5 rounded-full transition-colors">
                  Get Started
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────── */}
      <section className="pt-32 pb-20 px-5 text-center max-w-3xl mx-auto">
        <motion.div
          initial="hidden" animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.08 } } }}
        >
          <motion.div variants={fadeUp} custom={0} className="inline-flex items-center gap-2 bg-brand-100 text-brand-700 text-sm font-semibold px-4 py-1.5 rounded-full mb-6 border border-brand-200">
            ✈️ Built for RAF Applicants
          </motion.div>

          <motion.h1 variants={fadeUp} custom={1} className="text-5xl sm:text-6xl font-extrabold text-slate-900 mb-5 leading-tight tracking-tight">
            Master the{' '}
            <span className="text-gradient">Royal Air Force</span>
          </motion.h1>

          <motion.p variants={fadeUp} custom={2} className="text-lg sm:text-xl text-slate-600 mb-10 max-w-xl mx-auto leading-relaxed">
            Build the knowledge you need to join the RAF. Short, structured intel briefs on aircraft, bases, roles, operations, and more.
          </motion.p>

          <motion.div variants={fadeUp} custom={3} className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              to={user ? '/home' : '/login?tab=register'}
              className="bg-brand-600 hover:bg-brand-700 text-white font-bold px-8 py-4 rounded-2xl text-lg transition-all shadow-lg shadow-brand-200 hover:shadow-xl hover:shadow-brand-300 hover:-translate-y-0.5"
            >
              {user ? 'Continue Learning' : 'Start for Free →'}
            </Link>
            <Link
              to="/learn"
              className="bg-white hover:bg-slate-50 text-slate-700 font-bold px-8 py-4 rounded-2xl text-lg border border-slate-200 transition-all hover:-translate-y-0.5"
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
          className="mt-14 flex flex-wrap justify-center gap-8 text-center"
        >
          {[
            { value: '14',  label: 'Subject areas'   },
            { value: '100+', label: 'Intel briefs'    },
            { value: '1000+', label: 'Quiz questions' },
            { value: 'Free', label: 'To start'        },
          ].map(({ value, label }) => (
            <div key={label}>
              <div className="text-2xl font-extrabold text-brand-600">{value}</div>
              <div className="text-sm text-slate-500">{label}</div>
            </div>
          ))}
        </motion.div>
      </section>

      {/* ── Subject areas preview ──────────────────────────── */}
      <section className="py-16 px-5 max-w-4xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-10"
        >
          <h2 className="text-3xl font-bold text-slate-900 mb-3">Everything You Need to Know</h2>
          <p className="text-slate-500 max-w-lg mx-auto">Eight subject areas covering the full breadth of modern RAF knowledge.</p>
        </motion.div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {CATEGORIES.map(({ emoji, label }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05, duration: 0.35 }}
            >
              <Link
                to={`/learn/${label.toLowerCase()}`}
                className="flex flex-col items-center gap-2 bg-white rounded-2xl p-4 border border-slate-200 hover:border-brand-300 hover:bg-brand-50 transition-all card-shadow hover:card-shadow-hover group"
              >
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
          <h2 className="text-3xl font-bold text-slate-900 mb-3">How It Works</h2>
          <p className="text-slate-500">Designed from the ground up for RAF applicants.</p>
        </motion.div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map(({ emoji, title, body }, i) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.07, duration: 0.4 }}
              className="bg-white rounded-2xl p-5 border border-slate-200 card-shadow"
            >
              <span className="text-3xl">{emoji}</span>
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
          className="max-w-2xl mx-auto bg-gradient-to-br from-brand-600 to-brand-700 rounded-3xl p-10 text-center text-white shadow-2xl shadow-brand-300"
        >
          <div className="text-5xl mb-4">🎯</div>
          <h2 className="text-3xl font-extrabold mb-3">Ready to Begin?</h2>
          <p className="text-brand-100 text-lg mb-8 max-w-md mx-auto">
            Join RAF applicants already using Skywatch to prepare for their selection journey.
          </p>
          <Link
            to={user ? '/home' : '/login?tab=register'}
            className="inline-block bg-white text-brand-700 font-bold px-8 py-4 rounded-2xl text-lg hover:bg-brand-50 transition-colors shadow-lg"
          >
            {user ? 'Go to Home →' : 'Create Free Account →'}
          </Link>
        </motion.div>
      </section>

      {/* ── Footer ────────────────────────────────────────── */}
      <footer className="py-8 px-5 border-t border-slate-200 text-center text-sm text-slate-400">
        <p>© {new Date().getFullYear()} Skywatch · Built for RAF Applicants</p>
      </footer>
    </div>
  )
}
