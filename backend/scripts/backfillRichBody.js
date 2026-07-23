/**
 * backfillRichBody.js
 *
 * One-shot: fixes UpdateNotifications that were saved with rich HTML in the
 * `body` field (created between the rich-text editor change and the
 * body/richBody split). Older clients render `body` as plain text, so those
 * notifications currently show raw <b>…</b> tags on any not-yet-updated client.
 *
 * For each affected doc it moves the HTML into `richBody` and replaces `body`
 * with a derived plain-text version (formatting stripped, <br>/blocks → newlines,
 * links kept as [label](url) markdown so the fallback stays clickable).
 *
 * Only touches docs whose `richBody` is empty AND whose `body` still contains
 * our rich-text tags, so it is safe to re-run (idempotent).
 *
 * Usage:
 *   node backend/scripts/backfillRichBody.js           # dry run (default)
 *   node backend/scripts/backfillRichBody.js --apply    # actually writes
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const UpdateNotification = require('../models/UpdateNotification');

const APPLY = process.argv.includes('--apply');

const RICH_TAG_RE = /<(b|strong|i|em|u|span|a|br)\b/i;

function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&'); // last, so "&amp;lt;" doesn't become "<"
}

// Regex-based HTML → plain text. Input here is our own sanitized inline HTML
// (b/strong/i/em/u/span/a/br), so a full DOM parser isn't needed.
function deriveText(html) {
  let s = String(html || '');
  // Links → [label](url) markdown (or just the url when label === href).
  s = s.replace(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => {
    const label = inner.replace(/<[^>]+>/g, '');
    return (label && href && label !== href) ? `[${label}](${href})` : (href || label);
  });
  s = s.replace(/<br\s*\/?>/gi, '\n');   // line breaks
  s = s.replace(/<\/(div|p)>/gi, '\n');  // block boundaries
  s = s.replace(/<[^>]+>/g, '');         // strip remaining tags
  s = decodeEntities(s);
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI missing from backend/.env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`Connected to MongoDB${APPLY ? '' : ' (DRY RUN — pass --apply to write)'}`);

  // Candidates: no rich version yet, and a body that still looks like HTML.
  const candidates = await UpdateNotification.find({
    $or: [{ richBody: { $exists: false } }, { richBody: '' }],
    body: /</,
  }).lean();

  const affected = candidates.filter(d => RICH_TAG_RE.test(d.body || ''));

  console.log(`\nNotifications total scanned (HTML-looking, no richBody): ${candidates.length}`);
  console.log(`Will backfill: ${affected.length}`);

  if (affected.length === 0) {
    console.log('\nNothing to do.');
    await mongoose.disconnect();
    return;
  }

  for (const d of affected) {
    const newBody = deriveText(d.body);
    console.log(`\n• ${d._id}  "${d.title}"`);
    console.log(`    richBody (from body): ${JSON.stringify(d.body).slice(0, 120)}${d.body.length > 120 ? '…' : ''}`);
    console.log(`    body    (derived):    ${JSON.stringify(newBody).slice(0, 120)}${newBody.length > 120 ? '…' : ''}`);

    if (APPLY) {
      await UpdateNotification.updateOne(
        { _id: d._id },
        { $set: { richBody: d.body, body: newBody } },
      );
    }
  }

  if (!APPLY) {
    console.log('\nDry run — pass --apply to write.');
  } else {
    console.log(`\nUpdated ${affected.length} notification(s).`);
  }

  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
