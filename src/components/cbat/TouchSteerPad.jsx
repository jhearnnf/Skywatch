import { motion, AnimatePresence } from 'framer-motion'

// Below-canvas drag surface for touch devices, so the player doesn't have to
// drag on top of the gameplay (which would obscure it with a finger). While
// idle (no active drag), a slow swipe cue animates so first-time users
// discover the gesture.
//
// Built for ACT (moved here from CbatAct.jsx; ACT's defaults are unchanged)
// and shared with the Instruments Practise drill, which flies on both axes:
//   cue        'horizontal' sweeps the dot left and right (ACT); 'both' traces
//              a small loop, for a pad that pitches as well as banks
//   label      the words under the cue
//   className  size and spacing (ACT's h-36 mt-3 by default)
//   children   drawn on top: the drill's live knob and its first-run prompt

const CUE = {
  horizontal: { x: [-44, 44, -44] },
  both: { x: [-34, 0, 34, 0, -34], y: [0, -22, 0, 22, 0] },
}

export default function TouchSteerPad({
  onPointerDown, onPointerMove, onPointerUp, isDragging,
  label = 'Drag to steer',
  ariaLabel = 'Touch steering pad — drag to steer',
  cue = 'horizontal',
  className = 'h-36 mt-3',
  padRef,
  children,
  ...rest
}) {
  return (
    <div
      ref={padRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={`relative w-full bg-game-panel border border-game-line rounded-xl overflow-hidden ${className}`}
      style={{ touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}
      aria-label={ariaLabel}
      role="application"
      {...rest}
    >
      <AnimatePresence>
        {!isDragging && (
          <motion.div
            key="hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
          >
            <motion.div
              animate={CUE[cue] ?? CUE.horizontal}
              transition={{ duration: cue === 'both' ? 3.2 : 2.4, ease: 'easeInOut', repeat: Infinity }}
              className="flex items-center gap-2"
            >
              <motion.div
                animate={{ opacity: [0.55, 1, 0.55], scale: [0.92, 1.04, 0.92] }}
                transition={{ duration: 2.4, ease: 'easeInOut', repeat: Infinity }}
                className="w-9 h-9 rounded-full bg-brand-400/25 border-2 border-brand-300 shadow-[0_0_18px_rgba(91,170,255,0.45)]"
              />
            </motion.div>
            <p className="mt-3 text-[11px] uppercase tracking-widest text-slate-400">{label}</p>
          </motion.div>
        )}
      </AnimatePresence>
      {children}
    </div>
  )
}
