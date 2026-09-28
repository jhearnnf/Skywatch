import { Link } from 'react-router-dom'
import { TESTS, gamePath, gameTitle } from '../../data/cbatBatteries'

// The weakest areas on a Mock Assessment sheet, each with the games that feed it: under a minimum
// first, then the lowest stanines. Screen only; the printed sheet is the sheet.
//
// Shown under the player's own sheet (/cbat/mock/:id) and under the same sheet in the admin tools.
export default function CbatMockPractiseNext({ sheet }) {
  const rows = new Map()
  for (const b of sheet.batteries) {
    for (const d of b.domains) {
      if (d.stanine == null) continue
      const prev = rows.get(d.key)
      const weak = d.belowMinimum || d.stanine <= 4
      if (!weak) continue
      if (!prev || (d.belowMinimum && !prev.belowMinimum)) rows.set(d.key, d)
    }
  }
  const list = [...rows.values()].sort((a, b) => (b.belowMinimum - a.belowMinimum) || (a.stanine - b.stanine)).slice(0, 4)
  if (!list.length) return null
  return (
    <div className="bg-surface border border-slate-200 rounded-2xl p-4 sm:p-5 card-shadow mt-5 mock-sheet-chrome" data-testid="mock-practise-next">
      <h2 className="text-sm font-extrabold text-slate-900 mb-2">What to practise next</h2>
      <ul className="space-y-2">
        {list.map(d => (
          <li key={d.key} className="text-xs text-slate-700">
            <span className="font-bold text-slate-900">{d.label}</span>
            {d.belowMinimum ? ` is under the minimum of ${d.minStanine} for a role you sat.` : ` came out at ${d.stanine}.`}
            {' '}
            {[...new Set(d.tests.flatMap(t => TESTS[t.code]?.games ?? []))].map((g, i) => (
              <span key={g}>{i > 0 && ', '}<Link to={gamePath(g)} className="text-brand-600 hover:text-brand-700 font-bold">{gameTitle(g)}</Link></span>
            ))}
          </li>
        ))}
      </ul>
    </div>
  )
}
