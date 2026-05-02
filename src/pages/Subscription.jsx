import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { isNative } from '../utils/isNative'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { useAppSettings } from '../context/AppSettingsContext'
import { CATEGORIES, CATEGORY_ICONS } from '../data/mockData'
import SEO from '../components/SEO'

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000'

// ── Helpers ───────────────────────────────────────────────────────────────
function tierEffective(user) {
  if (!user) return 'free'
  if (user.subscriptionTier === 'trial') {
    return user.isTrialActive ? 'trial' : 'free'
  }
  return user.subscriptionTier ?? 'free'
}

function trialTimeLeft(user) {
  if (!user?.trialStartDate) return { days: 0, hours: 0, ms: 0 }
  const end = new Date(user.trialStartDate)
  end.setDate(end.getDate() + (user.trialDurationDays || 5))
  const ms   = Math.max(0, end - Date.now())
  const days  = Math.floor(ms / 86_400_000)
  const hours = Math.floor((ms % 86_400_000) / 3_600_000)
  return { days, hours, ms }
}

function trialTimeLabel({ days, hours, ms }) {
  if (ms === 0)               return 'Trial expired'
  if (days === 0 && hours === 0) return 'Less than 1 hour remaining'
  const parts = []
  if (days  > 0) parts.push(`${days} day${days   !== 1 ? 's' : ''}`)
  if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`)
  return `${parts.join(' ')} remaining`
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
function TierCard({ tier, isCurrent, delay, ctaButton }) {
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
      <div className="mt-4">{ctaButton}</div>
    </motion.div>
  )
}

// ── CTA button helpers ────────────────────────────────────────────────────
function CurrentPlanBadge() {
  return (
    <div className="w-full py-2.5 rounded-xl bg-emerald-100 text-emerald-700 font-bold text-sm text-center">
      ✓ Current Plan
    </div>
  )
}

function NativeCopyLink({ copied, onCopy }) {
  return (
    <div className="text-center">
      <p className="text-xs text-slate-500 mb-2">Subscribe at</p>
      <p className="text-sm font-bold text-brand-600 mb-3">skywatch.academy/subscribe</p>
      <button
        onClick={onCopy}
        className="w-full py-2.5 rounded-xl font-bold text-sm bg-brand-600 hover:bg-brand-700 text-white transition-colors"
      >
        {copied ? '✓ Copied!' : 'Copy Link'}
      </button>
    </div>
  )
}

function ActionButton({ label, onClick, disabled = false, loading = false, variant = 'primary' }) {
  const base = 'w-full py-2.5 rounded-xl font-bold text-sm transition-colors'
  const styles = {
    primary:  'bg-brand-600 hover:bg-brand-700 text-white disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed',
    gold:     'bg-amber-500 hover:bg-amber-600 text-white disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed',
    outline:  'border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed',
    disabled: 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200',
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`${base} ${styles[variant]}`}
    >
      {loading ? 'Loading…' : label}
    </button>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────
export default function Subscription() {
  const { user, refreshUser, apiFetch } = useAuth()
  const { settings, loading }      = useAppSettings()
  const navigate                   = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [actionLoading, setActionLoading] = useState(false)
  const [banner, setBanner]               = useState(null) // { type: 'success'|'error'|'info', msg }
  const [copied, setCopied]               = useState(false)

  const SUBSCRIBE_URL = 'https://skywatch.academy/subscribe'
  function copyLink() {
    navigator.clipboard.writeText(SUBSCRIBE_URL).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }

  const appTrialExpired   = isNative && user?.trialStartDate && user?.trialSource === 'app' && !user?.isTrialActive
  const appTrialAvailable = isNative && !user?.trialStartDate

  const effective  = tierEffective(user)
  const timeLeft   = effective === 'trial' ? trialTimeLeft(user) : { days: 0, hours: 0, ms: 0 }
  const trialDays  = settings?.trialDurationDays ?? 5

  // Handle Stripe redirect return
  useEffect(() => {
    const stripeParam = searchParams.get('stripe')
    if (stripeParam === 'success') {
      setBanner({ type: 'success', msg: 'Payment successful! Your subscription is being activated — this may take a few seconds.' })
      // Refresh user so tier updates if webhook has already fired
      refreshUser()
      setSearchParams({})
    } else if (stripeParam === 'cancelled') {
      setBanner({ type: 'info', msg: 'Checkout cancelled. No payment was taken.' })
      setSearchParams({})
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Native app trial activation (no Stripe) ─────────────────────────
  async function activateAppTrial() {
    if (!user) { navigate('/login'); return }
    setActionLoading(true)
    setBanner(null)
    try {
      const res = await apiFetch(`${API}/api/auth/activate-trial`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to activate trial')
      refreshUser()
      setBanner({ type: 'success', msg: 'Your 3-day free trial is now active!' })
    } catch (err) {
      setBanner({ type: 'error', msg: err.message })
    } finally {
      setActionLoading(false)
    }
  }

  // ── Stripe actions ───────────────────────────────────────────────────
  async function startCheckout(tier, trial = false) {
    if (!user) { navigate('/login'); return }
    setActionLoading(true)
    setBanner(null)
    try {
      const res = await apiFetch(`${API}/api/stripe/create-checkout-session`, {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ tier, trial }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to start checkout')
      window.location.href = data.url
    } catch (err) {
      setBanner({ type: 'error', msg: err.message })
      setActionLoading(false)
    }
  }

  async function openPortal() {
    if (!user) { navigate('/login'); return }
    setActionLoading(true)
    setBanner(null)
    try {
      const res = await apiFetch(`${API}/api/stripe/create-portal-session`, {
        method:      'POST',
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to open portal')
      window.location.href = data.url
    } catch (err) {
      setBanner({ type: 'error', msg: err.message })
      setActionLoading(false)
    }
  }

  // ── Derive CTA for each tier ─────────────────────────────────────────
  function getCtaButton(tierId, isCurrent) {
    if (isCurrent && !user?.stripeSubscriptionId) return <CurrentPlanBadge />

    if (!user) {
      return <ActionButton label="Sign In to Continue" disabled variant="disabled" />
    }

    if (tierId === 'free') {
      if (user.stripeSubscriptionId) {
        return <ActionButton label="Manage Subscription" onClick={openPortal} loading={actionLoading} variant="outline" />
      }
      return <CurrentPlanBadge />
    }

    if (tierId === 'trial') {
      if (isCurrent) return <CurrentPlanBadge />
      if (user.trialStartDate) {
        return <ActionButton label="Trial Already Used" disabled variant="disabled" />
      }
      if (['silver', 'gold'].includes(effective)) {
        return <ActionButton label="Not Available" disabled variant="disabled" />
      }
      if (appTrialAvailable) {
        return (
          <ActionButton
            label="Start 3-Day Free Trial"
            onClick={activateAppTrial}
            loading={actionLoading}
            variant="primary"
          />
        )
      }
      return (
        <ActionButton
          label={`Start ${trialDays}-Day Free Trial`}
          onClick={() => startCheckout('silver', true)}
          loading={actionLoading}
          variant="primary"
        />
      )
    }

    if (tierId === 'silver') {
      if (isCurrent) {
        return user.stripeSubscriptionId
          ? <ActionButton label="Manage Subscription" onClick={openPortal} loading={actionLoading} variant="outline" />
          : <CurrentPlanBadge />
      }
      if (isNative) {
        return <NativeCopyLink copied={copied} onCopy={copyLink} />
      }
      if (effective === 'gold' && user.stripeSubscriptionId) {
        return <ActionButton label="Switch to Silver" onClick={openPortal} loading={actionLoading} variant="outline" />
      }
      return (
        <ActionButton
          label="Upgrade to Silver — £4.99/mo"
          onClick={() => startCheckout('silver', false)}
          loading={actionLoading}
          variant="primary"
        />
      )
    }

    if (tierId === 'gold') {
      if (isCurrent) {
        return user.stripeSubscriptionId
          ? <ActionButton label="Manage Subscription" onClick={openPortal} loading={actionLoading} variant="outline" />
          : <CurrentPlanBadge />
      }
      if (isNative) {
        return <NativeCopyLink copied={copied} onCopy={copyLink} />
      }
      if (user.stripeSubscriptionId) {
        return <ActionButton label="Upgrade to Gold — £8.99/mo" onClick={openPortal} loading={actionLoading} variant="gold" />
      }
      return (
        <ActionButton
          label="Upgrade to Gold — £8.99/mo"
          onClick={() => startCheckout('gold', false)}
          loading={actionLoading}
          variant="gold"
        />
      )
    }

    return null
  }

  // ── Derive category sets from live settings ───────────────────────────
  const freeCategories         = settings?.freeCategories   ?? []
  const silverCategories       = settings?.silverCategories ?? []
  const goldOnlyCategories     = CATEGORIES.filter(c => !silverCategories.includes(c))
  const silverExtraCategories  = silverCategories.filter(c => !freeCategories.includes(c))

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
        '✓ Basic recall access',
        '✓ Airstars & level progression',
        '✗ Silver & Gold subjects locked',
        '✗ Advanced recall difficulty locked',
      ],
      categorySection: freeCategorySection,
    },
    {
      id: 'trial',
      label: 'Trial',
      price: '£0',
      period: isNative ? '3 days free, then subscribe at skywatch.academy' : `${trialDays} days free, then £4.99/mo`,
      badge: 'Try Free',
      features: [
        '✓ Full Silver access for the trial period',
        '✓ All Silver subject areas included',
        '✓ Advanced recall difficulty',
        isNative ? '✓ 3-day free trial — no card required' : `✓ ${trialDays}-day free trial — card required`,
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
        '✓ Advanced recall difficulty',
        '✗ Gold subjects locked',
      ],
      categorySection: trialSilverCategorySection,
    },
    {
      id: 'gold',
      label: 'Gold',
      price: '£8.99',
      period: 'per month',
      badge: 'Full Access',
      features: [
        '✓ Everything in Silver',
        '✓ Access to ALL subject areas',
        '✓ All intel briefs & quizzes',
      ],
      categorySection: goldCategorySection,
    },
  ]

  return (
    <div className="max-w-lg mx-auto">
      <SEO title="Subscribe" description="Upgrade your SkyWatch plan for full access to all briefs and games." />

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

      {/* Native app — expired trial banner */}
      {appTrialExpired && !banner && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl p-4 mb-5 border bg-amber-50 border-amber-200 text-amber-800"
        >
          <p className="font-bold text-sm mb-1">Your 3-day trial has ended</p>
          <p className="text-xs leading-relaxed">
            You've unlocked an additional 2 days free — no charge until your trial ends.
            Subscribe at <span className="font-bold">skywatch.academy/subscribe</span>
          </p>
          <button
            onClick={copyLink}
            className="mt-3 w-full py-2 rounded-xl font-bold text-sm bg-amber-500 hover:bg-amber-600 text-white transition-colors"
          >
            {copied ? '✓ Copied!' : 'Copy Link'}
          </button>
        </motion.div>
      )}

      {/* Stripe return banner */}
      {banner && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className={`rounded-2xl p-4 mb-5 text-sm font-medium border
            ${banner.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
              banner.type === 'error'   ? 'bg-red-50 border-red-200 text-red-700' :
                                          'bg-brand-50 border-brand-200 text-brand-700'}`}
        >
          {banner.msg}
          <button onClick={() => setBanner(null)} className="float-right opacity-50 hover:opacity-100">✕</button>
        </motion.div>
      )}

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
              Current plan:{' '}
              <span className={`font-extrabold
                ${effective === 'gold' ? 'text-amber-600' : effective === 'silver' ? 'text-brand-600' : effective === 'trial' ? 'text-amber-600' : 'text-slate-600'}`}>
                {effective}
              </span>
            </p>
            {effective === 'trial' && (
              <p className="text-xs text-amber-600 mt-0.5">⏳ {trialTimeLabel(timeLeft)}</p>
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
          {user.stripeSubscriptionId && (
            <button
              onClick={openPortal}
              disabled={actionLoading}
              className="text-xs font-semibold text-brand-600 hover:text-brand-800 whitespace-nowrap disabled:opacity-50"
            >
              {actionLoading ? 'Loading…' : 'Manage'}
            </button>
          )}
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
              ctaButton={getCtaButton(tier.id, isCurrent)}
            />
          )
        })}
      </div>

      {/* Footer note */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center mb-6">
        <p className="text-xs text-slate-500 leading-relaxed">
          Cancel anytime from your subscription settings. Payments are processed securely by Stripe.
        </p>
      </div>

    </div>
  )
}
