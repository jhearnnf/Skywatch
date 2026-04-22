/**
 * applyDriftDecisions.js
 *
 * One-off: resolves the 77 lead/brief subtitle drifts by applying a pre-
 * decided direction for each entry. Direction:
 *   L  → use lead's subtitle, overwrite brief
 *   B  → use brief's subtitle, overwrite lead
 *   M  → use the supplied custom subtitle on BOTH
 *
 * Criteria used when picking (for audit):
 *   - Factual correctness wins (e.g. Grob Prefect not Tutor; No. 4 Sqn at
 *     Valley/Hawk, not Lossiemouth/Typhoon)
 *   - Prefer operationally specific one-liners over encyclopedic prose
 *   - Strip disallowed "applicant" language (see IntelLead #62)
 *
 * Runs dry-run first, prints the diff, then applies.
 *
 * Usage:
 *   node backend/scripts/applyDriftDecisions.js
 *   node backend/scripts/applyDriftDecisions.js --dry-run
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env'), quiet: true });
const mongoose = require('mongoose');
const IntelLead         = require('../models/IntelLead');
const IntelligenceBrief = require('../models/IntelligenceBrief');

const DRY = process.argv.includes('--dry-run');

// dir: 'L' (lead wins), 'B' (brief wins), 'M' (custom)
// `value` is only used when dir === 'M'.
const DECISIONS = [
  { n:  1, title: 'Sergeant',                                               leadId: '69ce4f7de66929836561495b', briefId: '69ce4f7de669298365614caf', dir: 'B' },
  { n:  2, title: 'Flight Operations Officer',                              leadId: '69ce4f7de669298365614966', briefId: '69ce4f7de669298365614cba', dir: 'B' },
  { n:  3, title: 'Eurofighter Typhoon T3',                                 leadId: '69ce4f7de6692983656149b1', briefId: '69ce4f7de669298365614d05', dir: 'L' },
  { n:  4, title: 'RAF Cranwell',                                           leadId: '69ce4f7de6692983656149ff', briefId: '69ce4f7de669298365614d53', dir: 'L' },
  { n:  5, title: 'RAF Cosford',                                            leadId: '69ce4f7de669298365614a06', briefId: '69ce4f7de669298365614d5a', dir: 'L' },
  { n:  6, title: 'Professionally Qualified Officers commissioning',        leadId: '69ce4f7de669298365614a33', briefId: '69ce4f7de669298365614d87', dir: 'L' },
  { n:  7, title: 'Houthi movement',                                        leadId: '69ce4f7de669298365614a70', briefId: '69ce4f7de669298365614dc4', dir: 'B' },
  { n:  8, title: 'AUKUS Pillar 2',                                         leadId: '69ce4f7de669298365614a97', briefId: '69ce4f7de669298365614deb', dir: 'L' },
  { n:  9, title: 'Operation EPIC FURY',                                    leadId: '69ce4f7de669298365614aca', briefId: '69ce4f7de669298365614e1e', dir: 'L' },
  { n: 10, title: 'AN/AAQ-37 DAS',                                          leadId: '69ce4f7de669298365614adc', briefId: '69ce4f7de669298365614e30', dir: 'L' },
  { n: 11, title: 'Air Engineer Officer',                                   leadId: '69ce4f7de669298365614965', briefId: '69ce4f7de669298365614cb9', dir: 'L' },
  { n: 12, title: 'No. 11 Squadron RAF',                                    leadId: '69ce4f7de66929836561497a', briefId: '69ce4f7de669298365614cce', dir: 'L' },
  { n: 13, title: 'P-8A Poseidon MRA1',                                     leadId: '69ce4f7de6692983656149ba', briefId: '69ce4f7de669298365614d0e', dir: 'L' },
  { n: 14, title: 'RAF Odiham',                                             leadId: '69ce4f7de6692983656149fb', briefId: '69ce4f7de669298365614d4f', dir: 'L' },
  { n: 15, title: 'RAF Shawbury',                                           leadId: '69ce4f7de6692983656149fe', briefId: '69dd588e329962c1d1b84d19', dir: 'L' },
  { n: 16, title: 'Operation PELEGRI',                                      leadId: '69ce4f7de669298365614acc', briefId: '69ce4f7de669298365614e20', dir: 'L' },
  { n: 17, title: 'Air Specialist (Class 2)',                               leadId: '69ce4f7de66929836561495f', briefId: '69de60a736ab69b15ad05dee', dir: 'B' },
  { n: 18, title: 'No. 6 Squadron RAF',                                     leadId: '69ce4f7de669298365614975', briefId: '69ce4f7de669298365614cc9', dir: 'L' },
  { n: 19, title: 'No. 617 Squadron RAF',                                   leadId: '69ce4f7de6692983656149ac', briefId: '69ce4f7de669298365614d00', dir: 'L' },
  { n: 20, title: 'A330 MRTT Voyager KC2/KC3',                              leadId: '69ce4f7de6692983656149bb', briefId: '69ce4f7de669298365614d0f', dir: 'L' },
  { n: 21, title: 'RAF Honington',                                          leadId: '69ce4f7de669298365614a04', briefId: '69ce4f7de669298365614d58', dir: 'L' },
  { n: 22, title: 'RAF Akrotiri',                                           leadId: '69ce4f7de669298365614a1a', briefId: '69ce4f7de669298365614d6e', dir: 'L' },
  { n: 23, title: 'Operation CABRIT',                                       leadId: '69ce4f7de669298365614ac9', briefId: '69ce4f7de669298365614e1d', dir: 'L' },
  { n: 24, title: 'Humanitarian Assistance / Disaster Relief',              leadId: '69ce4f7de669298365614b01', briefId: '69ce4f7de669298365614e55', dir: 'B' },
  { n: 25, title: 'Forward Air Controller',                                 leadId: '69ce4f7de669298365614969', briefId: '69ce4f7de669298365614cbd', dir: 'L' },
  { n: 26, title: 'No. 9 Squadron RAF',                                     leadId: '69ce4f7de669298365614978', briefId: '69ce4f7de669298365614ccc', dir: 'L' },
  { n: 27, title: 'Protector RG1',                                          leadId: '69ce4f7de6692983656149b8', briefId: '69ce4f7de669298365614d0c', dir: 'L' },
  { n: 28, title: 'RAF Benson',                                             leadId: '69ce4f7de6692983656149fc', briefId: '69ce4f7de669298365614d50', dir: 'L' },
  { n: 29, title: 'RAF Valley',                                             leadId: '69ce4f7de6692983656149fd', briefId: '69ce4f7de669298365614d51', dir: 'L' },
  { n: 30, title: 'RAF Leeming',                                            leadId: '69ce4f7de669298365614a01', briefId: '69ce4f7de669298365614d55', dir: 'L' },
  { n: 31, title: 'Adult Recruit Training Course',                          leadId: '69ce4f7de669298365614a32', briefId: '69ce4f7de669298365614d86', dir: 'B' },
  { n: 32, title: 'Elementary Flying Training',                             leadId: '69ce4f7de669298365614a34', briefId: '69ce4f7de669298365614d88', dir: 'B' },
  { n: 33, title: 'Electronic warfare jamming of GPS / datalinks',          leadId: '69ce4f7de669298365614a7e', briefId: '69ce4f7de669298365614dd2', dir: 'L' },
  { n: 34, title: 'Close Air Support',                                      leadId: '69ce4f7de669298365614af8', briefId: '69ce4f7de669298365614e4c', dir: 'L' },
  { n: 35, title: 'Air Specialist (Class 1)',                               leadId: '69ce4f7de66929836561495e', briefId: '69de60a536ab69b15ad05dc5', dir: 'B' },
  { n: 36, title: 'Survival Evasion Resistance Extraction Instructor',     leadId: '69ce4f7de66929836561496a', briefId: '69ce4f7de669298365614cbe', dir: 'B' },
  { n: 37, title: 'No. 4 Squadron RAF',                                     leadId: '69ce4f7de669298365614973', briefId: '69ce4f7de669298365614cc7', dir: 'B' },
  { n: 38, title: 'NATO Icelandic Air Policing',                            leadId: '69ce4f7de669298365614ac3', briefId: '69ce4f7de669298365614e17', dir: 'L' },
  { n: 39, title: 'Operation AZALEA',                                       leadId: '69ce4f7de669298365614ac4', briefId: '69ce4f7de669298365614e18', dir: 'L' },
  { n: 40, title: 'RC-135W Rivet Joint',                                    leadId: '69ce4f7de6692983656149b5', briefId: '69ce4f7de669298365614d09', dir: 'L' },
  { n: 41, title: 'RAF High Wycombe',                                       leadId: '69ce4f7de669298365614a03', briefId: '69ce4f7de669298365614d57', dir: 'L' },
  { n: 42, title: 'RAF Halton',                                             leadId: '69ce4f7de669298365614a05', briefId: '69ce4f7de669298365614d59', dir: 'L' },
  { n: 43, title: 'MANPADS',                                                leadId: '69ce4f7de669298365614a6d', briefId: '69ce4f7de669298365614dc1', dir: 'L' },
  { n: 44, title: 'Russian GRU cyber operations',                           leadId: '69ce4f7de669298365614a7d', briefId: '69ce4f7de669298365614dd1', dir: 'L' },
  { n: 45, title: 'AN/APG-81 AESA Radar',                                   leadId: '69ce4f7de669298365614ada', briefId: '69ce4f7de669298365614e2e', dir: 'L' },
  { n: 46, title: 'Defensive Counter Air',                                  leadId: '69ce4f7de669298365614af6', briefId: '69ce4f7de669298365614e4a', dir: 'L' },
  { n: 47, title: 'Non-Commissioned Aircrew Training',                      leadId: '69ce4f7de669298365614a31', briefId: '69ce4f7de669298365614d85', dir: 'L' },
  { n: 48, title: 'Storm Shadow / SCALP-EG',                                leadId: '69ce4f7de669298365614ad3', briefId: '69ce4f7de669298365614e27', dir: 'L' },
  { n: 49, title: 'Corporal',                                               leadId: '69ce4f7de66929836561495c', briefId: '69ce4f7de669298365614cb0', dir: 'L' },
  { n: 50, title: 'Air Loadmaster',                                         leadId: '69ce4f7de669298365614964', briefId: '69ce4f7de669298365614cb8', dir: 'L' },
  { n: 51, title: 'E-7A Wedgetail',                                         leadId: '69ce4f7de6692983656149b9', briefId: '69ce4f7de669298365614d0d', dir: 'L' },
  { n: 52, title: 'Sky Sabre / CAMM',                                       leadId: '69ce4f7de6692983656149c9', briefId: '69ce4f7de669298365614d1d', dir: 'L' },
  { n: 53, title: 'Anti-Satellite weapons',                                 leadId: '69ce4f7de669298365614a81', briefId: '69ce4f7de669298365614dd5', dir: 'L' },
  { n: 54, title: 'ROE',                                                    leadId: '69ce4f7de669298365614b2b', briefId: '69ce4f7de669298365614e7f', dir: 'L' },
  { n: 55, title: 'Allied Air Command',                                     leadId: '69ce4f7de669298365614b59', briefId: '69ce4f7de669298365614ead', dir: 'L' },
  { n: 56, title: 'NATO Allied Air Command',                                leadId: '69ce4f7de669298365614b8c', briefId: '69ce4f7de669298365614ee0', dir: 'L' },
  { n: 57, title: 'Supply Chain Specialist',                                leadId: '69ce4f7de669298365614bdb', briefId: '69ce4f7de669298365614f2f', dir: 'L' },
  { n: 58, title: 'Joint Air Defence Operations Centre',                    leadId: '69ce4f7de669298365614b58', briefId: '69ce4f7de669298365614eac', dir: 'L' },
  { n: 59, title: 'Space Operations Officer',                               leadId: '69ce4f7de669298365614bce', briefId: '69ce4f7de669298365614f22', dir: 'L' },
  { n: 60, title: 'Op SHADER AOR',                                          leadId: '69ce4f7de669298365614b60', briefId: '69ce4f7de669298365614eb4', dir: 'L' },
  { n: 61, title: 'RAF Aircrew Medical Standards',                          leadId: '69ce4f7de669298365614bb7', briefId: '69ce4f7de669298365614f0b', dir: 'L' },
  { n: 62, title: 'RFC to RAF Transition 1918',                             leadId: '69ce4f7de669298365614c97', briefId: '69ce4f7de669298365614feb', dir: 'M',
           value: 'The creation of the Royal Air Force on 1 April 1918 by merging the Royal Flying Corps and Royal Naval Air Service — the first independent air force in the world; driven by the Smuts Report' },
  { n: 63, title: 'No. 1 Parachute Training School',                        leadId: '69ce4f7de669298365614bb8', briefId: '69ce4f7de669298365614f0c', dir: 'L' },
  { n: 64, title: 'Parachute Jumping Instructor',                           leadId: '69ce4f7de669298365614bd6', briefId: '69ce4f7de669298365614f2a', dir: 'L' },
  { n: 65, title: 'RAF Benevolent Fund',                                    leadId: '69ce4f7de669298365614bf2', briefId: '69ce4f7de669298365614f46', dir: 'B' },
  { n: 66, title: 'Cyberspace Operations Officer',                          leadId: '69ce4f7de669298365614c90', briefId: '69ce4f7de669298365614fe4', dir: 'L' },
  { n: 67, title: 'RAF Ensign',                                             leadId: '69ce4f7de669298365614c98', briefId: '69ce4f7de669298365614fec', dir: 'B' },
  { n: 68, title: 'NATO SACEUR and SHAPE',                                  leadId: '69ce4f7de669298365614b8d', briefId: '69ce4f7de669298365614ee1', dir: 'L' },
  { n: 69, title: 'UK Air Surveillance and Control System',                 leadId: '69ce4f7de669298365614b55', briefId: '69ce4f7de669298365614ea9', dir: 'L' },
  { n: 70, title: 'Combat Camera Operator',                                 leadId: '69ce4f7de669298365614c75', briefId: '69ce4f7de669298365614fc9', dir: 'L' },
  { n: 71, title: 'Ukraine AOR',                                            leadId: '69ce4f7de669298365614c86', briefId: '69ce4f7de669298365614fda', dir: 'L' },
  { n: 72, title: 'RPAS Operator',                                          leadId: '69ce4f7de669298365614bcf', briefId: '69ce4f7de669298365614f23', dir: 'L' },
  { n: 73, title: 'Air Recruit',                                            leadId: '69d153727d04876778c78007', briefId: '69d153727d04876778c78009', dir: 'L' },
  { n: 74, title: 'North Atlantic Treaty Organization',                     leadId: '69d153937d04876778c78090', briefId: '69d153937d04876778c78092', dir: 'B' },
  { n: 75, title: 'Airseeker',                                              leadId: '69d4ffe1419f689fa894c3b9', briefId: '69d4ffe1419f689fa894c3bb', dir: 'B' },
  { n: 76, title: 'NATO',                                                   leadId: '69da3a6d528c84d3e76a9b22', briefId: '69da3a6d528c84d3e76a9b24', dir: 'B' },
  { n: 77, title: 'Xi Jinping',                                             leadId: '69df5d4eb773a457d6773b83', briefId: '69df5d4eb773a457d6773b85', dir: 'L' },
];

function fmt(s, max = 80) {
  if (!s) return '""';
  const q = JSON.stringify(s);
  return q.length <= max ? q : q.slice(0, max - 1) + '…';
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected. Mode: ${DRY ? 'DRY-RUN' : 'APPLY'}\n`);

  let applied = 0;
  let skipped = 0;
  const plan = [];

  for (const d of DECISIONS) {
    const [lead, brief] = await Promise.all([
      IntelLead.findById(d.leadId).select('title subtitle').lean(),
      IntelligenceBrief.findById(d.briefId).select('title subtitle').lean(),
    ]);
    if (!lead || !brief) {
      console.log(`#${d.n} ${d.title} — SKIP (missing lead or brief)`);
      skipped++;
      continue;
    }

    let winnerValue;
    let willUpdateLead = false;
    let willUpdateBrief = false;

    if (d.dir === 'L')      { winnerValue = lead.subtitle;  willUpdateBrief = brief.subtitle !== winnerValue; }
    else if (d.dir === 'B') { winnerValue = brief.subtitle; willUpdateLead  = lead.subtitle  !== winnerValue; }
    else if (d.dir === 'M') { winnerValue = d.value;        willUpdateLead = lead.subtitle !== winnerValue; willUpdateBrief = brief.subtitle !== winnerValue; }
    else { console.log(`#${d.n} ${d.title} — SKIP (unknown dir=${d.dir})`); skipped++; continue; }

    plan.push({ n: d.n, title: d.title, dir: d.dir, winnerValue, willUpdateLead, willUpdateBrief, lead, brief });

    if (!willUpdateLead && !willUpdateBrief) continue;

    if (!DRY) {
      if (willUpdateLead)  await IntelLead.updateOne({ _id: d.leadId }, { subtitle: winnerValue });
      if (willUpdateBrief) await IntelligenceBrief.updateOne({ _id: d.briefId }, { subtitle: winnerValue });
    }
    applied++;
  }

  console.log(`Decisions: ${DECISIONS.length}   Applied: ${applied}   Skipped/no-op: ${DECISIONS.length - applied}`);
  const dirCounts = DECISIONS.reduce((m, d) => (m[d.dir] = (m[d.dir] ?? 0) + 1, m), {});
  console.log(`By direction: L=${dirCounts.L ?? 0}  B=${dirCounts.B ?? 0}  M=${dirCounts.M ?? 0}`);

  if (DRY) {
    console.log('\n── Preview ──');
    for (const p of plan.slice(0, 10)) {
      console.log(`#${p.n} [${p.dir}] ${p.title}`);
      console.log(`    from lead:  ${fmt(p.lead.subtitle)}`);
      console.log(`    from brief: ${fmt(p.brief.subtitle)}`);
      console.log(`    → winner:   ${fmt(p.winnerValue)}`);
    }
    if (plan.length > 10) console.log(`… +${plan.length - 10} more`);
  }

  await mongoose.disconnect();
}

run().catch((err) => { console.error(err); process.exit(1); });
