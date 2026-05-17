import { motion } from 'framer-motion'
import CbatBg from './_cbatBg'

const TILES = [
  { e: '🎯', l: 'TARGET'  }, { e: '📡', l: 'ANT'      },
  { e: '🔣', l: 'SYMBOLS' }, { e: '🧩', l: 'CODE'     },
  { e: '📐', l: 'ANGLES'  }, { e: '🛫', l: 'INSTR'    },
  { e: '🗺️', l: 'TURN'    }, { e: '🚩', l: 'FLAG'     },
  { e: '🧮', l: '2D VIS'  }, { e: '🛩️', l: 'DPT'      },
  { e: '🎧', l: 'ACT'     }, { e: '🎯', l: '+more'    },
]

export default function CbatOverviewScene() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <CbatBg amber />
      <div className="absolute inset-0 flex items-center justify-center pt-16 sm:pt-24">
        <div className="grid grid-cols-4 gap-1.5 max-w-md w-full px-6">
          {TILES.map((t, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, scale: 0.7, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="rounded-lg flex flex-col items-center justify-center gap-1"
              style={{
                aspectRatio: '1 / 1',
                background: 'rgba(251,191,36,0.08)',
                border: '1px solid rgba(251,191,36,0.35)',
                boxShadow: '0 0 12px rgba(251,191,36,0.12)',
              }}
            >
              <span style={{ fontSize: 18 }}>{t.e}</span>
              <span className="intel-mono" style={{ fontSize: 7, color: '#fde68a', fontWeight: 800, letterSpacing: '0.08em' }}>{t.l}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  )
}
