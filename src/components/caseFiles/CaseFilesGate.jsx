/**
 * CaseFilesGate — full-page blocker shown when a Case Files route returns
 * a 403/429 from the gating layer.
 *
 *   reason='disabled'  Feature is off for everyone — terminal-style "OFFLINE".
 *   reason='tier'      Subscription tier is too low — reuses the standard
 *                      LockedCategoryModal so the upsell visual matches the
 *                      one shown for gated intel briefs.
 *   reason='limit'     Daily play cap reached — terminal-style "STAND DOWN".
 */

import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import LockedCategoryModal from '../LockedCategoryModal'
import SEO from '../SEO'

function TerminalCard({ headline, body }) {
  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <div className="rounded-2xl border-2 border-slate-400/40 bg-slate-900/60 px-6 py-8 text-center font-mono">
        <p className="text-[10px] tracking-[0.3em] text-slate-400 mb-3">CASE FILES</p>
        <p className="text-lg font-extrabold text-red-400 tracking-widest mb-2">{headline}</p>
        <p className="text-sm text-slate-300 mb-5 whitespace-pre-line">{body}</p>
        <Link to="/play" className="inline-block text-xs text-brand-600 hover:underline">
          ← Back to Play
        </Link>
      </div>
    </div>
  )
}

export default function CaseFilesGate({ reason, usedToday, limitToday, minTier }) {
  const navigate         = useNavigate()
  const { user }         = useAuth()

  if (reason === 'disabled') {
    return (
      <>
        <SEO title="Case Files Offline — Skywatch" />
        <TerminalCard
          headline="CASE FILES OFFLINE"
          body={'SYSTEM OFFLINE — CASE FILES DISABLED\nSTAND DOWN, AGENT.'}
        />
      </>
    )
  }

  if (reason === 'limit') {
    const used = usedToday ?? '?'
    const lim  = limitToday ?? '?'
    return (
      <>
        <SEO title="Daily Limit Reached — Skywatch" />
        <TerminalCard
          headline="DAILY DOSSIER LIMIT REACHED"
          body={`SESSIONS USED TODAY: ${used} / ${lim}\nREPORT BACK TOMORROW, AGENT.`}
        />
      </>
    )
  }

  // 'tier' — show the standard upsell. The modal sits on top of an otherwise
  // blank page; closing it returns the user to /play (where the locked card
  // would also surface the same upsell).
  const tier = minTier === 'silver' ? 'silver' : 'gold'
  return (
    <>
      <SEO title="Case Files — Skywatch" />
      <div className="min-h-[40vh]" />
      <LockedCategoryModal
        category="Case Files"
        tier={tier}
        user={user}
        onClose={() => navigate('/play')}
      />
    </>
  )
}
