'use strict';

/**
 * Parse the public CBAT guide HTML into structured data the chat bot can be
 * grounded in.
 *
 * The guide is a single-page document whose content lives in JS data literals
 * (`const TESTS = [...]`) inside its first <script> block, not in the markup —
 * the HTML around it is a template that renders those arrays. So we pull the
 * named literals out and evaluate them, rather than scraping tags.
 *
 * Safety notes, because this parses a file an admin uploads:
 *
 *   • Only the named literals below are evaluated, sliced out by balanced-
 *     bracket scanning. The page's DOM/rendering code is never run.
 *   • Evaluation happens in a bare vm context — `Object.create(null)`, so there
 *     is no require, no process, no fetch, no globals of any kind — under a
 *     hard timeout. A data literal has nothing to reach for.
 *   • Everything that comes back is re-normalised to plain strings, numbers and
 *     booleans with a depth and length cap, so a hostile file cannot smuggle
 *     getters, prototypes or unbounded content into the database.
 *
 * That is defence in depth for an admin-only upload, not a claim that running
 * untrusted JS is fine. If this ever accepts non-admin input, replace the vm
 * step with a real JS-literal parser.
 */

const vm = require('node:vm');

// The data blocks we know about. Anything else in the file is ignored.
const WANTED = [
  'TESTS', 'DAY_GROUPS', 'FELT', 'HELPED', 'TOOLKINDS', 'OTHER', 'OPEN', 'CONF',
];

const EVAL_TIMEOUT_MS = 2000;
const MAX_STRING      = 4000;
const MAX_DEPTH       = 8;
const MAX_ITEMS       = 500;

// Scan from `start` (which must be the opening bracket) to its match, skipping
// over string literals, template literals and comments so a bracket inside a
// quoted apostrophe — of which this guide has many — cannot end the slice early.
function matchBracket(src, start) {
  const open = src[start];
  const close = open === '[' ? ']' : open === '{' ? '}' : null;
  if (!close) throw new Error(`Expected [ or { at ${start}, found ${open}`);

  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i];
    const next = src[i + 1];

    if (ch === '/' && next === '/') {
      i = src.indexOf('\n', i);
      if (i === -1) break;
      continue;
    }
    if (ch === '/' && next === '*') {
      i = src.indexOf('*/', i + 2) + 1;
      if (i === 0) break;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) break;
        i += 1;
      }
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error(`Unbalanced ${open} starting at ${start}`);
}

// Strip everything back to primitives. This is what actually protects the
// database from whatever the evaluated literal turned out to be.
function normalise(value, depth = 0) {
  if (depth > MAX_DEPTH) return null;
  if (value === null || value === undefined) return null;

  const t = typeof value;
  if (t === 'string')  return value.slice(0, MAX_STRING);
  if (t === 'number')  return Number.isFinite(value) ? value : null;
  if (t === 'boolean') return value;
  if (t === 'function') return null;

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ITEMS).map(v => normalise(v, depth + 1));
  }
  if (t === 'object') {
    const out = {};
    for (const key of Object.keys(value).slice(0, MAX_ITEMS)) {
      if (!/^[A-Za-z_][\w]*$/.test(key)) continue;
      // `__proto__` passes the identifier test but assigning it would set the
      // prototype rather than add a key, which is how a hostile file would try
      // to poison every object downstream. The other two are only dangerous by
      // association, but there is no reason for guide data to carry them.
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      out[key] = normalise(value[key], depth + 1);
    }
    return out;
  }
  return null;
}

function evaluateLiteral(literal) {
  // Bare context: no globals at all, so the literal has nothing to call.
  return vm.runInNewContext(`(${literal})`, Object.create(null), {
    timeout: EVAL_TIMEOUT_MS,
  });
}

/**
 * @param {string} html the guide file's contents
 * @returns {{ sections: Object, found: string[], missing: string[] }}
 */
