/**
 * createStubForRafPolice.js
 *
 * One-off: materialises a status='stub' IntelligenceBrief for the orphan
 * "RAF Police" IntelLead identified by checkLeadsBriefsDiscrepancies.
 *
 * Idempotent — if a matching brief already exists, no-op.
 *
 * Usage:
 *   node backend/scripts/createStubForRafPolice.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const mongoose = require('mongoose');

const IntelLead         = require('../models/IntelLead');
const IntelligenceBrief = require('../models/IntelligenceBrief');

function normaliseLeadTitle(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);

  const lead = await IntelLead.findOne({ title: 'RAF Police' });
  if (!lead) { console.log('No "RAF Police" lead found — nothing to do.'); await mongoose.disconnect(); return; }

  const briefs = await IntelligenceBrief.find().select('title').lean();
  const norm = normaliseLeadTitle(lead.title);
  const existing = briefs.find(b => normaliseLeadTitle(b.title) === norm);
  if (existing) {
    console.log(`Brief already exists for "${lead.title}" (id=${existing._id}). No-op.`);
    await mongoose.disconnect();
    return;
  }

  const stub = await IntelligenceBrief.create({
    title:               lead.title,
    subtitle:            lead.subtitle || '',
    nickname:            lead.nickname || '',
    category:            lead.category,
    subcategory:         lead.subcategory || '',
    status:              'stub',
    historic:            lead.isHistoric ?? false,
    priorityNumber:      lead.priorityNumber ?? null,
    descriptionSections: [],
    keywords:            [],
    sources:             [],
  });

  console.log(`Created stub brief "${stub.title}" [${stub.category}] (id=${stub._id}).`);
  await mongoose.disconnect();
}

run().catch((err) => { console.error(err); process.exit(1); });
