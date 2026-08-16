import { motion } from 'framer-motion'
import { useGLTF } from '@react-three/drei'
import { ACT_CRAFT_BALL } from '../../utils/cbat/actCraft'

// Craft picker for the ACT instructions screen, built like Trace Practise 3D's
// aircraft grid: the same cutout tiles from the same roster. The first tile is
// the white ball the game has always used, and it stays the default.
//
// Picking here changes nothing but the model drawn in the tunnel — the scoring
// and the flight model are identical whichever tile is lit.

export default function ActCraftPicker({ options, value, onChange, loading }) {
  const select = (opt) => {
    // Fetch the GLB now rather than at round start, so the model is in the
    // cache by the time the player finishes reading the instructions.
    if (opt.modelUrl) {
      try { useGLTF.preload(opt.modelUrl) } catch { /* preload is a nicety */ }
    }
    onChange(opt.id)
  }

  return (
    <div className="bg-[#060e1a] rounded-lg border border-[#1a3a5c] p-3 mb-5 text-left">
      <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Your craft</p>
      <p className="text-[10px] text-[#8a9bb5] mb-3">
        Pick what you fly. It only changes how you look, not how the game scores.
      </p>

      {loading && !options.length && (
        <p className="text-xs text-slate-500">Loading aircraft...</p>
      )}

      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {options.map((opt, i) => {
          const selected = opt.id === value
          return (
            <motion.button
              key={opt.id}
              type="button"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.03 }}
              onClick={() => select(opt)}
              aria-pressed={selected}
              className={`flex flex-col items-center gap-1 p-2 rounded-xl border transition-all cursor-pointer group ${
                selected
                  ? 'border-[#5baaff] bg-[#0f2240]'
                  : 'border-[#1a3a5c] bg-[#0a1628] hover:border-[#5baaff] hover:bg-[#0f2240]'
              }`}
            >
              {opt.id === ACT_CRAFT_BALL ? (
                <span className="w-10 h-10 flex items-center justify-center">
                  <span className="w-6 h-6 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.7)]" />
                </span>
              ) : opt.cutoutUrl ? (
                <img
                  src={opt.cutoutUrl}
                  alt={opt.title}
                  className="w-10 h-10 object-contain group-hover:scale-110 transition-transform drop-shadow-[0_0_6px_rgba(91,170,255,0.4)]"
                />
              ) : (
                <span className="w-10 h-10 flex items-center justify-center text-xl">✈️</span>
              )}
              <span className={`text-[9px] text-center leading-tight truncate w-full ${selected ? 'text-brand-300' : 'text-slate-400 group-hover:text-brand-300'}`}>
                {opt.title}
              </span>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}
