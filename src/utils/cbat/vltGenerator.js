// CBAT "Verbal Logic Test" (VLT) run builder.
//
// The content lives in vltPacks.js — hand-written scenarios, because the whole
// point of this test is that the answer sits in the gap between two paragraphs
// and prose like that does not generate convincingly. This file picks a pack,
// trims it to the difficulty's tab subset, and samples the questions that
// subset can actually answer.
//
// Pure and deterministic: pass a seeded `rng` (() => [0,1)) to reproduce a run
// in tests. Defaults to Math.random for live play.
//
// buildVltRun({ tabCount, questionCount, packId }, rng)
//   → { packId, title, tabs, questions }
//     questions = [{ id, prompt, answer, options, needs, trap, evidence, trapEvidence }]

import { VLT_PACKS, VLT_PACK_BY_ID } from './vltPacks'

function shuffle(arr, rng) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Which tabs a difficulty shows. Easier gets the pack's declared `easierTabs`,
// in the pack's own order — they are chosen so that subset is self-sufficient,
// not just the first five. Hard gets every tab.
export function tabsForRun(pack, tabCount) {
  if (tabCount >= pack.tabs.length) return pack.tabs
  const allowed = new Set(pack.easierTabs)
  return pack.tabs.filter(t => allowed.has(t.id)).slice(0, tabCount)
}

export function buildVltRun({ tabCount, questionCount, packId }, rng = Math.random) {
  const pack = (packId && VLT_PACK_BY_ID[packId])
    || VLT_PACKS[Math.floor(rng() * VLT_PACKS.length)]

  const tabs = tabsForRun(pack, tabCount)
  const shown = new Set(tabs.map(t => t.id))

  // A question is only usable when EVERY tab it joins is on screen. Without
  // this an Easier run could ask something whose second half was never shown —
  // unanswerable, and it would read as the game being broken rather than hard.
  const usable = pack.questions.filter(q => q.needs.every(id => shown.has(id)))

  const questions = shuffle(usable, rng).slice(0, questionCount).map(q => ({
    id: q.id,
    prompt: q.prompt,
    answer: q.answer,
    options: shuffle([q.answer, ...q.distractors], rng),
    needs: q.needs,
    trap: q.trap,
    evidence: q.evidence || [],
    trapEvidence: q.trapEvidence || null,
  }))

  return {
    packId: pack.id,
    title: pack.title,
    tabs,
    questions,
  }
}
