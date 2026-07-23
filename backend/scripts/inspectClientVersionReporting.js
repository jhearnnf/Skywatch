/**
 * inspectClientVersionReporting.js
 *
 * READ-ONLY diagnostic. Pulls osSeen + lastClients for accounts so we can see
 * why a user shows an OS (from the heartbeat User-Agent) but "not reported yet"
 * for the app version (which rides in the heartbeat JSON body).
 *
 * Default: lists the most recently CREATED accounts and, for each, shows what
 * OSes they've been seen on vs. what version payloads (if any) landed. The
 * smoking gun for the reported bug is: osSeen has entries but lastClients is
 * all-null — a heartbeat reached us (UA parsed) but no valid client body ever
 * did.
 *
 * Optionally pass an email to inspect one specific account.
 *
 * Usage:
 *   node backend/scripts/inspectClientVersionReporting.js
 *   node backend/scripts/inspectClientVersionReporting.js someone@example.com
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User     = require('../models/User');

const OS_KEYS       = ['windows', 'mac', 'linux', 'ios', 'android'];
const PLATFORM_KEYS = ['web', 'android', 'ios'];

function fmtDate(d) {
  return d ? new Date(d).toISOString() : '—';
}

function osSummary(osSeen = {}) {
  const seen = OS_KEYS.filter(k => osSeen?.[k]).map(k => `${k}@${fmtDate(osSeen[k])}`);
  return seen.length ? seen.join(', ') : '(none)';
}

function clientsSummary(lastClients = {}) {
  const rows = [];
  for (const p of PLATFORM_KEYS) {
    const c = lastClients?.[p];
    if (c && c.version) {
      rows.push(`${p}: ${c.version}${c.build ? ` (${c.build})` : ''}  seen ${fmtDate(c.lastSeenAt)}`);
    }
  }
  return rows.length ? rows.join('\n      ') : '(all null — NO version payload ever recorded)';
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB (read-only inspection)\n');

  const emailArg = process.argv[2];

  const projection = { email: 1, createdAt: 1, lastSeen: 1, osSeen: 1, lastClients: 1 };

  let users;
  if (emailArg) {
    users = await User.find({ email: new RegExp(`^${emailArg}$`, 'i') }, projection).lean();
    if (!users.length) {
      console.log(`No user found with email ${emailArg}`);
      await mongoose.disconnect();
      return;
    }
  } else {
    users = await User.find({}, projection).sort({ createdAt: -1 }).limit(20).lean();
    console.log('Showing the 20 most recently created accounts.\n');
  }

  for (const u of users) {
    const osKeys      = OS_KEYS.filter(k => u.osSeen?.[k]);
    const hasVersion  = PLATFORM_KEYS.some(p => u.lastClients?.[p]?.version);
    const smokingGun  = osKeys.length > 0 && !hasVersion;

    console.log('────────────────────────────────────────────────────────');
    console.log(`${u.email}${smokingGun ? '   ⟵ OS seen but NO version (the reported symptom)' : ''}`);
    console.log(`  created:   ${fmtDate(u.createdAt)}`);
    console.log(`  lastSeen:  ${fmtDate(u.lastSeen)}`);
    console.log(`  osSeen:    ${osSummary(u.osSeen)}`);
    console.log(`  clients:   ${clientsSummary(u.lastClients)}`);
  }

  console.log('\n────────────────────────────────────────────────────────');
  console.log('Legend: "OS seen but NO version" = a heartbeat landed (UA → OS)');
  console.log('but no heartbeat body ever carried a valid { client } payload.');

  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
