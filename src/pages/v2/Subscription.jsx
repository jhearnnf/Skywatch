import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../../context/AuthContext'
import { useAppSettings } from '../../context/AppSettingsContext'
import { CATEGORIES, CATEGORY_ICONS } from '../../data/mockData'

// ── Helpers ───────────────────────────────────────────────────────────────
function tierEffective(user) {
  if (!user) return 'free'
  if (user.subscriptionTier === 'trial') {
    return user.isTrialActive ? 'trial' : 'free'
  }
  return user.subscriptionTier ?? 'free'
}

function trialDaysLeft(user) {
  if (!user?.trialStartDate) return 0
  const end = new Date(user.trialStartDate)
  end.setDate(end.getDate() + (user.trialDurationDays || 5))
  return Math.max(0, Math.ceil((end - Date.now()) / 86_400_000))
}

// ── Category tag pill ─────────────────────────────────────────────────────
function CategoryTag({ name, dimmed = false }) {
  const icon = CATEGORY_ICONS[name] ?? '📄'
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border
      ${dimmed
        ? 'bg-slate-50 border-slate-200 text-slate-400'
        : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
      <span>{icon}</span>{name}
    </span>
  )
}

function SkeletonTags() {
  return (
    <div className="flex flex-wrap gap-1.5 mt-3">
      {[48, 64, 56, 52, 60].map(w => (
        <div key={w} className="h-5 rounded-full bg-slate-100 animate-pulse" style={{ width: w }} />
      ))}
    </div>
  )
}

