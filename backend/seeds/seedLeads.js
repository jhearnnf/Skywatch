const path = require('path');
const fs   = require('fs');
const IntelLead = require('../models/IntelLead');

const LEADS_FILE = path.join(__dirname, '../../APPLICATION_INFO/intel_brief_leads.txt');

const SKIP = /^(SKYWATCH|Comprehensive seeding|All topics|LEGEND|END OF|Total categories|Approximate total|\[DB\]\s*=|News briefs are excluded)/i;

function parseLeadsFile(content) {
  const lines = content.split('\n');
  const leads = [];
  let currentSection    = '';
  let currentSubsection = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('=')) continue;
    if (/^SECTION\s+\d+:/i.test(trimmed)) { currentSection = trimmed; currentSubsection = ''; continue; }
    if (trimmed.startsWith('---') && trimmed.endsWith('---')) {
      currentSubsection = trimmed.replace(/^-+\s*/, '').replace(/\s*-+$/, '');
      continue;
    }
    if (SKIP.test(trimmed)) continue;

    const isPublished = trimmed.endsWith('[DB]');
    const text        = isPublished ? trimmed.slice(0, -4).trimEnd() : trimmed;

    leads.push({ text, section: currentSection, subsection: currentSubsection, isPublished });
  }

  return leads;
}

module.exports = async function seedLeads() {
  try {
    const existing = await IntelLead.countDocuments();
    if (existing > 0) {
      console.log(`seedLeads: ${existing} leads already in DB, skipping`);
      return;
    }

    if (!fs.existsSync(LEADS_FILE)) {
      console.log('seedLeads: leads file not found, skipping');
      return;
    }

    const content = fs.readFileSync(LEADS_FILE, 'utf8');
    const leads   = parseLeadsFile(content);

    if (leads.length === 0) {
      console.log('seedLeads: no leads parsed, skipping');
      return;
    }

    const ops = leads.map(lead => ({
      updateOne: {
        filter: { text: lead.text },
        update: { $setOnInsert: { text: lead.text, section: lead.section, subsection: lead.subsection, isPublished: lead.isPublished } },
        upsert: true,
      },
    }));

    const result = await IntelLead.bulkWrite(ops, { ordered: false });
    console.log(`seedLeads: ${result.upsertedCount} inserted, ${result.matchedCount} already existed`);
  } catch (err) {
    console.error('seedLeads error:', err.message);
  }
};

// Export parser for testing
module.exports.parseLeadsFile = parseLeadsFile;
