/**
 * One-shot migration: convert descriptionSections from legacy [string]
 * to canonical [{heading, body}], and backfill AI-generated headings on
 * sections 1 through (length-1). The final section (the flashcard-recall
 * summary) keeps an empty heading by design.
 *
 * Idempotent: a brief is skipped entirely if every element is already an
 * object with a present `body`. Partial shapes (e.g. missing body or
 * wrong types) are re-normalized.
 *
 * Usage:
 *   node backend/scripts/migrateDescriptionSections.js --dry-run
 *   node backend/scripts/migrateDescriptionSections.js
 *   node backend/scripts/migrateDescriptionSections.js --limit=5
 *   node backend/scripts/migrateDescriptionSections.js --id=<briefId>
 *
 * Flags:
 *   --dry-run     Preview what would change; no writes, no AI calls.
 *   --limit=N     Cap the number of briefs processed (useful for spot-checking).
 *   --id=<oid>    Only process a single brief by _id.
 *   --no-ai       Convert shape but skip LLM heading backfill (headings stay '').
 *   --delay=<ms>  Delay between LLM calls (default 400ms).
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const IntelligenceBrief = require('../models/IntelligenceBrief');
const { callOpenRouter } = require('../utils/openRouter');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const NO_AI   = args.includes('--no-ai');
const ONLY_ID = (args.find(a => a.startsWith('--id=')) || '').slice(5) || null;
const LIMIT   = Number((args.find(a => a.startsWith('--limit=')) || '').slice(8)) || null;
const DELAY   = Number((args.find(a => a.startsWith('--delay=')) || '').slice(8)) || 400;

const MODEL = 'openai/gpt-4o-mini';

const sleep = ms => new Promise(res => setTimeout(res, ms));

function stripCodeFence(raw) {
  if (!raw) return raw;
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

// Treat a brief as already migrated when every entry is an object with a
// body. Partial / mixed arrays get fully re-normalized.
function isFullyMigrated(sections) {
  if (!Array.isArray(sections) || sections.length === 0) return true;
  return sections.every(s =>
    s && typeof s === 'object' && !Array.isArray(s) &&
    typeof s.body === 'string' && typeof s.heading === 'string'
  );
}

function toObjectShape(sections) {
  if (!Array.isArray(sections)) return [];
  return sections
    .filter(s => s != null)
    .map(s => {
      if (typeof s === 'string') return { heading: '', body: s.trim() };
      return {
        heading: typeof s.heading === 'string' ? s.heading.trim() : '',
        body:    typeof s.body    === 'string' ? s.body.trim()    : '',
      };
    })
    .filter(s => s.body);
}

async function generateHeadings({ title, category, subcategory, sections }) {
  // Only sections 1..(n-1) need headings. The final section stays headingless.
  const headingCount = Math.max(0, sections.length - 1);
  if (headingCount === 0) return [];

  const numbered = sections
    .slice(0, headingCount)
    .map((s, i) => `Section ${i + 1}:\n${s.body}`)
    .join('\n\n---\n\n');

  const prompt = `You are labelling sections of an existing intelligence brief with short topic headings.

Brief title: "${title}"
Brief category: ${category}${subcategory ? ` · ${subcategory}` : ''}

For each of the ${headingCount} numbered section(s) below, produce a 2–5 word heading that summarises that section's specific subject matter. The heading must:
- Be plain text — no punctuation at the end, no markdown, no quotes.
- Reflect what THAT section covers (not the overall brief).
- NOT be a generic label like "Introduction", "Overview", "Summary", or "Section N".
- Use title case (e.g. "Role and Structure", "Service History", "Operational Reach").

Sections:

${numbered}

Return ONLY valid JSON — no markdown, no code blocks, no commentary:
{"headings":["Heading 1","Heading 2",${headingCount > 2 ? '"Heading 3"' : ''}${headingCount > 3 ? ',"Heading 4"' : ''}]}`;

  const data = await callOpenRouter({
    key:     'main',
    feature: 'migrate-description-headings',
    body: {
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 256,
    },
  });
  const raw = data?.choices?.[0]?.message?.content ?? '{}';
  let parsed;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch (err) {
    throw new Error(`Heading response was not valid JSON: ${err.message}. Raw: ${raw.slice(0, 200)}`);
  }
  const headings = Array.isArray(parsed.headings) ? parsed.headings : [];
  // Strip trailing punctuation / stray quotes, cap at 5 words
  return headings.slice(0, headingCount).map(h => {
    if (typeof h !== 'string') return '';
    return h
      .trim()
      .replace(/^["'“”]|["'“”]$/g, '')
      .replace(/[.:;,!?]+$/, '')
      .split(/\s+/)
      .slice(0, 5)
      .join(' ');
  });
}

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set — aborting. Run this from the backend dir with your .env present.');
    process.exit(1);
  }
  if (!NO_AI && !DRY_RUN && !process.env.OPENROUTER_KEY) {
    console.error('OPENROUTER_KEY is not set — aborting. Use --no-ai to run without LLM backfill.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected. DRY_RUN=${DRY_RUN} NO_AI=${NO_AI}${ONLY_ID ? ` ID=${ONLY_ID}` : ''}${LIMIT ? ` LIMIT=${LIMIT}` : ''}`);

  const query = ONLY_ID ? { _id: ONLY_ID } : {};
  let cursor = IntelligenceBrief
    .find(query)
    .select('title category subcategory descriptionSections')
    .cursor();

  let scanned = 0, alreadyMigrated = 0, shapeOnly = 0, fullyMigrated = 0, failed = 0, aiErrors = 0;
  const failures = [];

  for await (const brief of cursor) {
    if (LIMIT && scanned >= LIMIT) break;
    scanned++;

    const original = brief.descriptionSections;
    if (isFullyMigrated(original)) {
      alreadyMigrated++;
      continue;
    }

    const shaped = toObjectShape(original);
    if (shaped.length === 0) {
      // No usable body content — nothing to migrate.
      alreadyMigrated++;
      continue;
    }

    // Which sections still lack a heading? Only the non-final sections
    // need one; the last section is the name-free flashcard summary.
    const headingCount = Math.max(0, shaped.length - 1);
    const needsHeadings = shaped
      .slice(0, headingCount)
      .some(s => !s.heading);

    let newSections = shaped.map((s, i) => ({
      heading: i === shaped.length - 1 ? '' : (s.heading || ''),
      body:    s.body,
    }));

    if (!NO_AI && needsHeadings) {
      try {
        const headings = await generateHeadings({
          title:       brief.title,
          category:    brief.category,
          subcategory: brief.subcategory,
          sections:    newSections,
        });
        for (let i = 0; i < headings.length; i++) {
          if (headings[i] && !newSections[i].heading) {
            newSections[i] = { ...newSections[i], heading: headings[i] };
          }
        }
        await sleep(DELAY);
      } catch (err) {
        aiErrors++;
        console.warn(`  [${brief._id}] "${brief.title}" — heading AI call failed: ${err.message}`);
      }
    }

    const hasHeadings = newSections.slice(0, newSections.length - 1).some(s => s.heading);
    if (hasHeadings) fullyMigrated++;
    else             shapeOnly++;

    const preview = newSections.map((s, i) =>
      `  [${i + 1}] ${s.heading ? `"${s.heading}"` : '(no heading)'} — ${s.body.slice(0, 80).replace(/\s+/g, ' ')}${s.body.length > 80 ? '…' : ''}`
    ).join('\n');
    console.log(`\n${brief.title} (${brief._id})`);
    console.log(preview);

    if (!DRY_RUN) {
      try {
        brief.descriptionSections = newSections;
        brief.markModified('descriptionSections');
        await brief.save();
      } catch (err) {
        failed++;
        failures.push({ id: String(brief._id), title: brief.title, error: err.message });
        console.error(`  SAVE FAILED: ${err.message}`);
      }
    }
  }

  console.log(`\n────────────────────────────────────────`);
  console.log(`Scanned:           ${scanned}`);
  console.log(`Already migrated:  ${alreadyMigrated}`);
  console.log(`Shape-only (no AI headings applied): ${shapeOnly}`);
  console.log(`Fully migrated (AI headings applied): ${fullyMigrated}`);
  console.log(`AI errors:         ${aiErrors}`);
  console.log(`Save failures:     ${failed}`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f.id} "${f.title}": ${f.error}`);
  }
  if (DRY_RUN) console.log('\n(DRY RUN — no writes committed.)');

  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
