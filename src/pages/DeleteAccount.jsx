import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import SEO from '../components/SEO'

// The URL declared in the Google Play Console's data-safety form. Play requires
// it to be publicly reachable — no sign-in, no app install — because a reviewer
// opens it cold. Keep this route out of any auth guard.
const SUPPORT_EMAIL = 'skywatchdev@proton.me'

const WIPED = [
  'Your account, email address and sign-in details',
  'Every CBAT score, game result and leaderboard entry',
  'Your airstars, rank and level progress',
  'Your reading history and tutorial progress',
  'Any support conversations and problem reports you sent',
]

const RETAINED = [
  'Anonymised error and delivery logs, which no longer identify you — we keep these to diagnose faults.',
  'Records we are required to keep by law, for as long as the law requires.',
]

function Section({ title, children }) {
  return (
    <div className="border-t border-slate-200 pt-6">
      <h2 className="text-lg font-bold text-slate-900 mb-3">{title}</h2>
      <div className="space-y-3 text-slate-500 text-sm leading-relaxed">{children}</div>
    </div>
  )
}

export default function DeleteAccount() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-2xl mx-auto px-4 py-12"
    >
      <SEO
        title="Delete Your Account"
        description="How to permanently delete your SkyWatch CBAT account and all associated data."
      />

      <div className="mb-10">
        <h1 className="text-3xl font-extrabold text-slate-900 mb-2">Delete your account</h1>
        <p className="text-slate-500 text-sm">
          SkyWatch CBAT — account and data deletion
        </p>
      </div>

      <div className="bg-surface border border-slate-200 rounded-2xl p-6 space-y-6">

        <div>
          <h2 className="text-lg font-bold text-slate-900 mb-3">Delete it yourself, in the app</h2>
          <div className="space-y-3 text-slate-500 text-sm leading-relaxed">
            <p>You can delete your account at any time, without asking us:</p>
            <ol className="list-decimal pl-5 space-y-1">
              <li>Open SkyWatch CBAT and sign in.</li>
              <li>Go to <span className="text-slate-700 font-medium">Profile</span>.</li>
              <li>Scroll to the bottom and tap <span className="text-slate-700 font-medium">Delete account</span>.</li>
              <li>Type <span className="text-slate-700 font-medium">DELETE</span> to confirm.</li>
            </ol>
            <p>
              Deletion is immediate and permanent. There is no recovery period and no way for us to
              restore the account afterwards.
            </p>
            <p>
              Signed in on the web?{' '}
              <Link to="/profile" className="text-brand-600 hover:underline">
                Go to your profile
              </Link>{' '}
              to do the same thing.
            </p>
          </div>
        </div>

        <Section title="Or ask us to do it">
          <p>
            If you cannot access your account, email{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-brand-600 hover:underline">
              {SUPPORT_EMAIL}
            </a>{' '}
            from the address you signed up with, asking us to delete your account. We will confirm
            once it is done, and within 30 days at the latest.
          </p>
        </Section>

        <Section title="What gets deleted">
          <ul className="list-disc pl-5 space-y-1">
            {WIPED.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Section>

        <Section title="What we keep, and why">
          <ul className="list-disc pl-5 space-y-1">
            {RETAINED.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p>
            For the full picture, see our{' '}
            <Link to="/privacy" className="text-brand-600 hover:underline">
              Privacy Policy
            </Link>.
          </p>
        </Section>

      </div>
    </motion.div>
  )
}
