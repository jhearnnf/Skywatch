import { Link } from 'react-router-dom'

// variant: 'page' (full centred panel) | 'inline' (compact card)
export default function UpgradePrompt({ category, variant = 'page' }) {
  const isPage = variant === 'page'
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
      <Link
        to="/subscribe"
        className="inline-block bg-brand-600 hover:bg-brand-700 text-white font-bold px-6 py-3 rounded-2xl text-sm transition-colors"
        style={{ boxShadow: '0 0 20px rgba(91,170,255,0.25)' }}
      >
        View Subscription Options
      </Link>
    </div>
  )
}
