/**
 * generatePriorityNumbers.js
 *
 * Sends all IntelLead entries for a category to the AI and asks it to assign
 * priority numbers based on what an RAF applicant most urgently needs to know.
 * Writes back to both IntelLead AND the matching IntelligenceBrief (by title),
 * so priorities survive DB resets (seedLeads.js preserves them on re-seed).
 *
 * Usage:
 *   node backend/scripts/generatePriorityNumbers.js --category Bases
 *   node backend/scripts/generatePriorityNumbers.js --category Aircrafts --dry-run
 *   node backend/scripts/generatePriorityNumbers.js --all
 *   node backend/scripts/generatePriorityNumbers.js --category Bases --clear
 *
 * Options:
 *   --category <name>   Category to process
 *   --all               Process all 8 pathway categories in sequence
 *   --dry-run           Print proposed assignments without writing
 *   --clear             Set priorityNumber=null for all leads/briefs in category
 *   --chunk <n>         AI batch size (default 60)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') })

const mongoose        = require('mongoose')
const IntelLead       = require('../models/IntelLead')
const IntelligenceBrief = require('../models/IntelligenceBrief')
const { callOpenRouter } = require('../utils/openRouter')

// ── CLI args ─────────────────────────────────────────────────────────────────

const args     = process.argv.slice(2)
const getArg   = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null }
const hasFlag  = (f) => args.includes(f)

const CATEGORY   = getArg('--category')
const ALL        = hasFlag('--all')
const DRY_RUN    = hasFlag('--dry-run')
const CLEAR      = hasFlag('--clear')
const CHUNK_SIZE = parseInt(getArg('--chunk') || '200', 10)

const PATHWAY_CATEGORIES = ['Bases', 'Aircrafts', 'Ranks', 'Squadrons', 'Training', 'Roles', 'Threats', 'Missions', 'Terminology', 'Heritage', 'Allies', 'AOR', 'Tech', 'Treaties']

if (!CATEGORY && !ALL) {
  console.error('Usage: node backend/scripts/generatePriorityNumbers.js --category <Name> [--dry-run]')
  console.error('       node backend/scripts/generatePriorityNumbers.js --all [--dry-run]')
  process.exit(1)
}

// ── OpenRouter ────────────────────────────────────────────────────────────────

async function openRouterChat(messages, maxTokens = 4096) {
  return callOpenRouter({
    key:     'main',
    feature: 'script-priority-numbers',
    body: {
      model: 'anthropic/claude-sonnet-4-5',
      messages,
      max_tokens: maxTokens,
    },
  })
}

// ── AI priority assignment ────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are helping prioritise learning content for a UK Royal Air Force knowledge app.
The target user is someone actively preparing for an RAF application. They need up-to-date,
relevant knowledge of current RAF operations, aircraft, bases, ranks, roles, and structure.

You will be given a numbered list of Intel Brief titles with their category and subcategory.
Assign each brief a PRIORITY NUMBER starting from 1:
  - Priority 1 = most important to learn first (current, operational, directly relevant to applications)
  - Higher numbers = supplementary detail, historic context, or specialist/niche knowledge
  - Within a category, prioritise: active/current items over retired/historic ones
  - Prioritise items an RAF interviewer is most likely to ask about

Return ONLY a valid JSON array — no markdown, no explanation, no code fences:
[{ "id": "<id string>", "priority": <integer> }]`

async function assignPrioritiesForChunk(chunk, category) {
  const listText = chunk
    .map((l, i) => `${i + 1}. [id:${l._id}] ${l.title}${l.subtitle ? ` — ${l.subtitle}` : ''}${l.subcategory ? ` (${l.subcategory})` : ''}`)
    .join('\n')

  const data = await openRouterChat([
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Category: ${category}\n\n${listText}\n\nAssign priority numbers. Priority 1 = most important for an RAF applicant to learn first. Return JSON array only.`,
    },
  ])

  const raw     = data.choices?.[0]?.message?.content ?? '[]'
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const match   = cleaned.match(/\[[\s\S]*\]/)
  if (!match) throw new Error(`No JSON array in response:\n${raw.slice(0, 400)}`)
  return JSON.parse(match[0])
}

// ── Process one category ──────────────────────────────────────────────────────

async function processCategory(category) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`  Category: ${category}${DRY_RUN ? '  [DRY RUN]' : ''}${CLEAR ? '  [CLEAR]' : ''}`)
  console.log(`${'─'.repeat(60)}`)

  if (CLEAR) {
    if (!DRY_RUN) {
      await Promise.all([
        IntelLead.updateMany(        { category }, { $set: { priorityNumber: null } }),
        IntelligenceBrief.updateMany({ category }, { $set: { priorityNumber: null } }),
      ])
      console.log(`  ✓ Cleared priorityNumber for all ${category} leads and briefs`)
    } else {
      console.log(`  DRY RUN: would clear priorityNumber for all ${category} entries`)
    }
    return
  }

  // Fetch all leads for this category (source of truth — includes stubs not yet published)
  const leads = await IntelLead.find({ category }, '_id title subtitle subcategory').lean()

  if (leads.length === 0) {
    console.log(`  No leads found for category: ${category}`)
    return
  }

  console.log(`  Found ${leads.length} lead(s). Processing in chunks of ${CHUNK_SIZE}…`)

  // Chunk and call AI
  const chunks = []
  for (let i = 0; i < leads.length; i += CHUNK_SIZE) chunks.push(leads.slice(i, i + CHUNK_SIZE))

  const allAssignments = []
  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci]
    process.stdout.write(`  Chunk ${ci + 1}/${chunks.length} (${chunk.length} leads)… `)
    const assignments = await assignPrioritiesForChunk(chunk, category)
    allAssignments.push(...assignments)
    console.log(`✓ (${assignments.length} assigned)`)
  }

  // Build priority map by lead _id string
  const priorityMap = {}
  for (const a of allAssignments) {
    if (a.id && typeof a.priority === 'number') priorityMap[String(a.id)] = a.priority
  }

  // Print sorted summary
  console.log('\n  Priority order:')
  const sorted = [...leads].sort((a, b) => (priorityMap[String(a._id)] ?? 9999) - (priorityMap[String(b._id)] ?? 9999))
  for (const l of sorted) {
    const p = priorityMap[String(l._id)]
    console.log(`    [${p != null ? String(p).padStart(3) : '???'}]  ${l.title}`)
  }

  const covered = leads.filter(l => priorityMap[String(l._id)] != null).length
  console.log(`\n  Coverage: ${covered}/${leads.length}`)

  if (DRY_RUN) {
    console.log('  DRY RUN — no changes written.\n')
    return
  }

  // Write to IntelLead and IntelligenceBrief in parallel (matched by _id for leads, by title for briefs)
  let leadUpdated = 0, briefUpdated = 0
  await Promise.all(leads.map(async l => {
    const p = priorityMap[String(l._id)]
    if (p == null) return
    const [lr, br] = await Promise.all([
      IntelLead.updateOne(         { _id: l._id },   { $set: { priorityNumber: p } }),
      IntelligenceBrief.updateOne( { title: l.title },{ $set: { priorityNumber: p } }),
    ])
    if (lr.modifiedCount) leadUpdated++
    if (br.modifiedCount) briefUpdated++
  }))

  console.log(`  ✓ Updated ${leadUpdated} lead(s), ${briefUpdated} brief(s)\n`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔧 generatePriorityNumbers\n')

  await mongoose.connect(process.env.MONGODB_URI)
  console.log('✓ Connected to MongoDB\n')

  const categories = ALL ? PATHWAY_CATEGORIES : [CATEGORY]

  for (const cat of categories) {
    await processCategory(cat)
    // Brief pause between categories when running --all, to be polite to the API
    if (ALL && categories.indexOf(cat) < categories.length - 1) {
      await new Promise(r => setTimeout(r, 1500))
    }
  }

  await mongoose.disconnect()
  console.log('✓ Done\n')
}

main().catch(err => {
  console.error('Fatal:', err.message)
  mongoose.disconnect()
  process.exit(1)
})
