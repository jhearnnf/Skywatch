/**
 * Grammar checker — scans all published brief descriptionSections via LanguageTool API
 * and writes a report to backend/scripts/grammar-report.json.
 *
 * Nothing in the database is touched.
 *
 * Usage:
 *   cd backend && node scripts/checkGrammar.js
 *
 * Optional filter (check one brief by title substring):
 *   cd backend && node scripts/checkGrammar.js "A400M"
 */

require('dotenv').config();
const mongoose = require('mongoose');
const https = require('https');
const querystring = require('querystring');
const fs = require('fs');
const path = require('path');
const IntelligenceBrief = require('../models/IntelligenceBrief');

const REPORT_PATH = path.join(__dirname, 'grammar-report.json');
const DELAY_MS = 1200; // stay well within LanguageTool free-tier rate limit

const titleFilter = process.argv[2] ? process.argv[2].toLowerCase() : null;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function checkText(text) {
  return new Promise((resolve, reject) => {
    const body = querystring.stringify({ text, language: 'en-GB' });
    const options = {
      hostname: 'api.languagetool.org',
      path: '/v2/check',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${data}`)); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const query = { status: 'published', descriptionSections: { $exists: true, $not: { $size: 0 } } };
  const briefs = await IntelligenceBrief.find(query, '_id title descriptionSections').lean();

  const filtered = titleFilter
    ? briefs.filter(b => b.title.toLowerCase().includes(titleFilter))
    : briefs;

  console.log(`Checking ${filtered.length} brief(s)${titleFilter ? ` matching "${titleFilter}"` : ''}...\n`);

  const report = [];

  for (const brief of filtered) {
    console.log(`  → ${brief.title}`);
    const briefIssues = [];

    for (let i = 0; i < brief.descriptionSections.length; i++) {
      const section = brief.descriptionSections[i];
      if (!section || !section.trim()) continue;

      let result;
      try {
        result = await checkText(section);
      } catch (err) {
        console.warn(`    [section ${i + 1}] API error: ${err.message}`);
        await sleep(DELAY_MS);
        continue;
      }

      for (const match of (result.matches || [])) {
        const flagged = section.slice(match.offset, match.offset + match.length);
        const suggestions = (match.replacements || []).slice(0, 3).map(r => r.value);

        briefIssues.push({
          sectionIndex: i,       // 0-based
          sectionNumber: i + 1,  // 1-based for readability
          ruleId: match.rule.id,
          message: match.message,
          flaggedText: flagged,
          context: match.context.text,
          contextOffset: match.context.offset,
          contextLength: match.context.length,
          suggestions,
          // Fill this in when reviewing — leave blank to skip
          approvedFix: '',
        });
      }

      await sleep(DELAY_MS);
    }

    if (briefIssues.length) {
      report.push({
        briefId: String(brief._id),
        title: brief.title,
        issues: briefIssues,
      });
      console.log(`    ${briefIssues.length} issue(s) found`);
    } else {
      console.log(`    clean`);
    }
  }

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`\nDone. Report written to ${REPORT_PATH}`);
  console.log(`Total briefs with issues: ${report.length}`);
  console.log(`Total issues: ${report.reduce((n, b) => n + b.issues.length, 0)}`);

  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
