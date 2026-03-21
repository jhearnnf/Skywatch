/**
 * linkAircraftBases.js
 *
 * Migration script: auto-links Aircraft briefs to their associated Bases briefs
 * by searching brief titles and body content for RAF base name mentions.
 *
 * Usage:
 *   node backend/scripts/linkAircraftBases.js           # dry-run (preview only)
 *   node backend/scripts/linkAircraftBases.js --apply   # write links to DB
 *   node backend/scripts/linkAircraftBases.js --force   # re-link already-linked briefs too
 *
 * Matching strategy (in priority order):
 *   1. Exact base name found in aircraft brief body (e.g. "RAF Coningsby")
 *   2. Base name found in brief title / subtitle
 *   3. Known canonical mappings for common RAF aircraft types
 *
 * The script never removes existing associations — it only adds.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const mongoose        = require('mongoose')
const IntelligenceBrief = require('../models/IntelligenceBrief')

// ── Canonical fallback mappings ───────────────────────────────────────────────
// Keyed by lowercase aircraft title keyword → array of lowercase base name keywords
// Used only when no match is found in the brief body.
const CANONICAL = {
  'typhoon':        ['coningsby', 'lossiemouth'],
  'eurofighter':    ['coningsby', 'lossiemouth'],
  'f-35':           ['marham'],
  'f35':            ['marham'],
  'lightning':      ['marham'],
  'tornado':        ['marham', 'lossiemouth'],
  'hercules':       ['brize norton'],
  'c-130':          ['brize norton'],
  'atlas':          ['brize norton'],
  'a400':           ['brize norton'],
  'voyager':        ['brize norton'],
  'a330':           ['brize norton'],
  'rc-135':         ['waddington'],
  'rivet joint':    ['waddington'],
  'e-3':            ['waddington'],
  'sentry':         ['waddington'],
  'shadow':         ['waddington'],
  'poseidon':       ['lossiemouth'],
  'p-8':            ['lossiemouth'],
  'wildcat':        ['yeovilton'],
  'merlin':         ['benson', 'yeovilton', 'odiam'],
  'puma':           ['benson'],
  'chinook':        ['odiham'],
  'apache':         ['wattisham'],
  'hawk':           ['valley', 'linton-on-ouse'],
  'king air':       ['cranwell', 'wittering'],
  'phenom':         ['cranwell'],
  'texan':          ['valley'],
  'tutor':          ['cranwell', 'barkston heath'],
  'vigilant':       ['cranwell'],
  'viking':         ['cranwell'],
  'sentinel':       ['waddington'],
  'globemaster':    ['brize norton'],
  'c-17':           ['brize norton'],
  'tristar':        ['brize norton'],
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalise(str) {
  return str.toLowerCase().replace(/[''`]/g, "'").replace(/\s+/g, ' ').trim()
}

/** Extracts plain text from a Quill delta ops array (if the body is stored as JSON). */
function extractText(body) {
  if (!body) return ''
  if (typeof body === 'string') {
    // Attempt to parse as Quill delta JSON
    try {
      const delta = JSON.parse(body)
      if (Array.isArray(delta?.ops)) {
        return delta.ops.map(op => (typeof op.insert === 'string' ? op.insert : '')).join(' ')
      }
    } catch { /* not JSON — plain text */ }
    return body
  }
  if (body?.ops) {
    return body.ops.map(op => (typeof op.insert === 'string' ? op.insert : '')).join(' ')
  }
  return ''
}

