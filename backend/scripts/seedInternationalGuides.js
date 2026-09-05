/**
 * seedInternationalGuides.js
 *
 * Adds the Canadian and Australian aircrew selection guides to the Community
 * rail's Guides section, staged as admin only so nobody but an admin sees them
 * until they are released.
 *
 * Usage:
 *   node backend/scripts/seedInternationalGuides.js --dry-run
 *   node backend/scripts/seedInternationalGuides.js
 *
 * Idempotent, and matched on `url` rather than title: re-running it updates the
 * existing rows instead of creating duplicates, so it is safe to run again
 * after editing the copy below. It will NOT re-hide a guide you have already
 * published: `adminOnly` is only ever set on creation, because turning it back
 * on for a live guide would silently pull it out of everyone's rail. Use the
 * admin console to change that flag once a guide exists.
 *
 * Note this connects to whatever MONGODB_URI is in backend/.env, which locally
 * is the deployed database. It only ever touches these two rows.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') })

const mongoose  = require('mongoose')
const ChatGuide = require('../models/ChatGuide')

const DRY = process.argv.includes('--dry-run')

// order 10 and 11 put them after the UK guide, which sits at the default 0,
// without needing to renumber anything that already exists.
//
// The URLs carry the .html extension ON PURPOSE, and the UK guide's row does
// the same. The Community rail decides how to render a link by looking for a
// file extension: without one it treats the row as an app route and hands it to
// react-router, which has no route for a static document and lands the reader
// on the SPA's 404 (or, in slim mode, bounces them to /cbat). With one, the
// card becomes a plain anchor and does a full page load, which is what a
// document outside the bundle needs. The clean /cbat-guide-canada URL still
// works for anything typed or linked from outside the app.
const GUIDES = [
  {
    url:         '/cbat-guide-canada.html',
    title:       'Canadian Aircrew Selection',
    description: 'CFAST at Trenton: the two days, the battery and the real pass rates',
    emoji:       '🇨🇦',
    order:       10,
  },
  {
    url:         '/cbat-guide-australia.html',
    title:       'ADF Aviation Screening',
    description: 'MACTS at East Sale, and the two earlier tests people prepare for by mistake',
    emoji:       '🇦🇺',
    order:       11,
  },
]

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set. Add it to backend/.env.')
    process.exit(1)
  }
  await mongoose.connect(process.env.MONGODB_URI)

  for (const g of GUIDES) {
    const existing = await ChatGuide.findOne({ url: g.url })

    if (!existing) {
      console.log(`${DRY ? '[dry-run] would create' : 'creating'}  ${g.title}  (admin only)`)
      if (!DRY) await ChatGuide.create({ ...g, isHidden: false, adminOnly: true })
      continue
    }

    // Copy edits flow through; visibility does not. See the note at the top.
    const changes = ['title', 'description', 'emoji', 'order']
      .filter(k => existing[k] !== g[k])
    if (!changes.length) {
      console.log(`unchanged        ${g.title}`)
      continue
    }
    console.log(`${DRY ? '[dry-run] would update' : 'updating'}  ${g.title}  (${changes.join(', ')})`)
    if (!DRY) {
      Object.assign(existing, {
        title: g.title, description: g.description, emoji: g.emoji, order: g.order,
      })
      existing.updatedAt = new Date()
      await existing.save()
    }
  }

  await mongoose.disconnect()
  console.log(DRY ? '\nDry run. Nothing was written.' : '\nDone.')
}

main().catch(async (err) => {
  console.error(err)
  await mongoose.disconnect().catch(() => {})
  process.exit(1)
})