// ── Tier card ─────────────────────────────────────────────────────────────
function TierCard({ tier, isCurrent, delay }) {
  const isGold   = tier.id === 'gold'
  const isTrial  = tier.id === 'trial'
  const isSilver = tier.id === 'silver'

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className={`rounded-2xl border p-5 card-shadow relative overflow-hidden
        ${isGold   ? 'border-amber-300 bg-gradient-to-br from-amber-50 to-amber-100/40' :
          isSilver  ? 'border-brand-300 bg-brand-50/30' :
          isTrial   ? 'border-amber-200 bg-amber-50/40' :
                      'border-slate-200 bg-surface'}
        ${isCurrent ? 'ring-2 ring-offset-1 ring-brand-400' : ''}`}
    >
      {/* Badge */}
      {tier.badge && (
        <span className={`absolute top-3 right-3 text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider
          ${isGold ? 'bg-amber-400 text-white' : isTrial ? 'bg-amber-500 text-white' : 'bg-brand-600 text-white'}`}>
          {tier.badge}
        </span>
      )}

      {/* Title + price */}
      <div className="mb-4">
        <p className={`text-lg font-extrabold
          ${isGold ? 'text-amber-700' : isSilver ? 'text-brand-700' : isTrial ? 'text-amber-600' : 'text-slate-800'}`}>
          {tier.label}
        </p>
        <div className="flex items-baseline gap-1 mt-0.5">
          <span className="text-2xl font-extrabold text-slate-900">{tier.price}</span>
          <span className="text-xs text-slate-400">{tier.period}</span>
        </div>
      </div>

      {/* Bullet features */}
      <ul className="space-y-1.5 mb-4">
        {tier.features.map((f, fi) => (
          <li key={fi} className={`text-sm ${f.startsWith('✗') ? 'text-slate-400' : 'text-slate-700'}`}>
            {f}
          </li>
        ))}
      </ul>

      {/* Subject area tags */}
      {tier.categorySection}

      {/* CTA */}
      <div className="mt-4">
        {isCurrent ? (
          <div className="w-full py-2.5 rounded-xl bg-emerald-100 text-emerald-700 font-bold text-sm text-center">
            ✓ Current Plan
          </div>
        ) : (
          <button
            disabled
            className="w-full py-2.5 rounded-xl font-bold text-sm cursor-not-allowed bg-slate-100 text-slate-400 border border-slate-200"
            title="Payments coming soon"
          >
            {tier.id === 'free' ? 'Downgrade' : 'Upgrade'} — Coming Soon
          </button>
        )}
      </div>
    </motion.div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────
export default function Subscription() {
  const { user }             = useAuth()
  const { settings, loading } = useAppSettings()

  const navigate   = useNavigate()
  const effective  = tierEffective(user)
  const daysLeft   = effective === 'trial' ? trialDaysLeft(user) : 0
  const trialDays  = settings?.trialDurationDays ?? 5

  // Derive category sets from live settings
  const freeCategories   = settings?.freeCategories   ?? []
  const silverCategories = settings?.silverCategories ?? []
  const goldOnlyCategories = CATEGORIES.filter(c => !silverCategories.includes(c))
  const silverExtraCategories = silverCategories.filter(c => !freeCategories.includes(c))

  // ── Category sections for each tier ────────────────────────────────────
  const freeCategorySection = (
    <div className="border-t border-slate-100 pt-3">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Included subjects</p>
      {loading ? <SkeletonTags /> : (
        <div className="flex flex-wrap gap-1.5">
          {freeCategories.map(c => <CategoryTag key={c} name={c} />)}
          {goldOnlyCategories.concat(silverExtraCategories).map(c => <CategoryTag key={c} name={c} dimmed />)}
        </div>
      )}
    </div>
  )

  const trialSilverCategorySection = (
    <div className="border-t border-amber-100 pt-3">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Included subjects</p>
      {loading ? <SkeletonTags /> : (
        <div className="flex flex-wrap gap-1.5">
          {silverCategories.map(c => <CategoryTag key={c} name={c} />)}
          {goldOnlyCategories.map(c => <CategoryTag key={c} name={c} dimmed />)}
        </div>
      )}
    </div>
  )

  const goldCategorySection = (
    <div className="border-t border-amber-200 pt-3">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">All subjects included</p>
      {loading ? <SkeletonTags /> : (
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map(c => <CategoryTag key={c} name={c} />)}
        </div>
      )}
    </div>
  )

  const TIERS = [
    {
      id: 'free',
      label: 'Free',
      price: '£0',
      period: 'forever',
      features: [
        '✓ Read intel briefs in free subjects',
        '✓ Basic quiz access',
        '✓ Aircoins & level progression',
        '✗ Silver & Gold subjects locked',
        '✗ Advanced quiz difficulty locked',
      ],
      categorySection: freeCategorySection,
    },
    {
      id: 'trial',
      label: 'Trial',
      price: '£0',
      period: `${trialDays} days free`,
      badge: 'Try Free',
      features: [
        '✓ Full Silver access for the trial period',
        '✓ All Silver subject areas included',
        '✓ Advanced quiz difficulty',
        `✓ ${trialDays}-day limited access`,
        '✗ Gold subjects locked',
      ],
      categorySection: trialSilverCategorySection,
    },
    {
      id: 'silver',
      label: 'Silver',
      price: '£4.99',
      period: 'per month',
      badge: 'Popular',
      features: [
        '✓ Everything in Free',
        '✓ Access to all Silver subjects',
        '✓ Advanced quiz difficulty',
        '✓ Priority leaderboard visibility',
        '✗ Gold subjects locked',
      ],
      categorySection: trialSilverCategorySection,
    },
    {
      id: 'gold',
      label: 'Gold',
      price: '£9.99',
      period: 'per month',
      badge: 'Full Access',
      features: [
        '✓ Everything in Silver',
        '✓ Access to ALL subject areas',
        '✓ All intel briefs & quizzes',
        '✓ Exclusive Gold rank badge',
        '✓ Early access to new content',
      ],
      categorySection: goldCategorySection,
    },
  ]

  return (
    <div className="max-w-lg mx-auto">

      {/* Back */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-5 transition-colors"
      >
        ← Back
      </button>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-slate-900">Subscription Plans</h1>
        <p className="text-sm text-slate-500 mt-1">Unlock more subject areas and advanced features.</p>
      </div>

      {/* Current plan banner */}
      {user && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className={`rounded-2xl p-4 mb-6 border flex items-center gap-3
            ${effective === 'gold'   ? 'bg-amber-50 border-amber-200' :
              effective === 'silver' ? 'bg-brand-50 border-brand-200' :
              effective === 'trial'  ? 'bg-amber-50 border-amber-200' :
                                       'bg-slate-50 border-slate-200'}`}
        >
          <span className="text-2xl">
            {effective === 'gold' ? '🥇' : effective === 'silver' ? '🥈' : effective === 'trial' ? '⏳' : '🆓'}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-800 capitalize">
              Current plan: <span className={`font-extrabold
                ${effective === 'gold' ? 'text-amber-600' : effective === 'silver' ? 'text-brand-600' : effective === 'trial' ? 'text-amber-600' : 'text-slate-600'}`}>
                {effective}
              </span>
            </p>
            {effective === 'trial' && (
              <p className="text-xs text-amber-600 mt-0.5">
                {daysLeft} day{daysLeft !== 1 ? 's' : ''} remaining on trial
              </p>
            )}
            {effective === 'free' && user.subscriptionTier === 'trial' && (
              <p className="text-xs text-slate-500 mt-0.5">Your trial has expired</p>
            )}
            {(effective === 'silver' || effective === 'gold') && user.subscriptionStartDate && (
              <p className="text-xs text-slate-500 mt-0.5">
                Active since {new Date(user.subscriptionStartDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            )}
          </div>
        </motion.div>
      )}

      {/* Tier cards */}
      <div className="space-y-4 mb-6">
        {TIERS.map((tier, i) => {
          const isCurrent =
            effective === tier.id ||
            (effective === 'trial' && tier.id === 'trial')

          return (
            <TierCard
              key={tier.id}
              tier={tier}
              isCurrent={isCurrent}
              delay={i * 0.07}
            />
          )
        })}
      </div>

      {/* Footer note */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center mb-6">
        <p className="text-xs text-slate-500 leading-relaxed">
          Online payments are coming soon. To upgrade your plan in the meantime,{' '}
          <a href="mailto:support@skywatch.app" className="text-brand-600 font-semibold hover:underline">
            contact support
          </a>
          .
        </p>
      </div>

    </div>
  )
}
