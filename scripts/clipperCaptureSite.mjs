#!/usr/bin/env node
//
// Frontend for Clipper capture recordings — the site the bot records.
//
// Serves on :5174 pointed at the capture backend (:5050, throwaway database)
// rather than the usual one on :5000, which talks to the DEPLOYED database.
// That separation is the whole reason this exists: a recording session plays
// games for real, and those results have to land somewhere disposable.
//
// Usage:  npm run dev:clipper       (start backend/ npm run dev:clipper first)
//
// Matches CLIPPER_CAPTURE_BASE_URL in clipper-agent/.env.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const PORT = process.env.CLIPPER_CAPTURE_PORT || '5174';
const API  = process.env.CLIPPER_CAPTURE_API_URL || 'http://localhost:5050';

// Vite exposes VITE_-prefixed variables from the environment as well as from
// .env files, and the environment wins — so this overrides the VITE_API_URL in
// the repo's .env without editing it. Editing it would silently repoint the
// normal dev server at the capture database, which is the mirror image of the
// mistake this file exists to prevent.
const env = { ...process.env, VITE_API_URL: API };

console.log(`[clipper-capture] site on :${PORT}, API ${API}`);

// Run Vite's JS entry with this same node, rather than shelling out to `npx`.
// On Windows npx is a .cmd, and spawning a .cmd without a shell fails EINVAL on
// current Node — while spawning *with* a shell would mean quoting a path that
// contains a space ("Cursor Projects"). Neither is worth it when the module
// resolves directly.
const require = createRequire(import.meta.url);
const viteBin = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');

const child = spawn(
  process.execPath,
  [viteBin, '--port', PORT, '--strictPort'],
  { env, stdio: 'inherit' },
);

child.on('exit', code => process.exit(code ?? 0));
