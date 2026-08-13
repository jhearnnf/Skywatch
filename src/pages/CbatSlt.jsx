// CBAT "System Logic Test" (SLT).
//
// Tabs of system figures, a reading window, then questions that send you back
// into the tabs to find a figure and do something with it. The phase machine,
// the tab strip and the difficulty chrome all live in CbatTabbedReasoning —
// this file is the content and the copy, which is the only thing that separates
// SLT from VLT.

import { useCallback } from 'react'
import CbatTabbedReasoning from '../components/cbat/CbatTabbedReasoning'
import { generateSltSystem } from '../utils/cbat/sltGenerator'
import {
  SLT_DIFFICULTIES, SLT_QUESTIONS, SLT_LAUNCH_MS,
  sltTuning, computeSltGrade,
  readStoredSltDifficulty, storeSltDifficulty,
} from '../utils/cbat/sltDifficulty'

// Top-level, not defined inside the page's render — a component created during
// render remounts on every clock tick, and this one holds the tab the player is
// reading.
function SltTab(tab) {
  return (
    <div>
      <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">{tab.title}</p>
      <p className="text-xs text-slate-500 leading-relaxed mb-3">{tab.blurb}</p>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
        {tab.fields.map(f => (
          <div key={f.key} className="flex items-baseline justify-between gap-3 border-b border-[#13294a] pb-1">
            <dt className="text-xs text-slate-400">{f.label}</dt>
            <dd className="text-sm font-mono font-bold text-[#ddeaf8] whitespace-nowrap">
              {f.value.toLocaleString()}{f.unit ? ` ${f.unit}` : ''}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

const INTRO_BULLETS = [
  { icon: '1.', text: 'Read the tabs. They describe one aircraft’s systems: figures mixed in with prose.' },
  { icon: '2.', text: 'Answer the questions. The tabs stay open the whole time: this is a search task, not a memory test.' },
  { icon: '3.', text: 'Every question needs two tabs. No single tab answers one, so expect to hold a figure while you go and find the other.' },
  { icon: '4.', text: 'Only two tabs are readable at once. Opening a third closes whichever has been open longest, so choose which one you give up.' },
  { icon: '5.', text: 'Use the reading window twice. Once for the content, then a quick skim just to fix which tab holds what.' },
  { icon: '🔎', text: 'Under time pressure the bottleneck is finding the right tab, not doing the arithmetic.', muted: true },
]

export default function CbatSlt() {
  const buildRun = useCallback((tuning) => {
    const system = generateSltSystem({
      tabCount: tuning.tabCount,
      questionCount: SLT_QUESTIONS,
    })
    return { title: system.name, tabs: system.tabs, questions: system.questions }
  }, [])

  // Options carry their unit so "12" and "12 min" are never confused for each
  // other across two questions running back to back.
  const formatAnswer = useCallback((value, question) => {
    const unit = question?.unit
    const n = typeof value === 'number' ? value.toLocaleString() : value
    return unit ? `${n} ${unit}` : `${n}`
  }, [])

  return (
    <CbatTabbedReasoning
      gameName="System Logic Test"
      emoji="⚙️"
      seoTitle="System Logic Test (CBAT)"
      seoDescription="Tabs of system figures and a clock. Find the right figure and use it, before the search eats the time."
      introLead="You are given an aircraft's systems across a numbered index of tabs: burn rates, outputs, capacities, limits. Then questions that make you go and find two figures and use them together."
      introBullets={INTRO_BULLETS}
      difficulties={SLT_DIFFICULTIES}
      readStoredDifficulty={readStoredSltDifficulty}
      storeDifficulty={storeSltDifficulty}
      tuningFor={sltTuning}
      launchMs={SLT_LAUNCH_MS}
      totalQuestions={SLT_QUESTIONS}
      buildRun={buildRun}
      renderTab={SltTab}
      computeGrade={computeSltGrade}
      formatAnswer={formatAnswer}
      readPhaseLabel="Reading time"
    />
  )
}
