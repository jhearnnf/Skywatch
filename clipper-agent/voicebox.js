// Voicebox control — the local TTS provider.
//
// Voicebox (github.com/jamiepine/voicebox) is a Tauri app, but the GUI is only
// a shell around a Python/FastAPI sidecar. We spawn that sidecar directly, so
// the app never has to be open for a render to run.
//
// Two behaviours matter:
//   * If the desktop app is already running, reuse ITS server rather than
//     starting a second one. Both would open the same SQLite database and
//     fight over it.
//   * When we do spawn, pass --parent-pid so the server dies with the agent.
//     Voicebox cleans up orphans on its next start, but leaving a 377MB python
//     process behind after every run is not acceptable housekeeping.
//
// See memory `project_voicebox_local_tts` for the full API map.

const { spawn } = require('child_process');
const path = require('path');

const EXE      = process.env.VOICEBOX_EXE || '';
const DATA_DIR = process.env.VOICEBOX_DATA_DIR || '';
const PORT     = Number(process.env.VOICEBOX_PORT) || 34254;
const BASE     = `http://127.0.0.1:${PORT}`;

let spawned = null;   // the child process, if we started one

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function isUp() {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureRunning({ log = () => {} } = {}) {
  if (await isUp()) {
    log(`voicebox already serving on ${PORT} (reusing it)`);
    return { reused: true };
  }

  if (!EXE) throw new Error('VOICEBOX_EXE is not set and no server is running on ' + PORT);

  const args = ['--host', '127.0.0.1', '--port', String(PORT), '--parent-pid', String(process.pid)];
  if (DATA_DIR) args.push('--data-dir', DATA_DIR);

  log(`spawning voicebox-server on ${PORT}…`);
  spawned = spawn(EXE, args, { stdio: 'ignore', windowsHide: true });
  spawned.on('exit', () => { spawned = null; });

  // Cold start loads torch and the model; on a first run that is not quick.
  for (let i = 0; i < 90; i++) {
    if (await isUp()) { log('voicebox ready'); return { reused: false }; }
    if (!spawned) throw new Error('voicebox-server exited during startup');
    await sleep(2000);
  }
  throw new Error('voicebox-server did not become ready within 180s');
}

function shutdown() {
  // Only ever kill the process we started. If we reused the desktop app's
  // server, killing it would take the user's open application down with it.
  if (spawned && !spawned.killed) {
    try { spawned.kill(); } catch { /* already gone */ }
    spawned = null;
  }
}

async function api(pathname, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`voicebox ${method} ${pathname} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

const listProfiles = () => api('/profiles');

// Synthesise one line and wait for it.
//
// `seed` is passed through deliberately: it makes a re-render reproduce
// byte-identical narration, so regenerating a video months later does not
// silently change the voice take.
async function synthesise({ text, profileId, instruct, seed, language = 'en' }) {
  const started = await api('/generate', {
    method: 'POST',
    body: {
      text,
      profile_id: profileId,
      language,
      ...(instruct ? { instruct } : {}),
      ...(Number.isInteger(seed) ? { seed } : {}),
    },
  });

  const id = started?.id;
  if (!id) throw new Error('voicebox /generate returned no generation id');

  // Poll rather than assume: /generate returns as soon as the job is accepted.
  for (let i = 0; i < 300; i++) {
    const status = await api(`/generate/${id}/status`);
    if (status.status === 'completed') {
      return {
        generationId: id,
        durationMs: Math.round((Number(status.duration) || 0) * 1000),
        audioUrl: `${BASE}/audio/${id}`,
      };
    }
    if (status.status === 'failed') {
      throw new Error(`voicebox generation failed: ${status.error || 'unknown'}`);
    }
    await sleep(1000);
  }
  throw new Error('voicebox generation timed out');
}

async function downloadAudio(generationId, destPath) {
  const fs = require('fs/promises');
  const res = await fetch(`${BASE}/audio/${generationId}`);
  if (!res.ok) throw new Error(`could not download audio ${generationId}: ${res.status}`);
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, Buffer.from(await res.arrayBuffer()));
  return destPath;
}

module.exports = { ensureRunning, shutdown, isUp, listProfiles, synthesise, downloadAudio, BASE, PORT };
