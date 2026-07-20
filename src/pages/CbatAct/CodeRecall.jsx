import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { CODE_DIGITS } from '../../utils/cbat/actAudio'

// End-of-round-5 recall pad. The player types back the 7-digit code they were
// read a quarter of the way through the round.
//
// The pad shows 1–9 only, matching CODE_DIGITS — there is no zero clip, and a
// dead 0 key would tell the player which digit can never appear.
//
// Lives in its own file rather than inside CbatAct's render: a component
// defined during another component's render remounts its whole subtree every
// render, which wipes the entered digits on each keystroke.
export default function CodeRecall({ codeLength = 7, onSubmit }) {
  const [entered, setEntered] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const full = entered.length >= codeLength

  const pushDigit = useCallback((d) => {
    setEntered(prev => (prev.length >= codeLength ? prev : prev + d))
  }, [codeLength])

  const backspace = useCallback(() => {
    setEntered(prev => prev.slice(0, -1))
  }, [])

  // One shot — a double-tap must not score the round twice.
  const submit = useCallback(() => {
    if (submitted || entered.length !== codeLength) return
    setSubmitted(true)
    onSubmit(entered)
  }, [submitted, entered, codeLength, onSubmit])

  // Physical keyboard for desktop players. Enter only fires once the code is
  // the right length, so a premature tap can't throw the answer away.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (submitted) return
      if (CODE_DIGITS.includes(e.key)) { pushDigit(e.key); e.preventDefault(); return }
      if (e.key === 'Backspace') { backspace(); e.preventDefault(); return }
      if (e.key === 'Enter' && entered.length === codeLength) { submit(); e.preventDefault() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pushDigit, backspace, submit, entered, codeLength, submitted])

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-md bg-[#0a1628] border border-[#1a3a5c] rounded-xl p-6 text-center"
      data-testid="act-code-recall"
    >
      <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-1">Memory check</p>
      <p className="text-xl font-extrabold text-white mb-1">Enter the code</p>
      <p className="text-xs text-slate-500 mb-5">The {codeLength}-digit code you were read during the round.</p>

      {/* Entered digits — one slot per digit so the player can see their place */}
      <div className="flex justify-center gap-1.5 mb-5">
        {Array.from({ length: codeLength }).map((_, i) => (
          <div
            key={i}
            className={`w-9 h-12 max-[600px]:w-8 max-[600px]:h-11 flex items-center justify-center rounded-lg border font-mono text-xl font-extrabold ${
              entered[i]
                ? 'bg-[#0f2240] border-brand-400 text-brand-300'
                : 'bg-[#060e1a] border-[#1a3a5c] text-slate-600'
            }`}
          >
            {entered[i] || '·'}
          </div>
        ))}
      </div>

      {/* 1–9 grid */}
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {CODE_DIGITS.map((d) => (
          <button
            key={d}
            onClick={() => pushDigit(d)}
            disabled={full || submitted}
            className="py-3.5 bg-[#0a1628] border border-[#1a3a5c] hover:bg-[#0f2240] hover:border-brand-400 disabled:opacity-40 disabled:cursor-not-allowed text-[#ddeaf8] font-mono text-lg font-bold rounded-lg transition-all cursor-pointer"
          >
            {d}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          onClick={backspace}
          disabled={entered.length === 0 || submitted}
          className="flex-1 py-3 bg-transparent border border-slate-300/30 hover:border-slate-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-600 font-bold uppercase tracking-wider text-xs rounded-lg transition-colors cursor-pointer"
        >
          Delete
        </button>
        <button
          onClick={submit}
          disabled={!full || submitted}
          className="flex-[2] py-3 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-700/30 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-extrabold uppercase tracking-wider text-xs rounded-lg transition-colors cursor-pointer"
        >
          Confirm
        </button>
      </div>
    </motion.div>
  )
}
