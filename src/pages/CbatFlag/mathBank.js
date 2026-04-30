const rand = (n) => Math.floor(Math.random() * n)
const randRange = (lo, hi) => lo + rand(hi - lo + 1)

function ensurePositive(a, b) {
  return a >= b ? [a, b] : [b, a]
}

function generateEasy() {
  const ops = ['+', '-']
  const op = ops[rand(2)]
  let a = randRange(1, 10)
  let b = randRange(1, 10)
  if (op === '-') [a, b] = ensurePositive(a, b)
  const answer = op === '+' ? a + b : a - b
  return { question: `${a} ${op} ${b}`, answer, expectedDigits: String(answer).length }
}

function generateMedium() {
  const type = rand(3)
  if (type === 0) {
    const a = randRange(5, 15)
    const b = randRange(2, 9)
    const answer = a * b
    return { question: `${a} × ${b}`, answer, expectedDigits: String(answer).length }
  }
  if (type === 1) {
    // Evenly divisible: pick quotient first
    const quotient = randRange(2, 12)
    const divisor = randRange(2, 9)
    const dividend = quotient * divisor
    return { question: `${dividend} ÷ ${divisor}`, answer: quotient, expectedDigits: String(quotient).length }
  }
  // Two-digit add/subtract
  const a = randRange(11, 99)
  const b = randRange(11, 99)
  const op = rand(2) === 0 ? '+' : '-'
  const [x, y] = op === '-' ? ensurePositive(a, b) : [a, b]
  const answer = op === '+' ? x + y : x - y
  return { question: `${x} ${op} ${y}`, answer, expectedDigits: String(answer).length }
}

function generateHard() {
  const type = rand(2)
  if (type === 0) {
    // 3-term combo evaluated left-to-right
    const a = randRange(5, 20)
    const b = randRange(2, 12)
    const c = randRange(1, 8)
    const ops = ['+', '-', '×']
    const op1 = ops[rand(3)]
    const op2 = ops[rand(3)]
    const apply = (x, y, op) => op === '+' ? x + y : op === '-' ? x - y : x * y
    const intermediate = apply(a, b, op1)
    const answer = apply(intermediate, c, op2)
    // Ensure result is non-negative and not absurd
    if (answer < 0 || Math.abs(answer) > 999) return generateMedium()
    return { question: `${a} ${op1} ${b} ${op2} ${c}`, answer, expectedDigits: String(answer).length }
  }
  // Hard multiplication
  const a = randRange(11, 25)
  const b = randRange(4, 12)
  const answer = a * b
  return { question: `${a} × ${b}`, answer, expectedDigits: String(answer).length }
}

export function generateMath(difficulty) {
  if (difficulty === 'easy') return generateEasy()
  if (difficulty === 'hard') return generateHard()
  return generateMedium()
}
