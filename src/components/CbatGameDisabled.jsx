import { Link } from 'react-router-dom'
import SEO from './SEO'

export default function CbatGameDisabled({ gameTitle }) {
  const title = gameTitle ? `${gameTitle.toUpperCase()} OFFLINE` : 'GAME OFFLINE'
  return (
    <>
      <SEO title={`${gameTitle || 'CBAT Game'} Offline — Skywatch`} />
      <div className="max-w-md mx-auto px-4 py-12">
        <div className="rounded-2xl border-2 border-slate-400/40 bg-slate-900/60 px-6 py-8 text-center font-mono">
          <p className="text-[10px] tracking-[0.3em] text-slate-400 mb-3">CBAT</p>
          <p className="text-lg font-extrabold text-red-400 tracking-widest mb-2">{title}</p>
          <p className="text-sm text-slate-300 mb-5 whitespace-pre-line">
            {'THIS CBAT GAME IS CURRENTLY DISABLED.\nSTAND DOWN, AGENT.'}
          </p>
          <Link to="/cbat" className="inline-block text-xs text-brand-600 hover:underline">
            ← Back to CBAT
          </Link>
        </div>
      </div>
    </>
  )
}
