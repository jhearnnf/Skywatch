import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import SEO from '../components/SEO'
import { SLIM_APP } from '../utils/appMode'

// The donation page.
//
// PUBLIC, and that is the whole design of it. The thing being asked for is a
// gift, and putting a sign-up in front of a gift is the surest way not to
// receive one — the person most likely to give is often someone who has been
// using the CBAT games for weeks without ever making an account. Nothing on
// this page reads or writes anything that needs to know who you are. A signed-in
// donor is recognised by the server anyway (the session cookie rides along), so
// signing in buys a pre-filled receipt email and being taken off the post-game
// ask, and never gates anything.
//
// It also replaces a single fixed Stripe payment link. A payment link can only
// offer the one amount it was created with, which is why the old ask could say
// "£3" and nothing else. Here the amount is chosen first and the Checkout
// session is built for it (see backend/routes/stripe.js), so the range costs no
// setup in Stripe at all.

// Quick picks. Four is the most that stays scannable in one row on a phone, and
// the range has to open low: £3 is the amount the ask elsewhere on the site
// names, so landing here on anything higher would read as a bait and switch.
//
// The server has no matching list and does not need one: it validates a range,
// not a menu, so these can be changed here alone.
const PRESETS = [3, 5, 10, 20]

// Mirrors DONATION_MIN_PENCE / DONATION_MAX_PENCE. The server validates
// independently — this pair only exists so the page can say no before a
// pointless round trip, and so the hint text and the rule agree.
const MIN = 1
const MAX = 500

const money = (n) => (Number.isInteger(n) ? `£${n}` : `£${n.toFixed(2)}`)

// An id for this visit, so the admin donation funnel can pair "reached the page"
// with "pressed through to Stripe" and report a real conversion rate rather than
// two unrelated totals.
//
// sessionStorage, not localStorage: it lives for this browser tab and no longer.
// That is enough to stop a reload — or a bounce back from a cancelled Checkout —
// looking like a second person, and it deliberately leaves nothing behind on the
// device afterwards. A signed-in visitor never needs it at all; the server keys
// them by account and ignores whatever this returns.
//
// Wrapped because sessionStorage throws outright in some privacy modes, and a
// stat is never worth breaking the page for. Null simply means this visit goes
// uncounted.
const VISIT_KEY_STORAGE = 'skywatch:donate-visit'

function getVisitKey() {
  try {
    const existing = sessionStorage.getItem(VISIT_KEY_STORAGE)
    if (existing) return existing
    const key = (crypto.randomUUID?.() ?? `${Math.random()}${Math.random()}`).replace(/[^a-zA-Z0-9]/g, '')
    sessionStorage.setItem(VISIT_KEY_STORAGE, key)
    return key
  } catch {
    return null
  }
}

