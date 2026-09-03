import { useState } from 'react'
import { motion } from 'framer-motion'
import Overlay from '../ui/Overlay'

export const SITE_URL = 'skywatch.academy'

// What the app tells a phone-only player about the desktop version.
//
// It is a note, not a link. The app is installed on a phone, so an anchor to the
// website opens a browser on that same phone and lands on the same games in a
// worse container than the app they are already holding: a button promising an
// upgrade that delivers a downgrade. The thing worth delivering here is the
// knowledge that a PC gives you something the phone cannot, so this stays in the
// app and hands over the address to type on a computer later.
//
// The joystick is the reason that actually lands. RTT, ACT and SMA read a real
// stick (utils/cbat/gamepad.js) and nothing on the CBAT menu says so, which
// makes it both news and the closest anyone gets to the real test setup.
//
// Deliberately claims nothing about the rest of the site. Briefs, community and
// case files are all behind settings flags that can be off, and a note that
// promises content the visitor then cannot find is worse than one that promises
// nothing.
export default function PlayOnPcNote({ onClose }) {
  const [copied, setCopied] = useState(false)

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`https://${SITE_URL}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be refused. The address is on screen either way,
      // so there is nothing to recover from and nothing worth alarming anyone
      // about — the button simply does not confirm.
    }
  }

  return (
    <Overlay
      zIndex={70}
      backdrop="rgba(8, 14, 30, 0.78)"
      lockBodyScroll
      onDismiss={onClose}
      className="backdrop-blur-sm flex items-center justify-center p-4"
      data-testid="play-on-pc-overlay"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1,    y: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="relative bg-surface-raised border border-slate-300 rounded-2xl shadow-2xl w-full max-w-sm"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-5 sm:p-6">
          <button
            aria-label="Close"
            onClick={onClose}
            className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 text-slate-600 hover:bg-slate-200"
          >
            ×
          </button>

          <h2 className="text-xl font-extrabold text-brand-700 pr-8">Play on a PC</h2>

          <p className="mt-3 text-sm leading-relaxed text-slate-700">
            SkyWatch runs in any desktop browser. Sign in with the same account and
            your scores carry across.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-slate-700">
            RTT, ACT and SMA read a real joystick on a computer, which is the closest
            setup to the actual test. The busier games like FLAG and CUT also get a
            lot more room on a big screen.
          </p>

          <p
            data-testid="play-on-pc-url"
            className="mt-4 text-center intel-mono text-base font-bold text-brand-600 break-all"
          >
            {SITE_URL}
          </p>

          <button
            onClick={copyLink}
            data-testid="play-on-pc-copy"
            className="mt-4 w-full px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-bold text-sm hover:bg-slate-100 transition-colors"
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>
          <button
            onClick={onClose}
            className="mt-2 w-full px-4 py-2.5 rounded-xl bg-brand-600 text-white font-bold text-sm hover:brightness-110"
          >
            Got it
          </button>
        </div>
      </motion.div>
    </Overlay>
  )
}
