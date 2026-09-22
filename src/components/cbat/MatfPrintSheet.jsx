// The Table Reading Test's reference material, laid out as paper.
//
// This is the one surface in the app that is deliberately NOT on the dark RAF
// theme. It is a sheet of A4 that is about to come out of a printer, and it is
// shown on screen exactly as it will print so the player can see what they are
// about to spend ink on. Black on white, hairline rules, no brand colour in the
// tables themselves — everything here has to survive a mono laser printer.
//
// Two pages: the coordinate grid, then the wind sheet. `.matf-print-page`
// breaks between them (see @media print in main.css); the wind tables carry
// break-inside: avoid so a table never splits across a fold, which would make
// picking the right air speed harder on paper than it is on screen.
//
// Sized for A4 PORTRAIT, so nobody has to find the orientation setting. The
// widest thing here is the ±17 grid: 35 columns plus labels inside 190mm of
// printable width, which is why the grid cells are set in pt rather than in
// Tailwind's px steps — px sizing at that column count either overflows the
// page or gets silently scaled down by the print engine.
//
// The sheet code in the header is the whole point of printing at all: it is how
// a kept sheet finds its way back to the run it belongs to. See matfPrint.js.

import { Fragment } from 'react'
import { axisLabels, READOUTS } from '../../utils/cbat/matfGenerator'
import { matfSheetCode } from '../../utils/cbat/matfPrint'

function SheetHeader({ code, shape, printedAt, page, pages }) {
  return (
    <div className="flex items-baseline justify-between border-b-2 border-black pb-1 mb-3">
      <p className="font-bold text-[13px] tracking-tight">
        SkyWatch · Table Reading Test
        <span className="font-normal text-[11px] text-neutral-600"> · reference sheet</span>
      </p>
      <p className="font-mono text-[11px] text-neutral-700">
        {code} · {shape} · {printedAt} · {page}/{pages}
      </p>
    </div>
  )
}

function PrintGrid({ grid }) {
  const labels = axisLabels(grid.extent)
  return (
    <table className="matf-print-grid w-full table-fixed border-collapse font-mono">
      <thead>
        <tr>
          <th className="border border-neutral-400 bg-neutral-200 font-bold">·</th>
          {labels.map(l => (
            <th key={l} className="border border-neutral-400 bg-neutral-200 font-bold">{l}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {grid.cells.map((rowVals, r) => (
          <tr key={r}>
            <th className="border border-neutral-400 bg-neutral-200 font-bold">{labels[r]}</th>
            {rowVals.map((v, c) => (
              <td key={c} className="border border-neutral-300 text-center">{v}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function PrintWindTables({ sheet }) {
  return (
    <div className="space-y-4">
      {sheet.tables.map(table => (
        <table
          key={table.airSpeed}
          className="matf-print-wind w-full border-collapse font-mono"
          style={{ breakInside: 'avoid' }}
        >
          <caption className="caption-top text-left font-sans font-bold text-[11px] uppercase tracking-wide pb-0.5">
            Air Speed {table.airSpeed} kt
          </caption>
          <thead>
            <tr>
              <th rowSpan={2} className="border border-neutral-400 bg-neutral-200 font-bold align-bottom">W/V</th>
              {sheet.angles.map(a => (
                <th key={a} colSpan={2} className="border border-neutral-400 bg-neutral-200 font-bold">{a}°</th>
              ))}
            </tr>
            <tr>
              {sheet.angles.map(a => (
                <Fragment key={a}>
                  <th className="border border-neutral-400 bg-neutral-100 font-bold">{READOUTS.drift.short}</th>
                  <th className="border border-neutral-400 bg-neutral-100 font-bold">{READOUTS.ground.short}</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((v, r) => (
              <tr key={v}>
                <th className="border border-neutral-400 bg-neutral-200 font-bold">{v}</th>
                {sheet.angles.map((a, c) => (
                  <Fragment key={a}>
                    <td className="border border-neutral-300 text-center">{table.cells[r][c].drift}</td>
                    <td className="border border-neutral-300 text-center">{table.cells[r][c].ground}</td>
                  </Fragment>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  )
}

export default function MatfPrintSheet({ grid, sheet, seed, shape, printedAt }) {
  const code = matfSheetCode(seed)
  const date = new Date(printedAt).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
  })

  return (
    <div className="matf-print-sheet w-full max-w-[210mm] mx-auto bg-white text-black rounded-lg shadow-2xl p-6 sm:p-8">
      <section className="matf-print-page">
        <SheetHeader code={code} shape={shape} printedAt={date} page={1} pages={2} />

        {/* The note has to be on the PAPER, not only on the screen that offered
            the print. By the time it matters the player is holding the sheet
            and the screen has moved on. */}
        <div className="border border-neutral-400 bg-neutral-100 px-3 py-2 mb-4 text-[11px] leading-snug">
          <p className="font-bold mb-0.5">This sheet is good for one run.</p>
          <p>
            Every run builds a different set of numbers on purpose, so you learn the lookup
            instead of memorising one grid. Print a fresh sheet each time you play.
          </p>
          <p className="mt-1">
            Keep this one and you can replay sheet <span className="font-mono font-bold">{code}</span> from
            the instructions screen. Replays are not submitted to the leaderboard, because on the
            real test the numbers are ones you have never seen.
          </p>
        </div>

        <h2 className="font-bold text-[12px] uppercase tracking-wide mb-1">Part One · Coordinate Grid</h2>
        <p className="text-[10px] text-neutral-600 mb-2">
          Bring one number across and one down, then read where they meet. The pair works either
          way round: the value at 4, −11 is the value at −11, 4.
        </p>
        <PrintGrid grid={grid} />
      </section>

      <section className="matf-print-page">
        <div className="mt-8 matf-print-page-top">
          <SheetHeader code={code} shape={shape} printedAt={date} page={2} pages={2} />
        </div>

        <h2 className="font-bold text-[12px] uppercase tracking-wide mb-1">Part Two · Wind Sheet</h2>
        <p className="text-[10px] text-neutral-600 mb-2">
          Three steps. Air speed picks the table, wind velocity picks the row, wind angle picks the
          column. Then read whichever of Drift Correction (DRIFT) or Ground Speed (GS) you were
          asked for. Check the air speed on the table you have landed in before you read anything
          off it.
        </p>
        <PrintWindTables sheet={sheet} />
      </section>
    </div>
  )
}
