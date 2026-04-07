import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { playSound } from '../utils/sound'

/**
 * Full-screen "MISSION DETECTED" interstitial shown after an Aircraft brief is completed
 * and the spawn-check returns spawn: true.
 *
 * Props:
 *   aircraftBriefId  — ID of the aircraft brief spawning this game
 *   aircraftTitle    — display name of the aircraft
 *   mediaUrl         — cover image URL (may be null)
 *   onDismiss        — called when user declines / closes
 */
export default function MissionDetectedModal({ aircraftBriefId, aircraftTitle, mediaUrl, onAccept, onDismiss }) {
  const navigate = useNavigate()

  // Prevent body scroll while modal is open + play stinger
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    playSound('where_aircraft_mission_detected')
    return () => { document.body.style.overflow = '' }
  }, [])

  function handleAccept() {
    onAccept?.()
    navigate(`/wheres-that-aircraft/${aircraftBriefId}`)
  }

  return (
    <AnimatePresence>
      <motion.div
        key="mission-bg"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9999] bg-slate-950/95 flex flex-col items-center justify-center p-6"
      >
        {/* Radar pulse ring */}
        <div className="relative mb-6">
          <motion.div
            animate={{ scale: [1, 1.6, 1], opacity: [0.4, 0, 0.4] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute inset-0 rounded-full bg-red-500"
            style={{ transform: 'scale(1.6)' }}
          />
          <div className="relative w-20 h-20 rounded-full bg-red-600/20 border-2 border-red-500 flex items-center justify-center">
            <span className="text-3xl">✈️</span>
          </div>
        </div>

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="text-center mb-2"
        >
          <p className="text-xs font-bold tracking-[0.3em] text-red-400 uppercase mb-2">
            ⚠ Mission Detected
          </p>
          <h1 className="text-3xl font-black text-white tracking-tight">
            WHERE'S THAT AIRCRAFT?
          </h1>
        </motion.div>

        {/* Aircraft image (if available) */}
        {mediaUrl && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.25 }}
            className="w-full max-w-sm rounded-2xl overflow-hidden border border-slate-700 mb-5 mt-4 aspect-video bg-slate-900"
          >
            <img src={mediaUrl} alt="Intel brief cover image" className="w-full h-full object-cover opacity-70" />
          </motion.div>
        )}

        {/* Briefing text */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="text-center mb-8 max-w-xs"
        >
          <p className="text-sm text-slate-300 leading-relaxed">
            An unidentified aircraft has entered the area. Intelligence briefings suggest you have the knowledge to identify it —
            and track it to its <span className="text-amber-400 font-semibold">home base on the map</span>.
          </p>
          <p className="text-xs text-slate-500 mt-2">Two-round mission · Earn Aircoins for each round</p>
        </motion.div>

        {/* CTA buttons */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="w-full max-w-xs space-y-3"
        >
          <button
            onClick={handleAccept}
            className="w-full py-4 bg-red-600 hover:bg-red-500 text-white font-black rounded-2xl text-lg tracking-wide transition-colors shadow-lg shadow-red-900/40"
          >
            Accept Mission →
          </button>
          <button
            onClick={onDismiss}
            className="w-full py-3 border border-slate-700 text-slate-400 hover:text-slate-200 font-semibold rounded-2xl text-sm transition-colors"
          >
            Decline — maybe later
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
