// The post-answer walkthrough is authored data, and the part of it that can rot
// silently is the quoting: the tab renderer marks a quote by finding it inside
// the tab's own prose, so a comma changed in a tab six months from now stops the
// highlight without anything failing. These tests are the loud version of that.

import { describe, it, expect } from 'vitest'
import { buildVltRun } from '../vltGenerator'
import { VLT_PACKS } from '../vltPacks'
import { VLT_QUESTIONS } from '../vltDifficulty'

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// [questionId, needs, span] for every quotable span in every pack, evidence
// steps and the optional trap quote alike.
function allSpans() {
  const rows = []
  for (const pack of VLT_PACKS) {
    for (const q of pack.questions) {
      for (const step of q.evidence || []) rows.push([pack.id, q.id, q.needs, step])
      if (q.trapEvidence) rows.push([pack.id, q.id, q.needs, q.trapEvidence])
    }
  }
  return rows
}

describe('VLT evidence', () => {
  it('gives every question a walkthrough with at least two steps', () => {
    // One step is not a walkthrough, it is a restatement. Every question in this
    // test joins two sections, so the derivation has at least two moves in it.
    for (const pack of VLT_PACKS) {
      for (const q of pack.questions) {
        expect([q.id, Array.isArray(q.evidence)]).toEqual([q.id, true])
        expect([q.id, (q.evidence || []).length >= 2]).toEqual([q.id, true])
      }
    }
  })

  it('writes a reason on every step', () => {
    for (const pack of VLT_PACKS) {
      for (const q of pack.questions) {
        for (const step of q.evidence) expect([q.id, !!step.why?.trim()]).toEqual([q.id, true])
      }
    }
  })

  it('quotes text that is actually in the tab it names', () => {
    for (const pack of VLT_PACKS) {
      const textById = new Map(pack.tabs.map(t => [t.id, t.text]))
      for (const [, id, , span] of allSpans().filter(r => r[0] === pack.id)) {
        if (!span.tab) continue
        expect([id, span.tab, textById.has(span.tab)]).toEqual([id, span.tab, true])
        const found = textById.get(span.tab).includes(span.quote)
        expect([id, span.quote, found]).toEqual([id, span.quote, true])
      }
    }
  })

  it('only points at tabs the question already needs', () => {
    // The walkthrough reopens the tabs it names, and only two panes are ever
    // open. A tab outside `needs` might not even be in an Easier run.
    for (const [, id, needs, span] of allSpans()) {
      if (!span.tab) continue
      expect([id, span.tab, needs.includes(span.tab)]).toEqual([id, span.tab, true])
    }
  })

  it('never opens more tabs than there are panes', () => {
    for (const pack of VLT_PACKS) {
      for (const q of pack.questions) {
        const tabs = new Set((q.evidence || []).map(s => s.tab).filter(Boolean))
        if (q.trapEvidence?.tab) tabs.add(q.trapEvidence.tab)
        expect([q.id, tabs.size <= 2]).toEqual([q.id, true])
      }
    }
  })

  it('leaves a step with no tab as pure reasoning, carrying no orphan quote', () => {
    for (const pack of VLT_PACKS) {
      for (const q of pack.questions) {
        for (const step of q.evidence) {
          if (!step.tab) expect([q.id, step.quote ?? null]).toEqual([q.id, null])
        }
      }
    }
  })

  it('gives the trap quote a tab, whenever one is claimed at all', () => {
    for (const pack of VLT_PACKS) {
      for (const q of pack.questions) {
        if (!q.trapEvidence) continue
        expect([q.id, !!q.trapEvidence.tab && !!q.trapEvidence.quote]).toEqual([q.id, true])
      }
    }
  })

  it('carries the walkthrough through into a built run', () => {
    for (let seed = 0; seed < 20; seed++) {
      const run = buildVltRun({ tabCount: 8, questionCount: VLT_QUESTIONS }, mulberry32(seed))
      for (const q of run.questions) {
        expect([q.id, q.evidence.length >= 2]).toEqual([q.id, true])
        expect([q.id, 'trapEvidence' in q]).toEqual([q.id, true])
      }
    }
  })
})
