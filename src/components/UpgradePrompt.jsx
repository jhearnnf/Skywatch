import { useState } from 'react'
import { Link } from 'react-router-dom'
import { isNative } from '../utils/isNative'

const SUBSCRIBE_URL = 'https://skywatch.academy/subscribe'

// variant: 'page' (full centred panel) | 'inline' (compact card)
export default function UpgradePrompt({ category, variant = 'page' }) {
  const isPage = variant === 'page'
  const [copied, setCopied] = useState(false)

  function copyLink() {
    navigator.clipboard.writeText(SUBSCRIBE_URL).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }

  return (
    <div className={isPage
      ? 'flex flex-col items-center justify-center min-h-[60vh] text-center px-6'
      : 'bg-surface border border-slate-200 rounded-2xl p-6 text-center card-shadow'
    }>
      <div className="text-4xl mb-3">🔒</div>
      <h2 className="text-xl font-extrabold text-slate-900 mb-2">
        {category ? `${category} is locked` : 'Upgrade required'}
      </h2>
      <p className="text-sm text-slate-500 mb-6 max-w-xs mx-auto">
        {category
          ? `Access to ${category} briefs and quizzes requires a Silver or Gold subscription.`
          : 'This content requires a higher subscription tier.'}
      </p>

      {isNative ? (
        <div className="flex flex-col items-center gap-3">
          <p className="text-xs text-slate-400">Subscribe at</p>
          <p className="text-sm font-bold text-brand-600">skywatch.academy/subscribe</p>
          <button
            onClick={copyLink}
            className="inline-block bg-brand-600 hover:bg-brand-700 text-white font-bold px-6 py-3 rounded-2xl text-sm transition-colors"
            style={{ boxShadow: '0 0 20px rgba(91,170,255,0.25)' }}
          >
            {copied ? '✓ Copied!' : 'Copy Link'}
          </button>
        </div>
      ) : (
        <Link
          to="/subscribe"
          className="inline-block bg-brand-600 hover:bg-brand-700 text-white font-bold px-6 py-3 rounded-2xl text-sm transition-colors"
          style={{ boxShadow: '0 0 20px rgba(91,170,255,0.25)' }}
        >
          View Subscription Options
        </Link>
      )}
    </div>
  )
}