export default function Donate() {
  const { user, API, apiFetch } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const outcome = searchParams.get('donation')

  // `preset` and `custom` are two ways of answering one question, so exactly
  // one of them is live at a time: choosing a chip clears the box, typing in
  // the box clears the chips. Holding both and picking a winner later is how
  // you end up charging someone the figure they were not looking at.
  const [preset, setPreset] = useState(PRESETS[0])
  const [custom, setCustom] = useState('')
  const [busy,   setBusy]   = useState(false)
  const [error,  setError]  = useState('')

  // Tell the server someone is looking at this. It is the impression half of the
  // donation funnel and the only one /donate can report, since the post-game note
  // and the questionnaire both record theirs against an account and this page is
  // shown to people who do not have one.
  //
  // Fire and forget, and never in the native app, where the page does not render
  // the ask at all. A failure here is invisible on purpose: the visitor came to
  // give money, not to be counted.
  useEffect(() => {
    if (SLIM_APP) return
    const visitKey = getVisitKey()
    if (!visitKey) return
    apiFetch(`${API}/api/donation/visit`, {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({ visitKey }),
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [API])

  const amount = custom.trim() !== '' ? Number(custom) : preset
  const valid  = Number.isFinite(amount) && amount >= MIN && amount <= MAX

  const pickPreset = (n) => { setPreset(n); setCustom(''); setError('') }
  const typeCustom = (raw) => {
    // Digits and at most one decimal point. type="text" with inputMode rather
    // than type="number", which on desktop hands you a spinner that can scroll
    // the amount while you are trying to scroll the page.
    const cleaned = raw.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')
    setCustom(cleaned)
    setPreset(null)
    setError('')
  }

  const donate = async () => {
    if (!valid || busy) return
    setBusy(true); setError('')
    try {
      const res = await apiFetch(`${API}/api/stripe/create-donation-session`, {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        // The visit key rides along so the server can mark this visit as having
        // pressed through. Only this page sends one, which is how the funnel
        // tells a donation started here from one started on the questionnaire.
        body:        JSON.stringify({ amount, visitKey: getVisitKey() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.url) throw new Error(data.error || 'Could not start the payment. Please try again.')
      window.location.href = data.url
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  // Never in the native app, whatever route someone reaches this by. Google
  // Play treats donations outside Play Billing as a carve-out for registered
  // charities, and SkyWatch is not one — the same reasoning that keeps the
  // post-game ask off native in CbatGameOver. The path stays in the slim
  // allow-list so the WEBSITE keeps working in slim mode, which carries no
  // store exposure; this guard is what makes that safe.
  if (SLIM_APP) {
    return (
      <div data-testid="donate-native-blocked" className="max-w-md mx-auto text-center py-12">
        <h1 className="text-2xl font-extrabold text-slate-900 mb-2">Support SkyWatch</h1>
        <p className="text-sm text-slate-500 mb-6">
          Donations are handled on the SkyWatch website, not in the app.
        </p>
        <Link to="/cbat" className="inline-flex px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors no-underline">
          Back to the games
        </Link>
      </div>
    )
  }

  if (outcome === 'success') {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        data-testid="donate-success"
        className="max-w-md mx-auto text-center py-12"
      >
        <SEO title="Thank You" description="Thank you for supporting SkyWatch." noIndex />
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', damping: 14, delay: 0.1 }}
          className="text-6xl mb-4"
        >
          🙏
        </motion.div>
        <h1 className="text-2xl font-extrabold text-slate-900 mb-2">Thank you</h1>
        <p className="text-sm text-slate-500 mb-6">
          Your donation went through. Stripe has emailed you a receipt. This genuinely keeps
          SkyWatch running, and it is a real help.
        </p>
        <Link
          to="/cbat"
          className="inline-flex px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl text-sm transition-colors no-underline"
        >
          Back to the games
        </Link>
      </motion.div>
    )
  }

  return (
    <div data-testid="donate-page" className="max-w-md mx-auto pb-8">
      <SEO
        title="Support SkyWatch"
        description="SkyWatch is free and has no ads. A one-off donation helps cover the running costs."
      />

      <div className="mb-4 sm:mb-6">
        <button
          onClick={() => navigate(-1)}
          className="text-xs sm:text-sm text-slate-500 hover:text-slate-700 transition-colors mb-1 sm:mb-3 flex items-center gap-1"
        >
          ← Back
        </button>
        <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900">Support SkyWatch</h1>
        <p className="text-[11px] sm:text-sm text-slate-500 mt-1 leading-relaxed">
          SkyWatch is free, has no ads and is paid for independently. A one-off donation covers
          the running costs and keeps the training getting better.
        </p>
      </div>

      {/* Cancelled is a normal thing to do and is not an error, so it is stated
          plainly and the form below is left exactly as it was. */}
      {outcome === 'cancelled' && (
        <p
          data-testid="donate-cancelled"
          className="text-xs sm:text-sm text-slate-600 bg-surface border border-slate-200 px-3 py-2 rounded-xl mb-4"
        >
          No payment was taken. You can pick a different amount below, or carry on without one.
        </p>
      )}

      <div className="bg-surface rounded-2xl border border-slate-200 p-4 sm:p-5 card-shadow">
        <p className="text-[10px] sm:text-xs font-bold text-slate-600 uppercase tracking-wider mb-3">
          Choose an amount
        </p>

        <div role="group" aria-label="Donation amount" className="grid grid-cols-4 gap-2">
          {PRESETS.map((n) => {
            const on = preset === n
            return (
              <button
                key={n}
                type="button"
                onClick={() => pickPreset(n)}
                aria-pressed={on}
                data-testid={`donate-preset-${n}`}
                className={`py-2.5 rounded-xl border text-sm font-bold transition-colors ${
                  on
                    ? 'bg-brand-600 border-brand-600 text-white'
                    : 'bg-transparent border-slate-200 text-slate-700 hover:border-brand-400 hover:text-slate-900'
                }`}
              >
                £{n}
              </button>
            )
          })}
        </div>

        <label
          htmlFor="donate-custom"
          className="block text-[10px] sm:text-xs font-bold text-slate-600 uppercase tracking-wider mt-4 mb-1.5"
        >
          Or another amount
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500 pointer-events-none">£</span>
          <input
            id="donate-custom"
            data-testid="donate-custom"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={custom}
            onChange={(e) => typeCustom(e.target.value)}
            className="w-full pl-7 pr-4 py-2.5 rounded-xl border border-slate-200 bg-transparent focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none text-sm transition-all"
          />
        </div>
        <p className="text-[10px] sm:text-xs text-slate-400 mt-1">Between £{MIN} and £{MAX}.</p>

        {error && (
          <p data-testid="donate-error" className="text-xs sm:text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-xl mt-3">
            {error}
          </p>
        )}

        {/* The button carries the figure. It is the last chance to notice that
            the box says 300 rather than 3, and it is the only place the amount
            and the commitment appear in the same glance. */}
        <button
          type="button"
          onClick={donate}
          disabled={!valid || busy}
          data-testid="donate-submit"
          className="w-full mt-4 py-3 sm:py-3.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-bold rounded-xl sm:rounded-2xl text-sm transition-colors"
        >
          {busy ? 'Opening Stripe…' : valid ? `Donate ${money(amount)}` : 'Choose an amount'}
        </button>

        {!user && (
          <p className="text-[10px] sm:text-xs text-slate-400 text-center mt-2.5">
            No account needed.
          </p>
        )}
      </div>

      <div className="mt-5 bg-surface rounded-2xl border border-slate-200 p-4 sm:p-5 card-shadow">
        <p className="text-[10px] sm:text-xs font-bold text-slate-600 uppercase tracking-wider mb-2.5">
          Where it goes
        </p>
        <ul className="text-xs sm:text-sm text-slate-500 space-y-1.5 list-none p-0 m-0">
          <li>Hosting, the database and file storage</li>
          <li>Building and maintaining the CBAT-style tests</li>
          <li>Writing the guides and keeping them up to date</li>
          <li>Fixing bugs and accessibility problems</li>
        </ul>
      </div>

      {/* Every clause here exists because someone could reasonably assume the
          opposite, and finding out afterwards is what turns a donation into a
          dispute. */}
      <p className="text-[10px] sm:text-xs text-slate-400 leading-relaxed mt-4">
        Payments are handled securely by Stripe, and SkyWatch never sees your full card details.
        A donation is a one-off voluntary payment: it is not a subscription, nothing is charged
        again, and it does not unlock any features or change your scores. It is not a charitable
        donation for tax purposes.
      </p>

      <p className="text-[10px] sm:text-xs text-slate-500 text-center mt-5">
        Not able to give? That is completely fine.{' '}
        <Link to="/cbat" className="font-semibold text-slate-600 hover:text-brand-600 underline underline-offset-2 transition-colors">
          Back to the games
        </Link>
      </p>
    </div>
  )
}
