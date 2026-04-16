/**
 * seedActors.js
 *
 * Additive, idempotent script: inserts 35 "Actors" leads (heads of state,
 * defence leadership, adversary commanders, non-state leaders, allied/coalition
 * figures, historic RAF personnel) as IntelLead + stub IntelligenceBrief pairs.
 *
 * Safe to re-run — existing titles are skipped. Pattern mirrors
 * addGazaHamasLeads.js.
 *
 * Usage:
 *   node backend/scripts/seedActors.js           # dry-run (preview only)
 *   node backend/scripts/seedActors.js --apply   # write to DB
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const IntelLead = require('../models/IntelLead');
const IntelligenceBrief = require('../models/IntelligenceBrief');

const APPLY = process.argv.includes('--apply');

const ENTRIES = [

  // ── Heads of State & Government (priority 1–8) ─────────────────────────────
  { title: 'Vladimir Putin',       subtitle: 'President of the Russian Federation — commander-in-chief of the armed forces whose decisions shape NATO air and missile threat posture', category: 'Actors', subcategory: 'Heads of State & Government', priorityNumber: 1,  isHistoric: false },
  { title: 'Xi Jinping',           subtitle: 'President of the People\'s Republic of China and Chairman of the Central Military Commission — drives PLA modernisation and Indo-Pacific posture', category: 'Actors', subcategory: 'Heads of State & Government', priorityNumber: 2,  isHistoric: false },
  { title: 'Ali Khamenei',         subtitle: 'Supreme Leader of Iran — constitutional commander-in-chief of the regular armed forces and IRGC', category: 'Actors', subcategory: 'Heads of State & Government', priorityNumber: 3,  isHistoric: false },
  { title: 'Masoud Pezeshkian',    subtitle: 'President of Iran — civilian head of government with defined authority over the regular armed forces', category: 'Actors', subcategory: 'Heads of State & Government', priorityNumber: 4,  isHistoric: false },
  { title: 'Benjamin Netanyahu',   subtitle: 'Prime Minister of Israel — leads the Israeli security cabinet directing IDF operations across the Levant', category: 'Actors', subcategory: 'Heads of State & Government', priorityNumber: 5,  isHistoric: false },
  { title: 'Volodymyr Zelensky',   subtitle: 'President of Ukraine — commander-in-chief of the Armed Forces of Ukraine and principal interlocutor for NATO support', category: 'Actors', subcategory: 'Heads of State & Government', priorityNumber: 6,  isHistoric: false },
  { title: 'Kim Jong Un',          subtitle: 'Supreme Leader of North Korea — directs the Korean People\'s Army and the DPRK strategic weapons programme', category: 'Actors', subcategory: 'Heads of State & Government', priorityNumber: 7,  isHistoric: false },
  { title: 'Recep Tayyip Erdoğan', subtitle: 'President of Türkiye — commands the Turkish Armed Forces, a NATO ally with air and ground forces influencing Black Sea, Levant and Aegean AORs', category: 'Actors', subcategory: 'Heads of State & Government', priorityNumber: 8,  isHistoric: false },

  // ── Defence & Military Leadership (UK, priority 9–14) ──────────────────────
  { title: 'UK Secretary of State for Defence', subtitle: 'Cabinet minister responsible for the Ministry of Defence and political direction of the Armed Forces', category: 'Actors', subcategory: 'Defence & Military Leadership', priorityNumber: 9,  isHistoric: false },
  { title: 'Chief of the Defence Staff',        subtitle: 'Professional head of the UK Armed Forces and principal military adviser to the Prime Minister and Defence Secretary', category: 'Actors', subcategory: 'Defence & Military Leadership', priorityNumber: 10, isHistoric: false },
  { title: 'Chief of the Air Staff',            subtitle: 'Professional head of the Royal Air Force, responsible for generating and sustaining UK air and space power', category: 'Actors', subcategory: 'Defence & Military Leadership', priorityNumber: 11, isHistoric: false },
  { title: 'Chief of the General Staff',        subtitle: 'Professional head of the British Army, responsible for land forces generation and readiness', category: 'Actors', subcategory: 'Defence & Military Leadership', priorityNumber: 12, isHistoric: false },
  { title: 'First Sea Lord',                    subtitle: 'Professional head of the Royal Navy and Chief of Naval Staff, responsible for maritime force generation', category: 'Actors', subcategory: 'Defence & Military Leadership', priorityNumber: 13, isHistoric: false },
  { title: 'Vice Chief of the Defence Staff',   subtitle: 'Deputy to the CDS with specific responsibility for capability, readiness and operational plans', category: 'Actors', subcategory: 'Defence & Military Leadership', priorityNumber: 14, isHistoric: false },

  // ── Adversary Commanders (priority 15–19) ──────────────────────────────────
  { title: 'Valery Gerasimov',           subtitle: 'Chief of the General Staff of the Russian Armed Forces — senior uniformed commander overseeing Russian operations in Ukraine', category: 'Actors', subcategory: 'Adversary Commanders', priorityNumber: 15, isHistoric: false },
  { title: 'Andrei Belousov',            subtitle: 'Russian Minister of Defence — civilian head of the Russian MoD overseeing force structure and defence industry', category: 'Actors', subcategory: 'Adversary Commanders', priorityNumber: 16, isHistoric: false },
  { title: 'IRGC Commander-in-Chief',    subtitle: 'Head of the Islamic Revolutionary Guard Corps — directs Iran\'s parallel military force including aerospace, navy and ground branches', category: 'Actors', subcategory: 'Adversary Commanders', priorityNumber: 17, isHistoric: false },
  { title: 'Quds Force Commander',       subtitle: 'Head of the IRGC Quds Force — responsible for Iranian extraterritorial and proxy operations across the Middle East', category: 'Actors', subcategory: 'Adversary Commanders', priorityNumber: 18, isHistoric: false },
  { title: 'PLA Air Force Commander',    subtitle: 'Commander of the People\'s Liberation Army Air Force — operator of the largest air force in Asia and a primary factor in Indo-Pacific air threat', category: 'Actors', subcategory: 'Adversary Commanders', priorityNumber: 19, isHistoric: false },

  // ── Non-State & Proxy Leaders (priority 20–24) ─────────────────────────────
  { title: 'Hezbollah Secretary-General', subtitle: 'Head of Hezbollah, a Lebanon-based non-state armed group with rocket, drone and missile capability influencing the Levant AOR', category: 'Actors', subcategory: 'Non-State & Proxy Leaders', priorityNumber: 20, isHistoric: false },
  { title: 'Abdul Malik al-Houthi',       subtitle: 'Leader of the Houthi movement in Yemen — directs attacks on Red Sea shipping and regional targets using drones and ballistic missiles', category: 'Actors', subcategory: 'Non-State & Proxy Leaders', priorityNumber: 21, isHistoric: false },
  { title: 'Hamas Political Leadership',  subtitle: 'Political bureau of Hamas — directs the Gaza-based armed group whose operations shape the Levant threat picture', category: 'Actors', subcategory: 'Non-State & Proxy Leaders', priorityNumber: 22, isHistoric: false },
  { title: 'Ahmad al-Sharaa',             subtitle: 'Leader of the Syrian transitional authority following the fall of the Assad government — reshaping the Syrian security landscape', category: 'Actors', subcategory: 'Non-State & Proxy Leaders', priorityNumber: 23, isHistoric: false },
  { title: 'ISIS-K Emir',                 subtitle: 'Leader of the Islamic State Khorasan Province — the Afghanistan-Pakistan regional branch of ISIS, an active CENTCOM-area threat', category: 'Actors', subcategory: 'Non-State & Proxy Leaders', priorityNumber: 24, isHistoric: false },

  // ── Allied & Coalition Leaders (priority 25–29) ────────────────────────────
  { title: 'Mark Rutte',                           subtitle: 'Secretary General of NATO — senior civilian official chairing the North Atlantic Council and representing the Alliance', category: 'Actors', subcategory: 'Allied & Coalition Leaders', priorityNumber: 25, isHistoric: false },
  { title: 'Supreme Allied Commander Europe',      subtitle: 'SACEUR — senior NATO military commander for Europe, dual-hatted as US EUCOM commander', category: 'Actors', subcategory: 'Allied & Coalition Leaders', priorityNumber: 26, isHistoric: false },
  { title: 'Chair of the NATO Military Committee', subtitle: 'Senior military officer of NATO — principal military adviser to the Secretary General and North Atlantic Council', category: 'Actors', subcategory: 'Allied & Coalition Leaders', priorityNumber: 27, isHistoric: false },
  { title: 'US Chairman of the Joint Chiefs of Staff', subtitle: 'Senior uniformed officer of the United States Armed Forces — principal military adviser to the US President', category: 'Actors', subcategory: 'Allied & Coalition Leaders', priorityNumber: 28, isHistoric: false },
  { title: 'Chief of the French Defence Staff',    subtitle: 'CEMA — professional head of the French Armed Forces, a key bilateral partner to the UK under the Lancaster House treaties', category: 'Actors', subcategory: 'Allied & Coalition Leaders', priorityNumber: 29, isHistoric: false },

  // ── Historic RAF Personnel (priority 30–35, isHistoric=true) ───────────────
  { title: 'Hugh Trenchard',    subtitle: 'First Chief of the Air Staff — secured the RAF\'s survival as an independent service after 1918 and shaped its founding doctrine', category: 'Actors', subcategory: 'Historic RAF Personnel', priorityNumber: 30, isHistoric: true },
  { title: 'Hugh Dowding',      subtitle: 'AOC-in-C Fighter Command during the Battle of Britain — architect of the integrated air defence system that defended UK airspace in 1940', category: 'Actors', subcategory: 'Historic RAF Personnel', priorityNumber: 31, isHistoric: true },
  { title: 'Keith Park',        subtitle: 'AOC 11 Group during the Battle of Britain — commanded the fighter group that bore the brunt of the Luftwaffe\'s daylight assault on southern England', category: 'Actors', subcategory: 'Historic RAF Personnel', priorityNumber: 32, isHistoric: true },
  { title: 'Douglas Bader',     subtitle: 'RAF fighter ace who flew operationally despite having lost both legs — credited with 22 aerial victories and a prominent post-war advocate for the disabled', category: 'Actors', subcategory: 'Historic RAF Personnel', priorityNumber: 33, isHistoric: true },
  { title: 'Guy Gibson',        subtitle: 'Commanding officer of 617 Squadron on Operation Chastise (the Dambusters raid, 1943) — awarded the Victoria Cross for leading the attack', category: 'Actors', subcategory: 'Historic RAF Personnel', priorityNumber: 34, isHistoric: true },
  { title: 'Leonard Cheshire',  subtitle: 'Bomber Command pilot and 617 Squadron commander — awarded the Victoria Cross in 1944 and later founded the Cheshire Homes charity', category: 'Actors', subcategory: 'Historic RAF Personnel', priorityNumber: 35, isHistoric: true },
];

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI missing from backend/.env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`Connected to MongoDB${APPLY ? '' : ' (DRY RUN — pass --apply to write)'}`);

  let created = 0;
  let skipped = 0;

  for (const entry of ENTRIES) {
    const existingLead  = await IntelLead.findOne({ title: entry.title }, '_id title').lean();
    const existingBrief = await IntelligenceBrief.findOne({ title: entry.title }, '_id title status').lean();

    if (existingLead && existingBrief) {
      console.log(`  SKIP   "${entry.title}" — lead + brief already present`);
      skipped++;
      continue;
    }

    if (!APPLY) {
      console.log(`  WOULD CREATE  "${entry.title}" [${entry.category} / ${entry.subcategory}] priority=${entry.priorityNumber} historic=${entry.isHistoric}`);
      if (existingLead)  console.log(`                (lead exists, would create missing stub brief)`);
      if (existingBrief) console.log(`                (brief exists, would create missing lead)`);
      continue;
    }

    if (!existingLead) {
      await IntelLead.create({
        title:          entry.title,
        nickname:       '',
        subtitle:       entry.subtitle,
        category:       entry.category,
        subcategory:    entry.subcategory,
        section:        'ACTORS',
        subsection:     entry.subcategory,
        isPublished:    false,
        isHistoric:     entry.isHistoric,
        priorityNumber: entry.priorityNumber,
      });
      console.log(`  CREATE lead   "${entry.title}"`);
    }

    if (!existingBrief) {
      await IntelligenceBrief.create({
        title:               entry.title,
        subtitle:            entry.subtitle,
        category:            entry.category,
        subcategory:         entry.subcategory,
        status:              'stub',
        historic:            entry.isHistoric,
        priorityNumber:      entry.priorityNumber,
        descriptionSections: [],
        keywords:            [],
        sources:             [],
      });
      console.log(`  CREATE stub   "${entry.title}"`);
      created++;
    }
  }

  await mongoose.disconnect();
  console.log(`\nDone. ${APPLY ? `Created ${created}, skipped ${skipped}.` : 'Dry run — pass --apply to write.'}`);
}

run().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
