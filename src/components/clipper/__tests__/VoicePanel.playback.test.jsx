import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import VoicePanel from '../VoicePanel'

// Narration wavs live on the agent's disk and are played through its media
// server. These cover the playback controls and the per-line redo; the actual
// audio element is stubbed, because jsdom has no media stack.

const MEDIA = 'http://127.0.0.1:52341'

const script = (lines) => ({
  _id: 's1',
  script: { beats: lines.map(l => ({ id: l.beatId, text: l.text })) },
  voice: {
    provider: 'voicebox',
    profileId: 'p1',
    lines,
    totalDurationMs: lines.reduce((n, l) => n + l.durationMs, 0),
  },
})

const LINES = [
  { beatId: 'b1', text: 'One.',   durationMs: 1000, startMs: 0,    wavPath: 'C:\\Temp\\skywatch-clipper\\s1\\b1.wav' },
  { beatId: 'b2', text: 'Two.',   durationMs: 2000, startMs: 1000, wavPath: 'C:\\Temp\\skywatch-clipper\\s1\\b2.wav' },
  { beatId: 'b3', text: 'Three.', durationMs: 3000, startMs: 3000, wavPath: 'C:\\Temp\\skywatch-clipper\\s1\\b3.wav' },
]

function setup(props = {}) {
  const onGenerate = vi.fn()
  const view = render(
    <VoicePanel
      script={script(LINES)}
      voices={[{ id: 'p1', name: 'Bethan' }]}
      agentOnline
      providers={{ voicebox: { available: true } }}
      job={null}
      mediaBaseUrl={MEDIA}
      onRefreshVoices={vi.fn()}
      onGenerate={onGenerate}
      onApprove={vi.fn()}
      busy={false}
      {...props}
    />,
  )
  return { onGenerate, audio: document.querySelector('audio'), ...view }
}

beforeEach(() => {
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue()
  window.HTMLMediaElement.prototype.pause = vi.fn()
})

describe('VoicePanel playback', () => {
  it('plays a single line from the agent media server', async () => {
    const { audio } = setup()
    fireEvent.click(screen.getAllByText('Play')[1])

    // The path is passed through as the OS wrote it — the media server resolves
    // it with path.resolve, which is native-separator aware.
    const url = new URL(audio.src)
    expect(url.origin).toBe(MEDIA)
    expect(url.searchParams.get('path')).toBe(LINES[1].wavPath)
  })

  it('offers a stop while a line is playing', async () => {
    setup()
    fireEvent.click(screen.getAllByText('Play')[0])
    expect(await screen.findByText('Stop')).toBeInTheDocument()
  })

  // Hearing the takes back to back is the only way to judge whether they sit
  // together as one read.
  it('plays every line in order', async () => {
    const { audio } = setup()

    // `playing` is set when play() resolves, so each step has to settle before
    // the next `ended` — otherwise the handler reads a stale null and stops.
    await act(async () => { fireEvent.click(screen.getByText('Play all')) })
    expect(audio.src).toContain(encodeURIComponent('b1.wav'))

    await act(async () => { fireEvent.ended(audio) })
    expect(audio.src).toContain(encodeURIComponent('b2.wav'))

    await act(async () => { fireEvent.ended(audio) })
    expect(audio.src).toContain(encodeURIComponent('b3.wav'))
  })

  it('stops after the last line rather than looping', async () => {
    const { audio } = setup()
    await act(async () => { fireEvent.click(screen.getByText('Play all')) })
    for (let i = 0; i < 3; i++) await act(async () => { fireEvent.ended(audio) })

    expect(screen.getByText('Play all')).toBeInTheDocument()
    expect(audio.src).toContain(encodeURIComponent('b3.wav'))
  })

  it('does not advance when a single line finishes', async () => {
    const { audio } = setup()
    await act(async () => { fireEvent.click(screen.getAllByText('Play')[0]) })
    const first = audio.src

    await act(async () => { fireEvent.ended(audio) })
    expect(audio.src).toBe(first)
    expect(screen.queryByText('Stop')).not.toBeInTheDocument()
  })

  // The agent serves the files; without it there is nothing to play.
  it('disables playback when the agent is not serving media', () => {
    setup({ mediaBaseUrl: null })
    expect(screen.getByText('Play all')).toBeDisabled()
    for (const button of screen.getAllByText('Play')) expect(button).toBeDisabled()
    expect(screen.getByText(/Start the agent to play these back/)).toBeInTheDocument()
  })
})

describe('VoicePanel redo', () => {
  it('re-records only the line asked for', () => {
    const { onGenerate } = setup()
    fireEvent.click(screen.getAllByText('Redo')[1])

    expect(onGenerate).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ beatIds: ['b2'], profileId: 'p1', provider: 'voicebox' }),
    )
  })

  it('offers a redo for every line including the outro', () => {
    setup()
    expect(screen.getAllByText('Redo')).toHaveLength(LINES.length)
  })

  it('blocks redo while a narration job is already running', () => {
    setup({ job: { type: 'voice', status: 'claimed', progress: 40 } })
    for (const button of screen.getAllByText('Redo')) expect(button).toBeDisabled()
  })
})