/** Returns matched Bases brief IDs for a given aircraft brief. */
function findMatches(aircraftBrief, basesBriefs) {
  const bodyText  = normalise(extractText(aircraftBrief.body))
  const titleText = normalise(aircraftBrief.title || '')

  const matched = new Set()

  // Strategy 1 + 2: search body and title for each base name
  for (const base of basesBriefs) {
    const baseName = normalise(base.title)
    // Trim leading "RAF " for more flexible matching
    const coreBaseName = baseName.replace(/^raf\s+/, '')

    if (bodyText.includes(baseName) || bodyText.includes(coreBaseName) ||
        titleText.includes(baseName) || titleText.includes(coreBaseName)) {
      matched.add(String(base._id))
    }
  }

  // Strategy 3: canonical fallback (only if nothing found yet)
  if (matched.size === 0) {
    for (const [keyword, baseKeywords] of Object.entries(CANONICAL)) {
      if (titleText.includes(keyword) || bodyText.includes(keyword)) {
        for (const baseKw of baseKeywords) {
          const found = basesBriefs.find(b => normalise(b.title).includes(baseKw))
          if (found) matched.add(String(found._id))
        }
      }
    }
  }

  return [...matched]
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  const apply  = process.argv.includes('--apply')
  const force  = process.argv.includes('--force')

  console.log('\n=== linkAircraftBases migration script ===')
  console.log(`Mode: ${apply ? 'APPLY (writing to DB)' : 'DRY-RUN (no changes)'}`)
  if (force) console.log('Flag: --force (will re-process already-linked briefs)\n')

  await mongoose.connect(process.env.MONGODB_URI)
  console.log('Connected to MongoDB\n')

  // Fetch all Bases briefs (id + title only)
  const basesBriefs = await IntelligenceBrief
    .find({ category: 'Bases' }, '_id title')
    .lean()

  if (basesBriefs.length === 0) {
    console.log('No Bases briefs found — nothing to do.')
    await mongoose.disconnect()
    return
  }
  console.log(`Found ${basesBriefs.length} Bases brief(s).\n`)

  // Fetch all Aircraft briefs (id + title + body + existing links)
  const aircraftBriefs = await IntelligenceBrief
    .find({ category: 'Aircrafts' }, '_id title body associatedBaseBriefIds')
    .lean()

  if (aircraftBriefs.length === 0) {
    console.log('No Aircraft briefs found — nothing to do.')
    await mongoose.disconnect()
    return
  }
  console.log(`Found ${aircraftBriefs.length} Aircraft brief(s).\n`)

  let updated = 0, skipped = 0, noMatch = 0

  for (const brief of aircraftBriefs) {
    const existingIds = (brief.associatedBaseBriefIds ?? []).map(id => String(id))

    if (existingIds.length > 0 && !force) {
      console.log(`  [SKIP] "${brief.title}" — already has ${existingIds.length} base(s) linked`)
      skipped++
      continue
    }

    const matchedIds = findMatches(brief, basesBriefs)

    // Filter to only new links (not already in existingIds)
    const newIds = matchedIds.filter(id => !existingIds.includes(id))

    if (newIds.length === 0 && matchedIds.length === 0) {
      console.log(`  [NONE] "${brief.title}" — no matching bases found`)
      noMatch++
      continue
    }

    if (newIds.length === 0) {
      console.log(`  [SKIP] "${brief.title}" — all matches already linked`)
      skipped++
      continue
    }

    // Resolve names for display
    const matchedNames = newIds.map(id => {
      const b = basesBriefs.find(x => String(x._id) === id)
      return b ? b.title : id
    })

    console.log(`  [LINK] "${brief.title}"`)
    console.log(`         → ${matchedNames.join(', ')}`)

    if (apply) {
      await IntelligenceBrief.findByIdAndUpdate(brief._id, {
        $addToSet: { associatedBaseBriefIds: { $each: newIds.map(id => new mongoose.Types.ObjectId(id)) } },
      })
    }
    updated++
  }

  console.log('\n─────────────────────────────────')
  console.log(`  Aircraft briefs processed : ${aircraftBriefs.length}`)
  console.log(`  Links to write            : ${updated}`)
  console.log(`  Already linked / skipped  : ${skipped}`)
  console.log(`  No match found            : ${noMatch}`)
  if (!apply) {
    console.log('\n  ⚠  DRY-RUN — no changes written.')
    console.log('  Re-run with --apply to commit these links.')
  } else {
    console.log('\n  ✓  Links written to database.')
  }
  console.log('─────────────────────────────────\n')

  await mongoose.disconnect()
}

run().catch(err => { console.error(err); process.exit(1) })
