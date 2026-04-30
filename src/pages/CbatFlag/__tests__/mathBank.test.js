import { describe, it, expect } from 'vitest'
import { generateMath } from '../mathBank'

const QUESTION_RE = /^(\d+)\s*([+\-×÷])\s*(\d+)$/

function evalQuestion(question) {
  const m = question.match(QUESTION_RE)
  if (!m) return null
  const a = parseInt(m[1], 10)
  const b = parseInt(m[3], 10)
  switch (m[2]) {
    case '+': return a + b
    case '-': return a - b
    case '×': return a * b
    case '÷': return a / b
    default: return null
  }
}

const DIFFICULTIES = ['easy', 'medium', 'hard']
const ITERATIONS = 500

describe('generateMath', () => {
  for (const diff of DIFFICULTIES) {
    describe(`difficulty: ${diff}`, () => {
      it('every question is exactly two numbers and one operator', () => {
        for (let i = 0; i < ITERATIONS; i++) {
          const q = generateMath(diff)
          expect(q.question, `iter ${i}: "${q.question}" should match "<num> <op> <num>"`).toMatch(QUESTION_RE)
        }
      })

      it('answer matches the computed result of the question', () => {
        for (let i = 0; i < ITERATIONS; i++) {
          const q = generateMath(diff)
          const computed = evalQuestion(q.question)
          expect(computed).not.toBeNull()
          expect(computed).toBe(q.answer)
        }
      })

      it('expectedDigits matches String(answer).length', () => {
        for (let i = 0; i < ITERATIONS; i++) {
          const q = generateMath(diff)
          expect(q.expectedDigits).toBe(String(q.answer).length)
        }
      })

      it('answer is a non-negative integer', () => {
        for (let i = 0; i < ITERATIONS; i++) {
          const q = generateMath(diff)
          expect(Number.isInteger(q.answer)).toBe(true)
          expect(q.answer).toBeGreaterThanOrEqual(0)
        }
      })
    })
  }

  it('hard difficulty produces division questions (rare branch is reachable)', () => {
    let sawDivision = false
    for (let i = 0; i < 2000; i++) {
      if (generateMath('hard').question.includes('÷')) {
        sawDivision = true
        break
      }
    }
    expect(sawDivision).toBe(true)
  })
})