function parseCbatGuide(html) {
  if (typeof html !== 'string' || !html.trim()) {
    throw new Error('Guide file is empty');
  }

  const sections = {};
  const found = [];
  const missing = [];

  for (const name of WANTED) {
    // `const NAME = [` or `= {`, tolerating let/var and whitespace.
    const re = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*([\\[{])`);
    const m = re.exec(html);
    if (!m) { missing.push(name); continue; }

    const openIndex = m.index + m[0].length - 1;
    const closeIndex = matchBracket(html, openIndex);
    const literal = html.slice(openIndex, closeIndex + 1);

    let value;
    try {
      value = evaluateLiteral(literal);
    } catch (err) {
      throw new Error(`Could not read "${name}" from the guide: ${err.message}`);
    }
    sections[name] = normalise(value);
    found.push(name);
  }

  if (!sections.TESTS || !Array.isArray(sections.TESTS) || !sections.TESTS.length) {
    throw new Error(
      'That file does not look like the CBAT guide — no TESTS data found. ' +
      'Upload the public guide HTML.',
    );
  }

  return { sections, found, missing };
}

// ── Corpus rendering ────────────────────────────────────────────────────────

// Confidence is a one-letter code, expanded once in the legend, rather than a
// full sentence repeated on all ~150 facts.
//
// The long form cost roughly 60 characters per fact — about 9,000 characters,
// an eighth of the whole corpus, spent restating the same four labels. The
// model reads a legend perfectly well, and every token here is paid on every
// question. `grey` is included because it used to fall through to "UNRATED",
// which silently threw away the one thing that grade means: the claim comes
// from the published test guides and nobody who sat the test confirmed it.
const CONF_CODE = { green: 'G', amber: 'A', red: 'R', grey: 'P' };

const CONF_LEGEND =
  'CONFIDENCE CODE on every point below — [G] well established, several people who sat the test. ' +
  '[A] single account: one source, or someone who had not sat it; unconfirmed. ' +
  '[R] outdated: no longer seems to hold. ' +
  '[P] from the published test guides only; nobody who sat it has confirmed it. ' +
  'Anything after " | " on a point is the caveat or supporting detail for that point.';

const clean = (s) => (typeof s === 'string' ? s.trim() : '');

function renderFacts(facts = [], indent = '  ') {
  const lines = [];
  for (const f of facts) {
    if (!f || !clean(f.t)) continue;
    const code = CONF_CODE[f.c] || '?';
    const tag = clean(f.tag) ? `${clean(f.tag)}: ` : '';
    const note = clean(f.n);
    lines.push(`${indent}[${code}] ${tag}${clean(f.t)}${note ? ` | ${note}` : ''}`);
  }
  return lines;
}

/**
 * Flatten the parsed guide into the plain-text corpus the model is grounded in.
 *
 * Confidence is rendered inline on every single fact, deliberately. The bot is
 * repeating what candidates reported, not stating what the test is, and it can
 * only pass that distinction on to the reader if it is attached to each claim
 * rather than mentioned once at the top.
 *
 * @param {Object} sections  parsed guide
 * @param {Array|null} opts.tests  render only these test sections (see
 *        utils/cbatGuideRetrieval.js). Null renders every one, which is both
 *        the default and the fallback when a question matches nothing.
 *        The ROSTER still names every test either way — the bot must never
 *        read "not included in this request" as "not covered by the guide".
 */
function renderGuideCorpus(sections = {}, { tests = null } = {}) {
  const out = [];

  out.push('=== CBAT COMMUNITY GUIDE ===');
  out.push(
    'Everything below is compiled from what candidates reported after sitting the test. ' +
    'It is not official material and it is not the test itself.',
  );
  out.push(CONF_LEGEND);
  out.push('');

  // A roster line, computed here rather than left for the bot to work out.
  //
  // "How many tests are there?" is one of the most obvious things anyone asks,
  // and the answer was "I don't have a complete list" — because the count is
  // not written anywhere in the guide, only implied by the sections below it.
  // Asking a language model to count headings is unreliable in a way that
  // counting them in code is not, so the count is stated as a fact it can read.
  const named = (sections.TESTS ?? [])
    .filter(Boolean)
    .map(t => [clean(t.name), clean(t.abbr) && `(${clean(t.abbr)})`].filter(Boolean).join(' '))
    .filter(Boolean);
  if (named.length) {
    out.push('## THE TESTS DESCRIBED HERE');
    out.push(
      `${named.length} tests are described below, in this order: ${named.join('; ')}.`,
    );
    out.push(
      'This is what candidates have described, so treat it as at least this many ' +
      'rather than a definitive roster of the battery.',
    );
    // Only some test sections were included this time. Without this line the
    // bot reads the absent ones as unknown and says it has nothing on them,
    // when in fact it simply was not sent them for this question.
    if (tests && tests.length < named.length) {
      out.push(
        'Only the tests relevant to the current question are written out in full below. ' +
        'Every test named above is covered; if you are asked about one that is not ' +
        'detailed here, say you can go into it if they ask, rather than saying you ' +
        'have nothing on it.',
      );
    }
    out.push('');
  }

  for (const test of tests ?? sections.TESTS ?? []) {
    if (!test) continue;
    const title = [clean(test.name), clean(test.abbr) && `(${clean(test.abbr)})`]
      .filter(Boolean).join(' ');
    out.push(`## TEST: ${title}`);
    if (clean(test.aka)) out.push(`Also known as: ${clean(test.aka)}`);
    if (clean(test.verdict)) out.push(`Overall: ${clean(test.verdict)}`);
    out.push(...renderFacts(test.facts));
    out.push('');
  }

  for (const group of sections.DAY_GROUPS ?? []) {
    if (!group) continue;
    out.push(`## ON THE DAY: ${clean(group.title)}`);
    out.push(...renderFacts(group.facts));
    out.push('');
  }

  for (const other of sections.OTHER ?? []) {
    if (!other) continue;
    out.push(`## OTHER SERVICES: ${clean(other.flag)}`);
    out.push(...renderFacts(other.facts));
    out.push('');
  }

  if ((sections.HELPED ?? []).length) {
    out.push('## WHAT CANDIDATES SAID HELPED');
    for (const h of sections.HELPED) {
      if (!h || !clean(h.tool)) continue;
      const n = Number.isFinite(h.n) ? ` (mentioned by ${h.n})` : '';
      out.push(`- ${clean(h.tool)}${n}: ${clean(h.note)}`);
    }
    out.push('');
  }

  for (const kind of sections.TOOLKINDS ?? []) {
    if (!kind) continue;
    out.push(`## ${clean(kind.name) || 'CHOOSING A PRACTICE TOOL'}`);
    for (const item of kind.items ?? []) {
      if (Array.isArray(item) && item.length >= 2) {
        out.push(`- ${clean(item[0])}: ${clean(item[1])}`);
      }
    }
    out.push('');
  }

  if ((sections.FELT ?? []).length) {
    out.push('## HOW IT FELT VERSUS HOW IT SCORED');
    for (const f of sections.FELT) {
      if (!f) continue;
      out.push(`- ${clean(f.who)} — felt: ${clean(f.felt)} Actual: ${clean(f.actual)}`);
    }
    out.push('');
  }

  if ((sections.OPEN ?? []).length) {
    out.push('## KNOWN UNKNOWNS — the guide has NO answer to these');
    for (const o of sections.OPEN) {
      if (!o || !clean(o.q)) continue;
      out.push(`- ${clean(o.q)} (${clean(o.note)})`);
    }
    out.push('');
  }

  out.push('=== END OF GUIDE ===');
  return out.join('\n');
}

module.exports = {
  parseCbatGuide,
  renderGuideCorpus,
  matchBracket,
  normalise,
  WANTED,
  // Exported so the bot's system prompt can be asserted to teach every code
  // this renderer emits, rather than the two drifting apart silently.
  CONF_CODE,
  CONF_LEGEND,
};
