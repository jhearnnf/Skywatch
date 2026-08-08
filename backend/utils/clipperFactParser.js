// Clipper fact parser — extracts the source points for short-form video scripts
// out of the CBAT reference guide.
//
// The guide (public/cbat-guide.html) looks like a
// document but is really a client-rendered data file: the content lives in a set
// of top-level JS array literals inside its <script> block, and the page builds
// itself from them at load time. So we do NOT parse the DOM — there is nothing
// in the markup to parse. We pull the array literals out by name and evaluate
// each one in isolation.
//
// Evaluating the whole script block is not an option: it also contains the
// render code, which touches `document` and would throw. Instead we locate each
// `const NAME = [ … ]` by bracket matching and evaluate that literal alone in a
// bare vm context with no globals and a short timeout. The literals are pure
// data, so nothing user-supplied ever executes.

const fs   = require('fs');
const vm   = require('vm');
const path = require('path');
const crypto = require('crypto');

// The PUBLIC guide — the same file the site serves at /cbat-guide.html, which
// is the only copy of it in version control. There is also a private/admin
// edition (APPLICATION_INFO/chat_dumps/CBAT_COMPLETE_GUIDE.HTML) which carries
// real Discord handles on every finding — it must never be the source for
// Clipper, because anything ingested here can end up quoted in a published
// video. clipperFactParser.test.js asserts this path is not that file.
//
// Local dev only: Railway ships just `backend/`, so this path does not exist in
// production and ingest there goes through pasted or uploaded text instead.
// See the note in models/ClipperSource.js.
const DEFAULT_GUIDE_PATH = path.join(
  __dirname, '..', '..', 'public', 'cbat-guide.html',
);

// The four arrays whose entries carry a `facts` list. `allFactArrays` in the
// guide is built from exactly these, so this list must stay in step with it.
// Each entry maps the container to the fields we keep as provenance columns.
const FACT_CONTAINERS = [
  { array: 'TESTS',      kind: 'test', idField: 'id', nameField: 'name',  abbrField: 'abbr' },
  { array: 'DAY_GROUPS', kind: 'day',  idField: 'id', nameField: 'title', abbrField: null   },
  { array: 'APPS',       kind: 'app',  idField: 'id', nameField: 'name',  abbrField: null   },
  { array: 'OTHER',      kind: 'other', idField: 'id', nameField: 'flag', abbrField: null   },
];

// Arrays that carry real people's names/usernames. Everything harvested from
// these is blocklisted from generated scripts — see buildNameBlocklist.
const PEOPLE_ARRAYS = ['ANALYSTS', 'PEOPLE', 'STAFF', 'FELT', 'HELPED', 'OPEN'];

const VALID_GRADES = new Set(['green', 'amber', 'red']);

// ── Literal extraction ──────────────────────────────────────────────────────

// Scan forward from the opening bracket, tracking string/template/comment state
// so brackets inside string content don't affect depth. Returns the literal
// source including both brackets, or null if it never balances.
function matchBracket(src, openIdx) {
  const open = src[openIdx];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let i = openIdx;

  while (i < src.length) {
    const ch = src[i];

    // Comments
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      if (nl === -1) return null;
      i = nl + 1;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) return null;
      i = end + 2;
      continue;
    }

    // Strings — single, double, template. Templates in this data are plain
    // text (no ${} interpolation), but we still skip their content wholesale.
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }

    if (ch === open)  depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return src.slice(openIdx, i + 1);
    }
    i++;
  }
  return null;
}

