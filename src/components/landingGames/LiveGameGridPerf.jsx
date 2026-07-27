import { formatReport } from './perfProbe'

// Temporary diagnostic for the landing page's live game wall. Off unless the
// URL says `?perf=1`, and it changes nothing about a normal visit.
//
// It answers the question "is the wall slow because there are too many games,
// or because each one is too expensive?" by stepping the number of live cards
// down and measuring each step: frame times, dropped frames, long tasks, and —
// the one that usually decides it — how many pixels the WebGL canvases fill
// versus how many the page actually shows.
//
// Delete this file, perfProbe.js and the `perf` branch in LiveGameGrid to
// remove the whole thing.

function PerfHud({ live, rows, done, longTasksSupported }) {
  const report = formatReport(rows, {
    dpr: typeof window !== 'undefined' ? window.devicePixelRatio : null,
    vw: typeof window !== 'undefined' ? window.innerWidth : null,
    vh: typeof window !== 'undefined' ? window.innerHeight : null,
    longTasksSupported,
  })

  return (
    <div
      style={{
        position: 'fixed', bottom: 8, right: 8, zIndex: 9999,
        background: 'rgba(6,16,30,0.94)', border: '1px solid #5baaff',
        borderRadius: 8, padding: '8px 10px', maxWidth: '92vw',
        font: '11px/1.45 ui-monospace, Menlo, Consolas, monospace', color: '#ddeaf8',
      }}
    >
      <div style={{ fontWeight: 700, color: '#5baaff', marginBottom: 4 }}>
        {done ? 'SWEEP COMPLETE — copy the table' : `MEASURING · ${live} live card${live === 1 ? '' : 's'}…`}
      </div>
      <pre style={{ margin: 0, whiteSpace: 'pre', overflowX: 'auto' }}>{report}</pre>
      {done && (
        <button
          onClick={() => navigator.clipboard?.writeText(report)}
          style={{ marginTop: 6, padding: '3px 8px', background: '#5baaff', color: '#06101e', border: 0, borderRadius: 4, font: 'inherit', fontWeight: 700, cursor: 'pointer' }}
        >
          Copy
        </button>
      )}
    </div>
  )
}

export default PerfHud
