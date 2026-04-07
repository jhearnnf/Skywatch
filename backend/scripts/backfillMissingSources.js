/**
 * One-time backfill: generate and scrape sources for published briefs that have none.
 *
 * For each sourceless published brief, asks Perplexity Sonar (via OpenRouter)
 * to find 1–3 real published URLs about the subject, then scrapes each URL
 * for its actual publication date before writing to DB.
 *
 * Usage:
 *   cd backend && node scripts/backfillMissingSources.js          # dry run
 *   cd backend && node scripts/backfillMissingSources.js --apply  # write to DB
 */

require('dotenv').config();
const mongoose          = require('mongoose');
const IntelligenceBrief = require('../models/IntelligenceBrief');
const { enrichSourceDates } = require('../utils/scrapeArticleDate');

const DRY_RUN           = !process.argv.includes('--apply');
const INTER_BRIEF_DELAY = 1500; // ms between OpenRouter calls

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Strips markdown code fences and trims — mirrors cleanJson() in admin.js */
function cleanJson(raw) {
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

async function openRouterChat(messages, model = 'perplexity/sonar', maxTokens = 512) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_KEY}`,
      'Content-Type':  'application/json',
      'HTTP-Referer':  process.env.CLIENT_URL || 'http://localhost:5173',
      'X-Title':       'SkyWatch',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  return res.json();
}

async function generateSources(title, category) {
  const JSON_SHAPE = `Return ONLY valid JSON — no markdown, no code blocks:\n{"sources":[{"url":"https://actual-url.com/page","siteName":"Publication Name"},{"url":"https://second-url.com/page","siteName":"Publication Name"}]}`;
  const data = await openRouterChat([{
    role: 'system',
    content: 'You are a research assistant for a Royal Air Force educational platform. Find real, publicly accessible URLs that are authoritative sources about the given RAF subject. Prefer: the subject\'s Wikipedia page, raf.mod.uk, gov.uk/MOD, or reputable aviation/defence publications. Only return URLs that genuinely exist and are about this specific subject.',
  }, {
    role: 'user',
    content: `Find 1–3 real published URLs about this RAF subject: "${title}" (category: ${category}).\n\n${JSON_SHAPE}`,
  }]);
  const raw = data.choices?.[0]?.message?.content ?? '{}';
  const parsed = JSON.parse(cleanJson(raw));
  return Array.isArray(parsed.sources) ? parsed.sources : [];
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected to MongoDB  [${DRY_RUN ? 'DRY RUN — pass --apply to write' : 'APPLY MODE'}]\n`);

  const briefs = await IntelligenceBrief.find(
    { status: 'published', $or: [{ sources: { $exists: false } }, { sources: { $size: 0 } }] },
    '_id title category'
  ).lean();

  console.log(`Found ${briefs.length} published briefs with no sources.\n`);

  let succeeded = 0;
  let failed    = 0;

  for (const brief of briefs) {
    process.stdout.write(`[${brief.category}] ${brief.title} ... `);

    let sources;
    try {
      sources = await generateSources(brief.title, brief.category);
    } catch (err) {
      console.log(`FAIL (AI error: ${err.message})`);
      failed++;
      await sleep(INTER_BRIEF_DELAY);
      continue;
    }

    if (!sources.length) {
      console.log('SKIP (AI returned no sources)');
      failed++;
      await sleep(INTER_BRIEF_DELAY);
      continue;
    }

    // Scrape real publication dates
    let enriched;
    try {
      enriched = await enrichSourceDates(sources);
    } catch {
      enriched = sources;
    }

    const summary = enriched.map(s => `${s.siteName || s.url} (${s.articleDate ?? 'no date'})`).join(', ');
    console.log(`OK — ${enriched.length} source(s): ${summary}`);

    if (!DRY_RUN) {
      await IntelligenceBrief.updateOne({ _id: brief._id }, { $set: { sources: enriched } });
    }

    succeeded++;
    await sleep(INTER_BRIEF_DELAY);
  }

  console.log('\n── Summary ──────────────────────────────────────────');
  console.log(`Briefs processed: ${briefs.length}`);
  console.log(`Sources found   : ${succeeded}`);
  console.log(`Failed / skipped: ${failed}`);
  if (DRY_RUN) console.log('\nDry run — no changes written. Re-run with --apply to commit.');

  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
