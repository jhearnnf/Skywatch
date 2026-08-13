// CBAT "Verbal Logic Test" (VLT).
//
// The System Logic Test with prose instead of figures — which is how the guide
// corpus describes it, and why both games run on the same shell. What differs is
// that no answer here is written down anywhere: every one needs two sections
// joined, and the sentence that DOES state something plainly is the distractor.

import { useCallback } from 'react'
import CbatTabbedReasoning from '../components/cbat/CbatTabbedReasoning'
import { buildVltRun } from '../utils/cbat/vltGenerator'
import {
  VLT_DIFFICULTIES, VLT_QUESTIONS, VLT_LAUNCH_MS,
  vltTuning, computeVltGrade,
  readStoredVltDifficulty, storeVltDifficulty,
} from '../utils/cbat/vltDifficulty'

function VltTab(tab) {
  return (
    <div>
      <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">{tab.title}</p>
      <p className="text-sm text-[#ddeaf8] leading-relaxed">{tab.text}</p>
    </div>
  )
}

const INTRO_BULLETS = [
  { icon: '1.', text: 'Read the tabs. The topic is deliberately mundane. No subject knowledge is needed, and everything you need is in front of you.' },
  { icon: '2.', text: 'Answer the questions. The tabs stay open; go back and find the pieces rather than trying to hold it all.' },
  { icon: '3.', text: 'Every answer needs two sections joined. Don’t keyword-hunt for a phrase from the question.' },
  { icon: '4.', text: 'Only two pages are readable at once. Opening a third closes whichever has been open longest.' },
  { icon: '⚠️', text: 'If you find your answer sitting there in one sentence, check it. That is usually the distractor.', muted: true },
]

export default function CbatVlt() {
  const buildRun = useCallback((tuning) => {
    const run = buildVltRun({
      tabCount: tuning.tabCount,
      questionCount: VLT_QUESTIONS,
    })
    return { title: run.title, tabs: run.tabs, questions: run.questions }
  }, [])

  return (
    <CbatTabbedReasoning
      gameName="Verbal Logic Test"
      emoji="📖"
      seoTitle="Verbal Logic Test (CBAT)"
      seoDescription="Eight tabs of briefing prose. Every answer needs two of them joined, and the plainly-stated one is the trap."
      introLead="A briefing arrives as a set of tabs. The subject can look intimidating and is entirely beside the point. You are being tested on whether you can join two pieces of information from different pages."
      introBullets={INTRO_BULLETS}
      difficulties={VLT_DIFFICULTIES}
      readStoredDifficulty={readStoredVltDifficulty}
      storeDifficulty={storeVltDifficulty}
      tuningFor={vltTuning}
      launchMs={VLT_LAUNCH_MS}
      totalQuestions={VLT_QUESTIONS}
      buildRun={buildRun}
      renderTab={VltTab}
      computeGrade={computeVltGrade}
      readPhaseLabel="Reading time"
    />
  )
}
