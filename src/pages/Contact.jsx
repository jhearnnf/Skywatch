import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import SEO from '../components/SEO'

const CONTACT_EMAIL = 'support@skywatch.placeholder'

export default function Contact() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-lg mx-auto px-4 py-12"
    >
      <SEO title="Contact" description="Get in touch with the SkyWatch team." />
      <div className="text-center mb-10">
        <div className="text-5xl mb-4">📡</div>
        <h1 className="text-3xl font-extrabold text-slate-900 mb-2">Contact</h1>
        <p className="text-slate-500">Get in touch with the SkyWatch development team.</p>
      </div>

      <div className="bg-surface border border-slate-200 rounded-2xl p-6 space-y-6">
        <div>
          <p className="text-sm font-semibold text-slate-600 uppercase tracking-wide mb-1">Email</p>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="text-brand-600 hover:text-brand-700 font-semibold text-lg transition-colors break-all"
          >
            {CONTACT_EMAIL}
          </a>
          <p className="text-xs text-slate-400 mt-1">We aim to respond within 2 business days.</p>
        </div>

        <div className="border-t border-slate-200 pt-5">
          <p className="text-sm text-slate-500 leading-relaxed">
            For account issues such as manual password resets, please include your registered email
            address in your message so we can locate your account.
          </p>
        </div>
      </div>

      <div className="mt-6 text-center">
        <Link
          to="/home"
          className="text-sm text-slate-500 hover:text-slate-700 font-semibold transition-colors"
        >
          ← Back to Home
        </Link>
      </div>
    </motion.div>
  )
}
