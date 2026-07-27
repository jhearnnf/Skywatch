import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { renderHook } from '@testing-library/react'
import { CbatDemoContext, useCbatDemoDpr, DEMO_CANVAS_DPR } from '../demoMode'

// A canvas inside a demo tile is drawn at a fraction of its layout size, so
// rendering it at the device's full pixel ratio burns pixels nobody sees —
// 3x measured on a desktop at dpr 1, and that multiplies by dpr² on a phone.

describe('useCbatDemoDpr', () => {
  const wrapper = (value) => ({ children }) => (
    <CbatDemoContext.Provider value={value}>{children}</CbatDemoContext.Provider>
  )

  it('leaves R3F to its own default for a real player', () => {
    const { result } = renderHook(() => useCbatDemoDpr())
    expect(result.current).toBeUndefined()
  })

  it('caps the ratio inside a demo card', () => {
    const { result } = renderHook(() => useCbatDemoDpr(), { wrapper: wrapper({ portalTarget: null }) })
    expect(result.current).toBe(DEMO_CANVAS_DPR)
    expect(DEMO_CANVAS_DPR).toBeLessThanOrEqual(1)
  })

  it('lets the harness override it', () => {
    const { result } = renderHook(() => useCbatDemoDpr(), { wrapper: wrapper({ portalTarget: null, dpr: 0.5 }) })
    expect(result.current).toBe(0.5)
  })
})

// Trace Practise 2D mounts a WebGL context nobody had counted — its aircraft
// is a <PlaneModel3D>, not a sprite — and it sat in the pool marked light for
// months. So rather than trusting a list, walk out from the demo registry and
// hold every canvas the wall can reach to declaring a pixel ratio.
describe('every <Canvas> the game wall can mount declares a dpr', () => {
  const resolve = (fromFile, spec) => {
    if (!spec.startsWith('.')) return null
    const base = join(dirname(fromFile), spec)
    for (const c of [`${base}.jsx`, `${base}.js`, join(base, 'index.jsx')]) {
      if (existsSync(c)) return c
    }
    return null
  }

  // Comments talk about <Canvas> too; only code counts.
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  function reachable(entry, seen = new Set()) {
    if (seen.has(entry)) return seen
    seen.add(entry)
    const src = readFileSync(entry, 'utf8')
    for (const [, spec] of src.matchAll(/(?:from|import\()\s*'([^']+)'/g)) {
      const next = resolve(entry, spec)
      if (next) reachable(next, seen)
    }
    return seen
  }

  it('holds for everything reachable from the demo registry', () => {
    const files = reachable(join('src', 'components', 'landingGames', 'gameDemoRegistry.js'))
    const withCanvas = []
    const offenders = []
    for (const file of files) {
      const src = stripComments(readFileSync(file, 'utf8'))
      if (!/<Canvas[\s>]/.test(src)) continue
      withCanvas.push(file)
      if (!/\bdpr=\{/.test(src)) offenders.push(file)
    }
    // Guard the guard: if the walk stops finding canvases, the test has stopped
    // testing anything.
    expect(withCanvas.length).toBeGreaterThan(5)
    expect(offenders).toEqual([])
  })
})
