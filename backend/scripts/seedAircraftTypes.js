/**
 * seedAircraftTypes.js
 *
 * Classifies every published Aircrafts intelligence brief into one of:
 *   fighter, bomber, transport, helicopter, trainer, recon, tanker, uav, other
 * and writes the result to gameData.aircraftType. Used by the DPT CBAT game
 * to pick the player's Fighter aircraft and the enemy aircraft pool.
 *
 * Usage:
 *   node backend/scripts/seedAircraftTypes.js --dry-run
 *   node backend/scripts/seedAircraftTypes.js               # write
 *   node backend/scripts/seedAircraftTypes.js --force       # overwrite existing
 *   node backend/scripts/seedAircraftTypes.js --chunk 30    # AI batch size
 *
 * By default skips briefs that already have gameData.aircraftType set; pass
 * --force to re-classify everything.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') })

const mongoose          = require('mongoose')
const IntelligenceBrief = require('../models/IntelligenceBrief')
const { callOpenRouter } = require('../utils/openRouter')

const TYPES = ['fighter', 'bomber', 'transport', 'helicopter', 'trainer', 'recon', 'tanker', 'uav', 'other']

// ── CLI args ─────────────────────────────────────────────────────────────────

const args     = process.argv.slice(2)
const getArg   = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null }
const hasFlag  = (f) => args.includes(f)

const DRY_RUN    = hasFlag('--dry-run')
const FORCE      = hasFlag('--force')
const CHUNK_SIZE = parseInt(getArg('--chunk') || '30', 10)

// ── OpenRouter ───────────────────────────────────────────────────────────────

async function openRouterChat(messages, maxTokens = 2048) {
  return callOpenRouter({
    key:     'main',
    feature: 'script-aircraft-types',
    body: {
      model: 'anthropic/claude-sonnet-4-5',
      messages,
      max_tokens: maxTokens,
    },
  })
}

const SYSTEM_PROMPT = `You classify military aircraft into one of these types:
  - fighter      : air-superiority / multirole combat aircraft (e.g. Eurofighter Typhoon, F-35, F-15, F-22)
  - bomber       : strategic or tactical bombers (e.g. B-52, B-2, Tu-95)
  - transport    : strategic or tactical airlifters (e.g. C-17, A400M, C-130)
  - helicopter   : rotary-wing aircraft of any role (e.g. Chinook, Apache, Wildcat, Merlin)
  - trainer     : primary/advanced training aircraft (e.g. Hawk T2, Texan T1, Tutor)
  - recon       : ISR / surveillance / AEW&C (e.g. E-7 Wedgetail, P-8 Poseidon, Sentinel, Shadow R1)
  - tanker      : air-to-air refuelling tankers (e.g. Voyager, KC-135, KC-46)
  - uav         : uncrewed aerial vehicles / drones (e.g. Protector, Reaper, Watchkeeper)
  - other       : anything that doesn't cleanly fit the above (gliders, ceremonial-only, civilian liaison)

Rules:
  - If an aircraft has a primary combat fighter role, classify as "fighter" even if it can also bomb.
  - Maritime patrol aircraft like P-8 Poseidon are "recon" (their core role is ISR).
  - Multi-role helicopters always go to "helicopter" regardless of armament.
  - Combat-capable trainers like Hawk are "trainer" if their PRIMARY UK role is training (Hawk T2 is a trainer).
  - When in doubt between two roles, pick the one matching the airframe's PRIMARY operational role.

Return ONLY a valid JSON array — no markdown, no explanation, no code fences:
[{ "id": "<id string>", "type": "<one of the types above>" }]`

async function classifyChunk(chunk) {
  const listText = chunk
    .map((b, i) => {
      const desc = (b.descriptionSections || [])
        .map(s => (typeof s === 'string' ? s : s?.body || ''))
        .filter(Boolean)
        .join(' ')
        .slice(0, 400)
      return `${i + 1}. [id:${b._id}] ${b.title}${b.nickname ? ` ("${b.nickname}")` : ''}${b.subtitle ? ` — ${b.subtitle}` : ''}${desc ? `\n   ${desc}` : ''}`
    })
    .join('\n\n')

  const data = await openRouterChat([
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Classify each of the following aircraft. Return JSON array only.\n\n${listText}`,
    },
  ])

  const raw     = data.choices?.[0]?.message?.content ?? '[]'
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const match   = cleaned.match(/\[[\s\S]*\]/)
  if (!match) throw new Error(`No JSON array in response:\n${raw.slice(0, 400)}`)
  const parsed = JSON.parse(match[0])

  // Validate types
  const invalid = parsed.filter(a => !TYPES.includes(a.type))
  if (invalid.length) {
    console.warn(`  ⚠ ${invalid.length} entries had invalid types — coercing to "other": ${invalid.map(a => a.type).join(', ')}`)
    for (const a of invalid) a.type = 'other'
  }
  return parsed
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔧 seedAircraftTypes${DRY_RUN ? '  [DRY RUN]' : ''}${FORCE ? '  [FORCE]' : ''}\n`)

  await mongoose.connect(process.env.MONGODB_URI)
  console.log('✓ Connected to MongoDB\n')

  const query = {
    category: 'Aircrafts',
    status:   'published',
  }
  if (!FORCE) {
    query.$or = [
      { 'gameData.aircraftType': { $exists: false } },
      { 'gameData.aircraftType': null },
      { 'gameData.aircraftType': '' },
    ]
  }

  const briefs = await IntelligenceBrief.find(query)
    .select('_id title nickname subtitle descriptionSections gameData.aircraftType')
    .lean()

  if (briefs.length === 0) {
    console.log('  No aircraft briefs to classify.')
    if (!FORCE) console.log('  (Pass --force to re-classify briefs that already have a type set.)')
    await mongoose.disconnect()
    return
  }

  console.log(`  Found ${briefs.length} aircraft brief(s). Processing in chunks of ${CHUNK_SIZE}…\n`)

  const chunks = []
  for (let i = 0; i < briefs.length; i += CHUNK_SIZE) chunks.push(briefs.slice(i, i + CHUNK_SIZE))

  const allAssignments = []
  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci]
    process.stdout.write(`  Chunk ${ci + 1}/${chunks.length} (${chunk.length} briefs)… `)
    try {
      const assignments = await classifyChunk(chunk)
      allAssignments.push(...assignments)
      console.log(`✓ (${assignments.length} classified)`)
    } catch (err) {
      console.log(`✗ (${err.message})`)
    }
  }

  // Build map by id string
  const typeMap = {}
  for (const a of allAssignments) {
    if (a.id && TYPES.includes(a.type)) typeMap[String(a.id)] = a.type
  }

  // Print classification grouped by type
  console.log('\n  Classifications:\n')
  const byType = {}
  for (const t of TYPES) byType[t] = []
  for (const b of briefs) {
    const t = typeMap[String(b._id)] ?? '???'
    if (byType[t]) byType[t].push(b.title)
    else (byType['???'] = byType['???'] || []).push(b.title)
  }
  for (const t of [...TYPES, '???']) {
    const list = byType[t] || []
    if (list.length === 0) continue
    console.log(`  ${t.padEnd(11)} (${list.length}):`)
    for (const title of list.sort()) console.log(`    - ${title}`)
  }

  const covered = briefs.filter(b => typeMap[String(b._id)] != null).length
  console.log(`\n  Coverage: ${covered}/${briefs.length}`)

  if (DRY_RUN) {
    console.log('  DRY RUN — no changes written.\n')
    await mongoose.disconnect()
    return
  }

  let updated = 0
  await Promise.all(briefs.map(async b => {
    const t = typeMap[String(b._id)]
    if (!t) return
    const r = await IntelligenceBrief.updateOne(
      { _id: b._id },
      { $set: { 'gameData.aircraftType': t } },
    )
    if (r.modifiedCount) updated++
  }))

  console.log(`  ✓ Updated ${updated} brief(s)\n`)
  await mongoose.disconnect()
}

main().catch(err => {
  console.error('Fatal:', err.message)
  mongoose.disconnect()
  process.exit(1)
})
