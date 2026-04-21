/**
 * listDisclaimerBriefs.js
 *
 * Scans IntelligenceBrief for briefs whose subtitle or descriptionSections
 * contain the "No verifiable connection / No RAF significance / No RAF
 * operational context" disclaimer phrases that Sonar emitted when asked to
 * frame non-RAF subjects (Actors, Threats, Treaties, AOR, Allies) through an
 * RAF-asset lens.
 *
 * Output only — does NOT regenerate. After the prompt fix has been deployed,
 * pass this list of brief IDs through the admin UI's existing
 * POST /api/admin/ai/regenerate-brief/:id flow, or call that endpoint in bulk.
 *
 * Usage:
 *   node backend/scripts/listDisclaimerBriefs.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose           = require('mongoose');
const IntelligenceBrief  = require('../models/IntelligenceBrief');

const DISCLAIMER_PATTERNS = [
  /no verifiable connection/i,
  /no RAF significance/i,
  /no RAF operational context/i,
  /no RAF training pathways/i,
  /no information on RAF/i,
  /no direct RAF connection/i,
  /no (?:documented )?(?:modern-day )?(?:RAF )?involvement/i,
];

function matches(text) {
  if (!text) return false;
  return DISCLAIMER_PATTERNS.some(re => re.test(text));
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB — scanning for disclaimer briefs');

  const briefs = await IntelligenceBrief.find({}, {
    title: 1, subtitle: 1, category: 1, subcategory: 1,
    descriptionSections: 1, historic: 1, status: 1,
  }).lean();

  const hits = [];
  for (const b of briefs) {
    const subtitleHit = matches(b.subtitle);
    const descHit     = (b.descriptionSections || []).some(matches);
    if (subtitleHit || descHit) {
      hits.push({
        _id:         b._id.toString(),
        title:       b.title,
        category:    b.category,
        subcategory: b.subcategory || '',
        status:      b.status,
        subtitleHit,
        descHit,
      });
    }
  }

  console.log(`\nScanned ${briefs.length} briefs — ${hits.length} match disclaimer patterns.\n`);

  const byCategory = hits.reduce((acc, h) => {
    (acc[h.category] ||= []).push(h);
    return acc;
  }, {});
  for (const [cat, list] of Object.entries(byCategory).sort()) {
    console.log(`\n=== ${cat} (${list.length}) ===`);
    for (const h of list) {
      const flags = [h.subtitleHit && 'subtitle', h.descHit && 'desc'].filter(Boolean).join('+');
      console.log(`  [${flags.padEnd(14)}] ${h._id}  ${h.title}${h.subcategory ? `  (${h.subcategory})` : ''}`);
    }
  }

  console.log(`\nNext step: regenerate each via admin UI or POST /api/admin/ai/regenerate-brief/:id`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
