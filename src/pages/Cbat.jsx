import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import SEO from '../components/SEO'

const CBAT_GAMES = [
  { key: 'target',          emoji: '🎯', title: 'Target',           desc: 'Lock on to the correct answer under pressure.',        path: null },
  { key: 'sdt',             emoji: '📡', title: 'SDT',              desc: 'Speed Distance Time — coming soon.',      path: null },
  { key: 'symbols',         emoji: '🔣', title: 'Symbols',          desc: 'Spot the target symbol in a growing grid, round by round.', path: '/cbat/symbols' },
  { key: 'code-duplicates', emoji: '🧩', title: 'Code Duplicates',  desc: 'Memorise a sequence of digits, then count how many times one appeared.', path: '/cbat/code-duplicates' },
  { key: 'angles',          emoji: '📐', title: 'Angles',           desc: 'Judge angles quickly and accurately.',                  path: '/cbat/angles' },
  { key: 'instruments',     emoji: '🛫', title: 'Instruments',      desc: 'Read cockpit instruments under time pressure.',         path: null },
  { key: 'plane-turn',      emoji: '🗺️', title: 'Plane Turn',       desc: 'Plan your turn and heading with precision.',            path: '/cbat/plane-turn' },
  { key: 'audio-interrupt',  emoji: '🎧', title: 'Audio Interrupt',  desc: 'Respond to audio cues while multitasking.',             path: null },
]

export default function Cbat() {
  const { user } = useAuth()

  return (
    <div className="cbat-page">
      <SEO title="CBAT Games" description="Practise for CBAT with targeted training games." />

      <h1 className="text-2xl font-extrabold text-slate-900 mb-1">CBAT Games</h1>
      <p className="text-sm text-slate-500 mb-6">Practise for CBAT with targeted training games.</p>

      {/* Lock card — shown when not signed in */}
      {!user && (
        <div className="bg-surface rounded-2xl border border-slate-200 p-6 mb-5 text-center card-shadow">
          <div className="text-4xl mb-3">🔒</div>
          <p className="font-bold text-slate-800 mb-1">Sign in to access CBAT Games</p>
          <p className="text-sm text-slate-500 mb-4">Create a free account to start practising.</p>
          <Link to="/login" className="inline-flex px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors">
            Sign In
          </Link>
        </div>
      )}

      {/* Game grid — blurred when not signed in */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3${!user ? ' opacity-40 pointer-events-none select-none blur-sm' : ''}`}>
        {CBAT_GAMES.map((game, i) => (
          <motion.div
            key={game.key}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06, duration: 0.35 }}
          >
            {game.path ? (
              <Link
                to={game.path}
                className="relative flex items-start gap-4 bg-surface rounded-2xl p-4 border border-slate-200 transition-all card-shadow cursor-pointer h-full
                  hover:border-brand-300 hover:bg-brand-50 group hover:-translate-y-0.5 no-underline"
              >
                <span className="text-3xl shrink-0 group-hover:scale-110 transition-transform">{game.emoji}</span>
                <div className="min-w-0">
                  <p className="font-bold text-slate-800 mb-0.5">{game.title}</p>
                  <p className="text-xs text-slate-400">{game.desc}</p>
                </div>
              </Link>
            ) : (
              <div
                className="relative flex items-start gap-4 bg-surface rounded-2xl p-4 border border-slate-200 transition-all card-shadow h-full opacity-60"
              >
                <span className="text-3xl shrink-0">{game.emoji}</span>
                <div className="min-w-0">
                  <p className="font-bold text-slate-800 mb-0.5">{game.title}</p>
                  <p className="text-xs text-slate-400">{game.desc}</p>
                  <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-wide">Coming soon</p>
                </div>
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  )
}
