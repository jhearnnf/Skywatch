#!/usr/bin/env node
//
// Render the public CBAT guide down to the flat corpus the guide bot reads.
//
// The bot does not read this file — it re-renders from the `sections` blob in
// BotKnowledge on every question, so improving the renderer takes effect
// without a re-upload (see loadBotCorpus in routes/chat.js). This script exists
// so a human can see exactly what the model is being given, and diff it after
// editing the guide, without going through an upload and a chat message.
//
// It also prints the token cost, which is the number that actually matters:
// the corpus is paid for on every single question, and a fact added to the
// always-on part of the guide is charged far more often than one added to a
// test section that retrieval only sends when it is relevant.
//
// Usage:
//   node scripts/buildGuideCorpus.js                 # write the default pair
//   node scripts/buildGuideCorpus.js --stdout        # print, write nothing
//   node scripts/buildGuideCorpus.js --in <html> --out <txt>

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseCbatGuide, renderGuideCorpus } = require('../utils/cbatGuideParser');

const REPO = path.resolve(__dirname, '..', '..');
const DEFAULT_IN = path.join(REPO, 'APPLICATION_INFO', 'chat_dumps', 'CBAT_Complete_Guide_Public.html');
const DEFAULT_OUT = path.join(REPO, 'APPLICATION_INFO', 'chat_dumps', 'CBAT_Guide_Minified.txt');

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const inPath = path.resolve(arg('--in', DEFAULT_IN));
const outPath = path.resolve(arg('--out', DEFAULT_OUT));
const toStdout = process.argv.includes('--stdout');

if (!fs.existsSync(inPath)) {
  console.error(`No guide at ${inPath}`);
  process.exit(1);
}

let sections;
try {
  ({ sections } = parseCbatGuide(fs.readFileSync(inPath, 'utf8')));
} catch (err) {
  console.error(`Could not parse the guide: ${err.message}`);
  process.exit(1);
}

const corpus = renderGuideCorpus(sections);

if (toStdout) {
  process.stdout.write(corpus);
  process.exit(0);
}

fs.writeFileSync(outPath, corpus, 'utf8');

// A rough token count. Deliberately not a tokeniser dependency — this is for
// spotting that a change doubled the corpus, not for billing.
const tok = (s) => Math.round(s.length / 4);

// What one question costs is the always-on core plus the tests retrieval picks,
// so measure a single-test render too rather than only the whole thing.
const single = renderGuideCorpus(sections, { tests: (sections.TESTS ?? []).slice(0, 1) });
// Rendering no test sections at all leaves exactly the part every question pays
// for: the roster, the day, other services, the tools and the open questions.
const core = renderGuideCorpus(sections, { tests: [] });
const facts = [
  ...(sections.TESTS ?? []).map(t => t.facts),
  ...(sections.DAY_GROUPS ?? []).map(g => g.facts),
  ...(sections.OTHER ?? []).map(o => o.facts),
].flat().filter(Boolean).length;

const n = (v) => v.toLocaleString('en-GB');
console.log(`Wrote ${outPath}`);
console.log(`  tests            ${n((sections.TESTS ?? []).length)}`);
console.log(`  graded findings  ${n(facts)}`);
console.log(`  open questions   ${n((sections.OPEN ?? []).length)}`);
console.log(`  whole guide       ${n(corpus.length)} chars  ~${n(tok(corpus))} tokens`);
console.log(`  one-test question ${n(single.length)} chars  ~${n(tok(single))} tokens`);
console.log(`  always-on core    ${n(core.length)} chars  ~${n(tok(core))} tokens, paid on every question`);
