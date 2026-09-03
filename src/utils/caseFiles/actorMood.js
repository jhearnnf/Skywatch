/**
 * actorMood.js
 * Turns an interrogation answer into the face the actor should be pulling.
 *
 * There are two sources, in order:
 *   1. The server. The interrogation endpoint asks the model to append a mood
 *      tag, strips it out of the prose, and returns it alongside the answer.
 *      That is the accurate one, because the model knows what it meant.
 *   2. This file's keyword heuristic, used when the tag is missing — an older
 *      transcript, a model that ignored the instruction, an offline fixture.
 *      A wrong-but-plausible expression is far better than a frozen one.
 */

export const MOODS = ['neutral', 'guarded', 'firm', 'grave', 'wry', 'thinking']

export const MOOD_LABEL = {
  neutral:  'Composed',
  guarded:  'Guarded',
  firm:     'Firm',
  grave:    'Grave',
  wry:      'Wry',
  thinking: 'Considering',
}

export function normaliseMood(raw) {
  if (typeof raw !== 'string') return null
  const cleaned = raw.trim().toLowerCase()
  return MOODS.includes(cleaned) ? cleaned : null
}

// Ordered most-specific first: an answer that both deflects and warns is read
// as the deflection, because that is what the player actually got back.
const MOOD_CUES = [
  ['guarded', [
    'will not entertain', 'will not comment', 'no comment', 'i will not',
    'cannot speak to', 'not for me to say', 'hypothetical', 'speculation',
    'i do not discuss', 'that is a matter for', 'as i have said',
    'internal matter', 'sovereign right', 'i am not going to',
  ]],
  ['grave', [
    'grave', 'serious consequences', 'catastroph', 'dangerous', 'war',
    'lives', 'casualt', 'we are concerned', 'deeply concerned', 'threat to',
    'red line', 'no illusions',
  ]],
  ['firm', [
    'unacceptable', 'we demand', 'must be', 'will not tolerate', 'insist',
    'non-negotiable', 'we will respond', 'make no mistake', 'we are ready',
    'there will be', 'guarantee', 'we will defend',
  ]],
  ['wry', [
    'of course', 'as always', 'i am told', 'apparently', 'curious',
    'i find it interesting', 'let us be honest', 'with respect',
  ]],
]

/**
 * deriveMood(text)
 * Keyword fallback. Returns 'neutral' for anything it cannot place, which is
 * the right default: a public figure answering a question on the record.
 */
export function deriveMood(text) {
  if (typeof text !== 'string' || text.trim() === '') return 'neutral'
  const lower = text.toLowerCase()
  for (const [mood, cues] of MOOD_CUES) {
    if (cues.some((cue) => lower.includes(cue))) return mood
  }
  return 'neutral'
}

/**
 * moodFor({ mood, answer, isPending })
 * The one call the UI makes. While a question is in flight the actor is
 * visibly considering it, whatever the last answer was.
 */
export function moodFor({ mood, answer, isPending } = {}) {
  if (isPending) return 'thinking'
  return normaliseMood(mood) ?? deriveMood(answer)
}
