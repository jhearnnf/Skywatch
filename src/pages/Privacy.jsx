import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import SEO from '../components/SEO'

const PRIVACY_EMAIL = 'skywatchdev@proton.me'
const EFFECTIVE_DATE = '2 May 2026'

function Section({ title, children }) {
  return (
    <div className="border-t border-slate-200 pt-6">
      <h2 className="text-lg font-bold text-slate-900 mb-3">{title}</h2>
      <div className="space-y-3 text-slate-500 text-sm leading-relaxed">{children}</div>
    </div>
  )
}

export default function Privacy() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-2xl mx-auto px-4 py-12"
    >
      <SEO title="Privacy Policy" description="SkyWatch Academy privacy policy — how we collect, use, and protect your personal data." />

      <div className="mb-10">
        <h1 className="text-3xl font-extrabold text-slate-900 mb-2">Privacy Policy</h1>
        <p className="text-slate-500 text-sm">Effective date: {EFFECTIVE_DATE}</p>
      </div>

      <div className="bg-surface border border-slate-200 rounded-2xl p-6 space-y-6">

        <Section title="1. Who we are">
          <p>
            SkyWatch Academy ("we", "us", "our") is the data controller for personal data collected
            through this application. We are based in the United Kingdom.
          </p>
          <p>
            Contact us at{' '}
            <a href={`mailto:${PRIVACY_EMAIL}`} className="text-brand-600 hover:underline">
              {PRIVACY_EMAIL}
            </a>{' '}
            for any privacy-related enquiries.
          </p>
        </Section>

        <Section title="2. What personal data we collect">
          <p>We collect the following categories of personal data:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><span className="text-slate-700 font-medium">Account data</span> — email address, display name, and (if registered by email) a hashed password.</li>
            <li><span className="text-slate-700 font-medium">Google sign-in data</span> — if you use Sign in with Google, we receive your Google account ID and email address.</li>
            <li><span className="text-slate-700 font-medium">Profile data</span> — badge and avatar choices you make within the app.</li>
            <li><span className="text-slate-700 font-medium">Usage data</span> — game scores, quiz results, intel brief reading history, streaks, and airstar totals.</li>
            <li><span className="text-slate-700 font-medium">Support data</span> — content and email address provided when you submit a problem report.</li>
            <li><span className="text-slate-700 font-medium">Analytics data</span> — page views, click events, session replays, and device/browser information collected via PostHog.</li>
          </ul>
        </Section>

        <Section title="3. How we collect your data">
          <ul className="list-disc pl-5 space-y-1">
            <li>Directly from you when you register, sign in, or interact with the app.</li>
            <li>Automatically through PostHog analytics as you use the app.</li>
            <li>Via Google when you choose to sign in with a Google account.</li>
          </ul>
        </Section>

        <Section title="4. Why we process your data (lawful basis)">
          <p>
            <span className="text-slate-700 font-medium">Performance of a contract</span> — to create and maintain your account, authenticate you, and deliver the core features of the service.
          </p>
          <p>
            <span className="text-slate-700 font-medium">Legitimate interests</span> — to understand how the app is used so we can improve it (analytics), and to maintain security and prevent abuse.
          </p>
          <p>
            We do not sell your personal data to third parties and we do not use it for advertising.
          </p>
        </Section>

        <Section title="5. Third-party services">
          <p>We use the following third-party services which may process your personal data:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><span className="text-slate-700 font-medium">Google OAuth</span> — provides sign-in functionality. Governed by Google's Privacy Policy.</li>
            <li><span className="text-slate-700 font-medium">PostHog</span> — EU-hosted analytics platform. Collects usage behaviour, session replays, and device info. Data is stored within the EU.</li>
            <li><span className="text-slate-700 font-medium">Vercel</span> — hosts the frontend application.</li>
            <li><span className="text-slate-700 font-medium">Railway</span> — hosts the backend API.</li>
            <li><span className="text-slate-700 font-medium">MongoDB Atlas</span> — stores your account and usage data.</li>
          </ul>
        </Section>

        <Section title="6. Cookies and tracking">
          <p>
            We use cookies and similar technologies to keep you signed in (authentication cookie) and
            to collect analytics data via PostHog. The authentication cookie is strictly necessary
            for the service to function. The PostHog analytics cookies help us understand how users
            interact with the app.
          </p>
          <p>
            By using SkyWatch Academy you consent to these cookies being set. If you wish to opt out
            of analytics tracking, please contact us at{' '}
            <a href={`mailto:${PRIVACY_EMAIL}`} className="text-brand-600 hover:underline">
              {PRIVACY_EMAIL}
            </a>.
          </p>
        </Section>

        <Section title="7. Data retention">
          <p>
            We retain your personal data for as long as your account is active. If you request
            deletion of your account, we will remove your personal data within 30 days, except where
            we are required to retain it for legal or compliance purposes.
          </p>
        </Section>

        <Section title="8. Your rights under UK GDPR">
          <p>As a UK resident, you have the following rights regarding your personal data:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><span className="text-slate-700 font-medium">Access</span> — request a copy of the data we hold about you.</li>
            <li><span className="text-slate-700 font-medium">Rectification</span> — ask us to correct inaccurate data.</li>
            <li><span className="text-slate-700 font-medium">Erasure</span> — request deletion of your personal data.</li>
            <li><span className="text-slate-700 font-medium">Restriction</span> — ask us to limit how we use your data.</li>
            <li><span className="text-slate-700 font-medium">Portability</span> — receive your data in a structured, machine-readable format.</li>
            <li><span className="text-slate-700 font-medium">Objection</span> — object to processing based on legitimate interests.</li>
          </ul>
          <p>
            To exercise any of these rights, email us at{' '}
            <a href={`mailto:${PRIVACY_EMAIL}`} className="text-brand-600 hover:underline">
              {PRIVACY_EMAIL}
            </a>. We will respond within 30 days. You also have the right to lodge a complaint with
            the{' '}
            <a
              href="https://ico.org.uk"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-600 hover:underline"
            >
              Information Commissioner's Office (ICO)
            </a>.
          </p>
        </Section>

        <Section title="9. Children">
          <p>
            SkyWatch Academy is intended for users aged 13 and over. We do not knowingly collect
            personal data from children under the age of 13. If you believe a child under 13 has
            provided us with personal data, please contact us and we will delete it promptly.
          </p>
        </Section>

        <Section title="10. Changes to this policy">
          <p>
            We may update this Privacy Policy from time to time. Changes will be posted on this page
            with an updated effective date. Continued use of the app after changes are posted
            constitutes acceptance of the revised policy.
          </p>
        </Section>

      </div>

      <div className="mt-6 text-center">
        <Link
          to="/"
          className="text-sm text-slate-500 hover:text-slate-700 font-semibold transition-colors"
        >
          ← Back to Home
        </Link>
      </div>
    </motion.div>
  )
}
