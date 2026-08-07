#!/usr/bin/env node
//
// Seed a throwaway database for Clipper capture recordings.
//
// The capture bot logs in and plays games, which writes real game sessions,
// Airstars and leaderboard rows. Your local backend normally points at the
// DEPLOYED database (project_local_uses_prod_mongo), so running the bot against
// it would put fabricated scores on the live leaderboard — publicly visible and
// awkward to unpick.
//
// This script therefore refuses to run against anything that is not obviously a
// local, disposable database. That refusal is the whole point of the file; do
// not add a --force flag to it.
//
// Usage:
//   MONGODB_URI=mongodb://127.0.0.1:27017/skywatch_clipper node scripts/seedClipperDemoData.js

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const URI = process.env.CLIPPER_CAPTURE_MONGO_URI
  || process.env.MONGODB_URI
  || 'mongodb://127.0.0.1:27017/skywatch_clipper';

// Callsign-style names for the on-camera account and the fake leaderboard.
// Fictional throughout: a recording that scrolled the real leaderboard would
// put actual users' agent numbers on screen, which the privacy rules forbid.
const DEMO_AGENTS = [
  'Maverick', 'Bandit', 'Reaper', 'Falcon', 'Vandal', 'Nomad', 'Ghost',
  'Talon', 'Vector', 'Sabre', 'Rogue', 'Crosswind', 'Lancer', 'Hawkeye',
  'Ironside', 'Stormrider', 'Redline', 'Cobalt', 'Nightjar', 'Pathfinder',
];

function assertDisposable(uri) {
  let host, dbName;
  try {
    const u = new URL(uri.replace(/^mongodb(\+srv)?:\/\//, 'http://'));
    host = u.hostname;
    dbName = u.pathname.replace(/^\//, '');
  } catch {
    throw new Error(`Could not parse MONGODB_URI: ${uri}`);
  }

  const localHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!localHost) {
    throw new Error(
      `Refusing to seed "${host}". Capture data must go to a local database — ` +
      'seeding a hosted one would put fabricated scores on the real leaderboard.',
    );
  }

  // Belt and braces: even locally, only ever touch a database whose name says
  // it is for this. It is entirely possible to run a local mongod that holds
  // a restored copy of production.
  if (!/clipper|demo|test/i.test(dbName)) {
    throw new Error(
      `Refusing to seed database "${dbName}". Name it something containing ` +
      '"clipper", "demo" or "test" so it is unmistakably disposable.',
    );
  }

  return { host, dbName };
}

async function main() {
  const { host, dbName } = assertDisposable(URI);
  console.log(`Seeding ${dbName} on ${host}…`);

  await mongoose.connect(URI);

  const User = require('../models/User');
  const password = await bcrypt.hash('clipper-demo-password', 10);

  // The account the bot signs in as.
  //
  // Admin, deliberately. The games' debug shortcuts are gated on isAdmin, and
  // recipes need them: DPT's round-skip (555 → round 5) is what puts a busy
  // board on camera instead of round one's two aircraft. Using them flags the
  // run as debug so it never reaches a leaderboard — which is what a recording
  // should do regardless.
  //
  // Safe only because this database is disposable and local: the same flag on
  // the real database would hand the capture account the admin site. Nothing
  // outside this file should grant it.
  const primary = DEMO_AGENTS[0];
  await User.findOneAndUpdate(
    { email: 'clipper-demo@skywatch.local' },
    {
      $set: {
        username: primary,
        email: 'clipper-demo@skywatch.local',
        password,
        isAdmin: true,
        totalAirstars: 4820,
        cycleAirstars: 1180,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  // Fictional company for the leaderboard, so recordings look inhabited without
  // any real person appearing on camera.
  let created = 0;
  for (let i = 1; i < DEMO_AGENTS.length; i++) {
    const name = DEMO_AGENTS[i];
    // Descending airstars so the board has a believable shape.
    const airstars = Math.round(5200 - i * 190 + (i % 3) * 45);
    const res = await User.findOneAndUpdate(
      { email: `clipper-demo-${i}@skywatch.local` },
      {
        $set: {
          username: name,
          email: `clipper-demo-${i}@skywatch.local`,
          password,
          isAdmin: false,
          totalAirstars: airstars,
          cycleAirstars: Math.round(airstars / 4),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true, rawResult: true },
    );
    if (res?.lastErrorObject?.upserted) created++;
  }

  // ── Aircraft briefs ──────────────────────────────────────────────────────
  // The DPT game's aircraft roster comes from published "Aircrafts" briefs that
  // have a Media cutout (GET /api/briefs/aircraft-cutouts), and the 3D model is
  // resolved by slugging the brief TITLE against the filenames in public/models.
  // So the titles below are not decorative — each one must slug to a real .glb
  // or the game shows "No 3D aircraft available" and cannot start.
  const IntelligenceBrief = require('../models/IntelligenceBrief');
  const Media = require('../models/Media');

  const AIRCRAFT = [
    'Eurofighter Typhoon FGR4',
    'F-35B Lightning II',
    'Hawk T2',
    'Chinook HC6 6A',
    'A400M Atlas C1',
    'C-17A Globemaster III',
    'E-7A Wedgetail',
    'P-8A Poseidon MRA1',
  ];

  // Any resolvable image works — the cutout is only the selection thumbnail,
  // while the .glb is what actually flies. Using a local asset keeps the seed
  // offline and avoids depending on Cloudinary.
  const PLACEHOLDER = '/icon-512.png';

  let briefsMade = 0;
  for (const title of AIRCRAFT) {
    const media = await Media.findOneAndUpdate(
      { mediaUrl: PLACEHOLDER, name: title },
      {
        $set: {
          mediaType: 'picture',
          mediaUrl: PLACEHOLDER,
          cutoutUrl: PLACEHOLDER,
          name: title,
          searchTerm: title,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    const res = await IntelligenceBrief.findOneAndUpdate(
      { title },
      {
        $set: {
          title,
          category: 'Aircrafts',
          status: 'published',
          media: [media._id],
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true, rawResult: true },
    );
    if (res?.lastErrorObject?.upserted) briefsMade++;
  }

  console.log(`  primary demo agent : ${primary} (clipper-demo@skywatch.local)`);
  console.log(`  leaderboard agents : ${DEMO_AGENTS.length - 1} (${created} newly created)`);
  console.log(`  aircraft briefs    : ${AIRCRAFT.length} (${briefsMade} newly created)`);
  console.log('\nDone. Point CLIPPER_CAPTURE_MONGO_URI at this database and run the site against it.');

  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch(err => { console.error('\nSeed failed:', err.message); process.exit(1); });
}

module.exports = { assertDisposable, DEMO_AGENTS };
