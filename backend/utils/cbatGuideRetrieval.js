'use strict';

/**
 * Picking the part of the guide a question actually needs.
 *
 * The guide renders to ~60,000 characters (~15,000 tokens) and was being sent
 * in full on every question. At Haiku 4.5's input rate that is about $0.015 per
 * reply BEFORE the question is considered — measured at $0.0168 a reply, ~95%
 * of it input tokens. Someone asking one thing about the SDT was paying to ship
 * all 23 tests.
 *
 * So: send the small always-on core, plus the test sections the question is
 * actually about. A single-test question drops to roughly a fifth of the tokens.
 *
 * Deliberately keyword matching over the parsed structure rather than
 * embeddings or a vector store. The corpus is 23 named tests with abbreviations
 * — the names ARE the index. A retrieval layer with its own model call would
 * cost more than the tokens it saves.
 *
 * The failure mode that matters is missing a section the question needed, so
 * this errs toward including: no match at all falls back to the whole guide,
 * and the roster line naming every test is always sent, so the bot never
 * mistakes "not included this time" for "not covered".
 */

// How many test sections one question can pull in. Three covers "how does FLAG
// compare to SDT" without letting a question that name-drops half the battery
// rebuild the full corpus.
const TEST_MATCH_LIMIT = 3;

// Words that carry no signal about which test is meant. Without these, "what
// is the test about" matches every test that has "test" in its name — which is
// most of them.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'what', 'when', 'how', 'why', 'does', 'did', 'was',
  'are', 'is', 'it', 'its', 'a', 'an', 'of', 'on', 'in', 'to', 'do', 'you', 'your',
  'me', 'my', 'i', 'about', 'like', 'any', 'can', 'get', 'got', 'test', 'tests',
  'cbat', 'exam', 'assessment', 'part', 'section', 'one', 'question', 'questions',
]);

const norm = (s) => String(s ?? '').toLowerCase();

const words = (s) => norm(s)
  .split(/[^a-z0-9]+/)
  .filter(w => w.length >= 3 && !STOPWORDS.has(w));

/**
 * How strongly this question points at this test.
 *
 * Abbreviation and full-name hits are decisive; shared words are a weak tie
 * break, so "spatial" nudges a spatial test up without dragging in everything
 * that mentions the word once.
 */
function scoreTest(test, question) {
  if (!test) return 0;
  const q = norm(question);
  if (!q) return 0;

  let score = 0;

  // Abbreviations are matched on a word boundary: "SDT" must not fire on
  // "sdtx", and a two-letter abbreviation is too collision-prone to trust.
  const abbr = norm(test.abbr).trim();
  if (abbr.length >= 3 && new RegExp(`\\b${abbr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(q)) {
    score += 10;
  }

  const name = norm(test.name).trim();
  if (name && q.includes(name)) score += 10;

  const aka = norm(test.aka).trim();
  if (aka.length >= 4 && q.includes(aka.replace(/^"|"$/g, ''))) score += 6;

  // Distinctive words from the test's own name appearing in the question.
  const nameWords = new Set(words(test.name));
  const qWords = new Set(words(question));
  for (const w of nameWords) if (qWords.has(w)) score += 2;

  return score;
}

/**
 * The tests a question is about, best match first.
 *
 * @returns {Array|null} matched tests, or null when nothing matched.
 */
function selectTests(sections, question, { limit = TEST_MATCH_LIMIT } = {}) {
  const all = (sections?.TESTS ?? []).filter(Boolean);
  if (!all.length) return null;

  const scored = all
    .map(test => ({ test, score: scoreTest(test, question) }))
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;
  return scored.slice(0, limit).map(row => row.test);
}

// Questions that are answered by the always-on core rather than by any test
// section. These matter more than they look: "how many tests are there", "what
// happens on the day" and "is the Australian one the same" name no test, so
// without this they fell through to the full-guide fallback — and those are
// among the most commonly asked questions there are.
const CORE_TOPICS = [
  // The roster line answers these outright.
  /how many/i, /which tests?/i, /what tests?/i, /list of/i, /full list/i, /all the tests?/i,
  // The on-the-day section.
  /\bday\b/i, /\boasc\b/i, /cranwell/i, /assessment cent/i, /what happens/i,
  /\bschedule\b/i, /\btimings?\b/i, /how long is the whole/i,
  // Other services.
  /\bnavy\b/i, /\barmy\b/i, /australian?/i, /\braaf\b/i, /new zealand/i, /canad/i,
  /other (force|service)/i,
  // Practice and preparation.
  /practi[cs]/i, /prepar/i, /revis/i, /\bapps?\b/i, /\btools?\b/i, /\bbooks?\b/i,
  /train for/i, /get ready/i, /what helped/i,
];

const looksCoreOnly = (question) => CORE_TOPICS.some(re => re.test(String(question ?? '')));

/**
 * Which slice of the guide to send for one question.
 *
 * @returns {{ tests: Array|null, full: boolean }}
 *   `full` true means send everything — the safe fallback for a question that
 *   matched neither a test nor a core topic, where guessing at a slice risks
 *   answering "I don't have that" about something the guide does cover.
 */
function selectGuideSlice(sections, question) {
  const tests = selectTests(sections, question);
  if (tests) return { tests, full: false };
  // No test named. The core alone answers roster, on-the-day, other-services
  // and preparation questions, so those do not need the fallback.
  if (looksCoreOnly(question)) return { tests: [], full: false };
  return { tests: null, full: true };
}

module.exports = {
  TEST_MATCH_LIMIT,
  STOPWORDS,
  CORE_TOPICS,
  scoreTest,
  selectTests,
  selectGuideSlice,
  looksCoreOnly,
  words,
};
