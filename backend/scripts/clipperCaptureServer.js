#!/usr/bin/env node
//
// Backend for Clipper capture recordings.
//
// The capture bot signs in and plays games, which writes sessions, Airstars and
// leaderboard rows. The ordinary local backend points at the DEPLOYED database
// (see project_local_uses_prod_mongo), so recording against it would put
// fabricated scores on the live leaderboard. This starts the same server
// against the throwaway local database instead, on its own port, so both can
// run at once.
//
// Usage (from backend/):   npm run dev:clipper
//
// Pair it with the capture site: `npm run dev:clipper` in the repo root serves
// the frontend on :5174 pointed here, which is what CLIPPER_CAPTURE_BASE_URL in
// clipper-agent/.env expects.

const path = require('path');

// Loaded before anything reads these. dotenv does not overwrite variables that
// are already set, so assigning here wins over backend/.env — which is the
// whole point: .env holds the deployed connection string.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const URI = process.env.CLIPPER_CAPTURE_MONGO_URI
  || 'mongodb://127.0.0.1:27017/skywatch_clipper';

// The refusal is the point of the file. A remote URI here would mean the bot
// plays games against real data while every safety check upstream still reports
// "local capture, all good".
const host = (() => {
  try { return new URL(URI.replace(/^mongodb(\+srv)?:/, 'http:')).hostname; }
  catch { return ''; }
})();
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error(
    `Refusing to start: CLIPPER_CAPTURE_MONGO_URI points at "${host}", not this machine.\n` +
    'The capture bot writes real game results, so this server must use a throwaway local database.',
  );
  process.exit(1);
}

process.env.MONGODB_URI = URI;
process.env.PORT = process.env.CLIPPER_CAPTURE_API_PORT || '5050';

console.log(`[clipper-capture] API on :${process.env.PORT}, database ${URI}`);
require('../server.js');
