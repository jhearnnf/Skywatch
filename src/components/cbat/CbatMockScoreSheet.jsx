import { REGIONS } from '../../data/cbatBatteries'

// The Mock Assessment's score sheet, laid out like the real "Aptitude Scores" sheet so the first
// time a player sees that shape of page is not on the day: Battery, Domain, Dom Wgt, Tests, a 1-9
// stanine grid per domain, the PASS/FAIL label down the side, and Cutoff / Current on the right.
//
// What it deliberately does NOT copy is the official marking. No "OFFICIAL - SENSITIVE PERSONAL",
// no force title line, no form number: it is titled as a SkyWatch estimate and says so at the
// foot, so a screenshot of it can never pass for a real result.
//
// Always drawn as paper (light, whatever the site theme), because that is the point of it and
// because it is also what prints. The print rules live in main.css under `.mock-sheet`.

// The domain names as the real sheet abbreviates them.
const DOMAIN_ABBR = { STM_C: 'STM/C', PrcptSTM: 'Prcpt-STM', StrgCIP: 'Strg-CIP' }
const domainAbbr = key => DOMAIN_ABBR[key] ?? key

// "3(CUT), SAT": a test's multiplier leads it when it is more than one.
function testsText(tests) {
  return tests.map(t => (t.mult > 1 ? `${t.mult}(${t.code})` : t.code)).join(', ')
}

const STATUS_WORDS = {
  completed: 'Completed',
  abandoned: 'Left before the end',
  expired:   'Closed after 2 hours without continuing',
}

function SideLabel({ status, rows }) {
  const word = status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : 'N/A'
  const tone = status === 'pass' ? 'mock-sheet-side-pass' : status === 'fail' ? 'mock-sheet-side-fail' : 'mock-sheet-side-none'
  return (
    <td className={`mock-sheet-side ${tone}`} rowSpan={rows}>
      <span className="mock-sheet-side-word">{word.split('').map((c, i) => <span key={i}>{c}</span>)}</span>
    </td>
  )
}

// Nine cells, a green bar to the achieved stanine, and the minimum's red mark: a tick above and
// below the bar in the centre of the minimum's cell, or a solid red bar there when the domain is
// under it. Exactly the two marks the real row carries.
function StanineCells({ stanine, minStanine, belowMinimum }) {
  const pct = stanine == null ? 0 : (stanine / 9) * 100
  const minPct = minStanine == null ? null : ((minStanine - 0.5) / 9) * 100
  return (
    <td className="mock-sheet-grid" colSpan={9}>
      <div className="mock-sheet-grid-inner">
        {Array.from({ length: 9 }, (_, i) => <span key={i} className="mock-sheet-grid-cell" />)}
        {stanine != null && <span className="mock-sheet-bar" style={{ width: `${pct}%` }} />}
        {stanine == null && <span className="mock-sheet-not-sat">Not sat</span>}
        {minPct != null && (belowMinimum
          ? <span className="mock-sheet-min-fail" style={{ left: `${minPct}%` }} title={`Below the minimum of ${minStanine}`} />
          : (
            <>
              <span className="mock-sheet-min-tick mock-sheet-min-top" style={{ left: `${minPct}%` }} />
              <span className="mock-sheet-min-tick mock-sheet-min-bottom" style={{ left: `${minPct}%` }} />
            </>
          ))}
      </div>
    </td>
  )
}

