/**
 * Applies grammar fixes from grammar-report.json to the database.
 *
 * HOW TO USE:
 *   1. Run checkGrammar.js first to generate grammar-report.json
 *   2. Open grammar-report.json and review each issue
 *   3. For issues you want to fix, set "approvedFix" to the corrected string
 *      (this replaces only the flaggedText within that section)
 *   4. Leave "approvedFix" as "" to skip an issue
 *   5. Run this script:
 *        cd backend && node scripts/applyGrammarFixes.js
 *
 * The script will preview every change before writing and ask for confirmation.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const IntelligenceBrief = require('../models/IntelligenceBrief');

const REPORT_PATH = path.join(__dirname, 'grammar-report.json');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

async function run() {
  if (!fs.existsSync(REPORT_PATH)) {
    console.error(`Report not found at ${REPORT_PATH}. Run checkGrammar.js first.`);
    process.exit(1);
  }

  const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));

  // Collect all approved fixes grouped by briefId
  const fixesByBrief = new Map();

  for (const entry of report) {
    const approved = entry.issues.filter(i => i.approvedFix && i.approvedFix.trim() !== '');
    if (!approved.length) continue;
    fixesByBrief.set(entry.briefId, { title: entry.title, fixes: approved });
  }

  if (!fixesByBrief.size) {
    console.log('No approved fixes found in report. Set "approvedFix" on issues you want to apply.');
    process.exit(0);
  }

  console.log(`\nApproved fixes for ${fixesByBrief.size} brief(s):\n`);

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB\n');

  for (const [briefId, { title, fixes }] of fixesByBrief) {
    const brief = await IntelligenceBrief.findById(briefId).lean();
    if (!brief) {
      console.warn(`  SKIP — brief not found: ${briefId} (${title})`);
      continue;
    }

    // Clone sections (normalized to {heading, body}) so we can preview changes
    const { normalizeSections } = require('../utils/descriptionSections');
    const updatedSections = normalizeSections(brief.descriptionSections);

    console.log(`── ${title} ──`);

    for (const fix of fixes) {
      const { sectionIndex, sectionNumber, flaggedText, approvedFix } = fix;
      const original = updatedSections[sectionIndex]?.body ?? '';

      if (!original.includes(flaggedText)) {
        console.warn(`  [Section ${sectionNumber}] Could not locate flaggedText in current DB content — skipping.`);
        console.warn(`  Flagged: "${flaggedText}"`);
        continue;
      }

      updatedSections[sectionIndex] = {
        ...updatedSections[sectionIndex],
        body: original.replace(flaggedText, approvedFix),
      };

      console.log(`  Section ${sectionNumber}:`);
      console.log(`    Before: ...${flaggedText}...`);
      console.log(`    After:  ...${approvedFix}...`);
    }

    const answer = await ask(`\n  Apply ${fixes.length} fix(es) to "${title}"? (y/n): `);
    if (answer.toLowerCase() !== 'y') {
      console.log('  Skipped.\n');
      continue;
    }

    await IntelligenceBrief.findByIdAndUpdate(briefId, { descriptionSections: updatedSections });
    console.log('  Saved.\n');
  }

  console.log('Done.');
  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
