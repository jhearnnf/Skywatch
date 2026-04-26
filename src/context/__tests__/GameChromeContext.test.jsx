import { render, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useEffect } from 'react'
import { GameChromeProvider, useGameChrome } from '../GameChromeContext'

function Capture({ sink }) {
  const ctx = useGameChrome()
  useEffect(() => { sink.ctx = ctx })
  return null
}

describe('GameChromeContext — pending play-nav flash', () => {
  it('starts with pendingPlayNavFlash false', () => {
    const sink = {}
    render(<GameChromeProvider><Capture sink={sink} /></GameChromeProvider>)
    expect(sink.ctx.pendingPlayNavFlash).toBe(false)
  })

  it('requestPlayNavFlash sets the flag and consumePlayNavFlash clears it', () => {
    const sink = {}
    render(<GameChromeProvider><Capture sink={sink} /></GameChromeProvider>)

    act(() => { sink.ctx.requestPlayNavFlash() })
    expect(sink.ctx.pendingPlayNavFlash).toBe(true)

    act(() => { sink.ctx.consumePlayNavFlash() })
    expect(sink.ctx.pendingPlayNavFlash).toBe(false)
  })

  it('immersive enter/exit are independent of the flash flag', () => {
    const sink = {}
    render(<GameChromeProvider><Capture sink={sink} /></GameChromeProvider>)

    act(() => { sink.ctx.requestPlayNavFlash() })
    act(() => { sink.ctx.enterImmersive() })
    expect(sink.ctx.immersive).toBe(true)
    expect(sink.ctx.pendingPlayNavFlash).toBe(true)

    act(() => { sink.ctx.exitImmersive() })
    expect(sink.ctx.immersive).toBe(false)
    expect(sink.ctx.pendingPlayNavFlash).toBe(true)
  })
})

describe('GameChromeContext — flashcard collect active flag', () => {
  it('starts inactive and toggles via enter/exit', () => {
    const sink = {}
    render(<GameChromeProvider><Capture sink={sink} /></GameChromeProvider>)
    expect(sink.ctx.flashcardCollectActive).toBe(false)

    act(() => { sink.ctx.enterFlashcardCollect() })
    expect(sink.ctx.flashcardCollectActive).toBe(true)

    act(() => { sink.ctx.exitFlashcardCollect() })
    expect(sink.ctx.flashcardCollectActive).toBe(false)
  })

  it('ref-counts so overlapping enters require matching exits', () => {
    const sink = {}
    render(<GameChromeProvider><Capture sink={sink} /></GameChromeProvider>)

    act(() => { sink.ctx.enterFlashcardCollect() })
    act(() => { sink.ctx.enterFlashcardCollect() })
    expect(sink.ctx.flashcardCollectActive).toBe(true)

    act(() => { sink.ctx.exitFlashcardCollect() })
    expect(sink.ctx.flashcardCollectActive).toBe(true)

    act(() => { sink.ctx.exitFlashcardCollect() })
    expect(sink.ctx.flashcardCollectActive).toBe(false)
  })

  it('exit clamps at 0 (extra exits do not flip negative)', () => {
    const sink = {}
    render(<GameChromeProvider><Capture sink={sink} /></GameChromeProvider>)

    act(() => { sink.ctx.exitFlashcardCollect() })
    act(() => { sink.ctx.exitFlashcardCollect() })
    expect(sink.ctx.flashcardCollectActive).toBe(false)

    act(() => { sink.ctx.enterFlashcardCollect() })
    expect(sink.ctx.flashcardCollectActive).toBe(true)
  })
})
