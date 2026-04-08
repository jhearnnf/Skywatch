import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import SEO from '../components/SEO'

const SHARE_URL = 'https://skywatch.academy'

export default function Share() {
  const [isCopied, setCopied] = useState(false)

  const copyLink = () => {
    navigator.clipboard.writeText(SHARE_URL).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <SEO title="Share SkyWatch" description="Share SkyWatch Academy with friends — scan the QR code or copy the link." />
      <div className="max-w-md mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-surface rounded-2xl border border-slate-200 p-6 card-shadow"
        >
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Share SkyWatch</p>
          <p className="text-sm text-slate-400 mb-5">Scan the QR code or copy the link below.</p>

          <div className="inline-flex p-4 bg-white rounded-2xl border border-slate-100">
            <QRCodeSVG
              value={SHARE_URL}
              size={200}
              bgColor="#ffffff"
              fgColor="#0c1829"
              level="M"
            />
          </div>

          <p className="mt-4 text-sm font-semibold text-brand-600 intel-mono">{SHARE_URL.replace('https://', '')}</p>

          <button
            onClick={copyLink}
            className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors"
          >
            {isCopied ? '✓ Copied!' : 'Copy Link'}
          </button>

          <div className="mt-5 pt-4 border-t border-slate-100">
            <Link
              to="/profile"
              className="text-sm font-semibold text-slate-400 hover:text-slate-600 transition-colors"
            >
              ← Back to Profile
            </Link>
          </div>
        </motion.div>
      </div>
    </>
  )
}