// Pull `const NAME = [ … ]` out of the source and evaluate the literal.
// Returns null when the array is absent — callers decide whether that is fatal.
function extractArray(src, name) {
  const decl = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*\\[`);
  const m = decl.exec(src);
  if (!m) return null;

  const openIdx = m.index + m[0].length - 1; // the '[' itself
  const literal = matchBracket(src, openIdx);
  if (!literal) return null;

  try {
    // Bare context: no require, no process, no globals of any kind.
    return vm.runInNewContext(`(${literal})`, Object.create(null), { timeout: 5000 });
  } catch {
    return null;
  }
}

// ── Fact extraction ─────────────────────────────────────────────────────────

function hashFact(fact) {
  return crypto
    .createHash('sha256')
    .update(`${fact.grade}|${fact.text}|${fact.why}`)
    .digest('hex');
}

function normaliseRefs(refs) {
  if (!Array.isArray(refs)) return [];
  return refs
    .filter(r => r && typeof r === 'object')
    .map(r => ({
      user: typeof r.u === 'string' ? r.u : '',
      line: Number.isFinite(r.l) ? r.l : null,
      quote: typeof r.q === 'string' ? r.q : '',
    }));
}

// Walk the four fact-bearing arrays and flatten to one row per finding.
// factKey is stable across re-ingests: `${kind}:${containerId}:${index}`.
function extractFacts(src) {
  const facts = [];

  for (const spec of FACT_CONTAINERS) {
    const arr = extractArray(src, spec.array);
    if (!Array.isArray(arr)) continue;

    for (const container of arr) {
      if (!container || !Array.isArray(container.facts)) continue;

      const containerId = String(container[spec.idField] ?? '').trim();
      if (!containerId) continue;

      container.facts.forEach((f, index) => {
        if (!f || typeof f.t !== 'string' || !f.t.trim()) return;

        const grade = VALID_GRADES.has(f.c) ? f.c : 'red'; // unknown grade = most cautious
        const row = {
          factKey:       `${spec.kind}:${containerId}:${index}`,
          sourceKind:    spec.kind,
          containerId,
          containerName: String(container[spec.nameField] ?? '').trim(),
          containerAbbr: spec.abbrField ? String(container[spec.abbrField] ?? '').trim() : '',
          grade,
          tag:           typeof f.tag === 'string' ? f.tag : '',
          text:          f.t.trim(),
          // The two guide editions name the rationale field differently: the
          // private one uses `why` alongside a `refs` list, the public one
          // folds it into `n` and ships no refs at all.
          why:           typeof f.why === 'string' ? f.why.trim()
                       : typeof f.n   === 'string' ? f.n.trim()
                       : '',
          refs:          normaliseRefs(f.refs),
        };
        row.refCount = row.refs.length;
        row.contentHash = hashFact(row);
        facts.push(row);
      });
    }
  }

  return facts;
}

// ── Name blocklist ──────────────────────────────────────────────────────────

// Split a comma/slash-separated credit string ("blitz1031, Elliot, God") into
// individual handles. HELPED.who and OPEN.by both use this shape.
function splitNames(value) {
  if (typeof value !== 'string') return [];
  return value
    .split(/[,/]/)
    // Credits annotate roles inline — "Mighty (only advocate)", "lottie
    // (enquirer)". The parenthetical is commentary, not part of the handle.
    .map(s => s.replace(/\([^)]*\)/g, '').trim())
    .filter(Boolean);
}

// Every real username or person named anywhere in the guide. Generated scripts
// are scrubbed against this — the source material is a Discord export, so a
// model summarising it will happily attribute a tip to the person who posted
// it. Collected at ingest so the check needs no network or DB lookup.
function buildNameBlocklist(src) {
  const names = new Set();
  const add = v => {
    const s = String(v ?? '').trim();
    if (s.length < 2) return;
    // The public guide has already anonymised its contributors into
    // descriptions — "A candidate going for air traffic control". Those are
    // not handles, and blocklisting them would flag exactly the phrasing we
    // want scripts to use. Real handles never start with an article.
    if (/^(?:a|an|the|one|two|several)\s/i.test(s)) return;
    names.add(s);
  };

  for (const arrayName of PEOPLE_ARRAYS) {
    const arr = extractArray(src, arrayName);
    if (!Array.isArray(arr)) continue;

    for (const entry of arr) {
      if (typeof entry === 'string') { add(entry); continue; }   // ANALYSTS
      if (!entry || typeof entry !== 'object') continue;

      // Different arrays name the person differently. Credit fields hold
      // either one name or a comma/slash-separated list, so we always take the
      // split parts and keep the raw value only when it isn't a list —
      // otherwise the blocklist fills up with strings like
      // "blitz1031, Elliot, God" that can never match anything.
      add(entry.name);
      if (typeof entry.who === 'string' && !/[,/]/.test(entry.who)) add(entry.who);
      splitNames(entry.who).forEach(add);
      splitNames(entry.by).forEach(add);

      // STAFF/HELPED carry their own refs with usernames attached.
      normaliseRefs(entry.refs).forEach(r => add(r.user));
    }
  }

  return names;
}

// Usernames also appear on every fact's refs, so harvest those too.
function collectRefUsers(facts) {
  const names = new Set();
  for (const f of facts) {
    for (const r of f.refs) {
      const s = String(r.user ?? '').trim();
      if (s.length >= 2) names.add(s);
    }
  }
  return names;
}

// ── Public API ──────────────────────────────────────────────────────────────

function parseGuideSource(src) {
  if (typeof src !== 'string' || !src.trim()) {
    throw new Error('Guide source is empty');
  }

  const facts = extractFacts(src);
  if (facts.length === 0) {
    throw new Error('No facts extracted — the guide format may have changed');
  }

  const blocklist = buildNameBlocklist(src);
  for (const n of collectRefUsers(facts)) blocklist.add(n);

  return {
    facts,
    blocklist: [...blocklist].sort(),
    counts: {
      total: facts.length,
      green: facts.filter(f => f.grade === 'green').length,
      amber: facts.filter(f => f.grade === 'amber').length,
      red:   facts.filter(f => f.grade === 'red').length,
    },
  };
}

function parseGuideFile(filePath = DEFAULT_GUIDE_PATH) {
  return parseGuideSource(fs.readFileSync(filePath, 'utf8'));
}

module.exports = {
  parseGuideFile,
  parseGuideSource,
  extractArray,
  matchBracket,
  buildNameBlocklist,
  DEFAULT_GUIDE_PATH,
  FACT_CONTAINERS,
};