function BatteryBlock({ battery }) {
  const rows = battery.domains.length
  const half = Math.ceil(rows / 2)
  return (
    <tbody className="mock-sheet-battery" data-testid={`mock-sheet-battery-${battery.key}`} data-status={battery.status}>
      {battery.domains.map((d, i) => (
        <tr key={d.key}>
          {i === 0 && <SideLabel status={battery.status} rows={rows} />}
          {i === 0 && (
            <td className="mock-sheet-battery-name" rowSpan={rows}>
              {battery.label}
              {battery.status === 'provisional' && (
                <span className="mock-sheet-battery-note">Not enough tests sat to judge</span>
              )}
            </td>
          )}
          <td className="mock-sheet-domain">{domainAbbr(d.key)}</td>
          <td className="mock-sheet-weight">{d.weight}x</td>
          <td className="mock-sheet-tests">{testsText(d.tests)}</td>
          <StanineCells stanine={d.stanine} minStanine={d.minStanine} belowMinimum={d.belowMinimum} />
          {i === 0 && <td className="mock-sheet-score-label" rowSpan={half}>Cutoff</td>}
          {i === 0 && <td className="mock-sheet-score-value" rowSpan={half}>{battery.cutoff}</td>}
          {i === half && <td className="mock-sheet-score-label mock-sheet-score-current" rowSpan={rows - half}>Current</td>}
          {i === half && <td className="mock-sheet-score-value mock-sheet-score-current" rowSpan={rows - half}>{battery.score ?? '-'}</td>}
        </tr>
      ))}
    </tbody>
  )
}

export default function CbatMockScoreSheet({ mock, agentNumber }) {
  const sheet = mock.sheet
  const region = REGIONS[mock.region]
  const sat = mock.testsDone
  const date = new Date(mock.startedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const assessment = mock.scope === 'role' ? mock.batteryLabel : `All roles, ${region?.label ?? mock.region}`

  return (
    <div className="mock-sheet" data-testid="mock-score-sheet">
      <header className="mock-sheet-head">
        <p className="mock-sheet-brand">SkyWatch Mock Assessment</p>
        <h2 className="mock-sheet-title">Aptitude Scores (estimate)</h2>
        <p className="mock-sheet-sub">A practice sitting of SkyWatch&apos;s CBAT-style tests. Not an official result.</p>
      </header>

      <div className="mock-sheet-candidate">
        <p className="mock-sheet-candidate-title">Candidate details</p>
        <dl>
          <div><dt>Agent number</dt><dd>{agentNumber ?? '-'}</dd></div>
          <div><dt>Test date</dt><dd>{date}</dd></div>
          <div><dt>Assessment</dt><dd>{assessment}</dd></div>
          <div><dt>Test</dt><dd>{region?.testName ?? 'CBAT'}</dd></div>
          <div><dt>Tests sat</dt><dd>{sat} of {mock.testsTotal}</dd></div>
          <div><dt>Sitting</dt><dd>{STATUS_WORDS[mock.status] ?? mock.status}</dd></div>
        </dl>
      </div>

      <div className="mock-sheet-scroll">
        <table className="mock-sheet-table">
          <thead>
            <tr>
              <th className="mock-sheet-side-head" rowSpan={2} aria-label="Result" />
              <th rowSpan={2}>Battery</th>
              <th rowSpan={2}>Domain</th>
              <th rowSpan={2}>Dom<br />Wgt</th>
              <th rowSpan={2}>Tests</th>
              <th colSpan={9}>Stanine</th>
              <th colSpan={2} rowSpan={2}>Score<br />(max {sheet.maxScore})</th>
            </tr>
            <tr>
              {Array.from({ length: 9 }, (_, i) => <th key={i} className="mock-sheet-stanine-num">{i + 1}</th>)}
            </tr>
          </thead>
          {sheet.batteries.map(b => <BatteryBlock key={b.key} battery={b} />)}
        </table>
      </div>

      <footer className="mock-sheet-foot">
        <p>
          <strong>This is a practice estimate, not a real result.</strong> SkyWatch&apos;s games are our own
          versions of the CBAT tests. The role weightings, pass marks and domain minimums come from real
          score sheets; the levels come from comparing you with other SkyWatch players. A red mark on a
          row is that domain&apos;s minimum: falling below it fails the role even above the pass mark.
        </p>
      </footer>
    </div>
  )
}
