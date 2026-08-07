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

  // Check the type rather than letting JSON.parse editorialise. Voicebox turned
  // /generate/{id}/status into an event stream, and res.json() reported that as
  // `Unexpected token 'd', "data:{"id"...` — a parser complaint that says
  // nothing about which endpoint changed or how.
  const type = res.headers.get('content-type') || '';
  if (!type.includes('json')) {
    const preview = (await res.text()).slice(0, 120).replace(/\s+/g, ' ');
    throw new Error(
      `voicebox ${method} ${pathname} answered ${type || 'an unknown type'}, not JSON: "${preview}"`,
    );
  }
  return res.json();
}

// ── Generation status ───────────────────────────────────────────────────────
// Voicebox reports progress on GET /generate/{id}/status as Server-Sent
// Events. Each frame is one or more `data: <json>` lines, frames separated by a
// blank line.

const isTerminal = (s) => s === 'completed' || s === 'failed';

// Pull whole frames out of a stream buffer, leaving any partial one behind.
// Exported for tests: chunk boundaries fall wherever the network puts them, and
// a parser that only works when a frame arrives intact is a parser that works
// until it doesn't.
function parseSseFrames(buffer) {
  const events = [];
  // Normalise CRLF so one delimiter check covers both line endings.
  let rest = buffer.replace(/\r\n/g, '\n');

  let idx;
  while ((idx = rest.indexOf('\n\n')) !== -1) {
    const frame = rest.slice(0, idx);
    rest = rest.slice(idx + 2);

    for (const line of frame.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        events.push(JSON.parse(payload));
      } catch {
        // A frame we cannot read is not a reason to abandon the generation;
        // the next one carries the same status.
      }
    }
  }

  return { events, rest };
}

// Read the status stream until it reports a terminal state. Returns null if the
// stream ends first — the caller then checks whether the job finished while we
// were disconnected, rather than treating a dropped connection as a failure.
async function readStatusStream(generationId, timeoutMs) {
  const res = await fetch(`${BASE}/generate/${generationId}/status`, {
    headers: { Accept: 'text/event-stream' },
    signal: AbortSignal.timeout(Math.max(1000, timeoutMs)),
  });
  if (!res.ok) {
    throw new Error(`voicebox status ${generationId} -> ${res.status}`);
  }

  // Older builds answered this as plain JSON. Handle both rather than assuming
  // whichever one happens to be installed.
  if (!(res.headers.get('content-type') || '').includes('event-stream')) {
    const snapshot = await res.json();
    return isTerminal(snapshot?.status) ? snapshot : null;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return null;

      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = parseSseFrames(buffer);
      buffer = rest;

      for (const event of events) {
        if (isTerminal(event?.status)) return event;
      }
    }
  } finally {
    reader.cancel().catch(() => { /* already closed */ });
  }
}

// Wait for a generation to finish, however the server chooses to tell us.
//
// The stream is the fast path — it reports completion the moment it happens,
// where the old one-second poll added up to a second per line across a whole
// script. /history/{id} is the backstop: it is plain JSON and answers the same
// question, so a stream that ends early costs a round trip rather than a take.
async function awaitGeneration(generationId, { timeoutMs = 300000 } = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const streamed = await readStatusStream(generationId, deadline - Date.now());
    if (streamed) return streamed;

    const snapshot = await api(`/history/${generationId}`);
    if (isTerminal(snapshot?.status)) return snapshot;

    await sleep(500);
  }

  throw new Error(`voicebox generation ${generationId} timed out`);
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

  // Wait rather than assume: /generate returns as soon as the job is accepted,
  // with duration 0 and an empty audio path.
  const final = await awaitGeneration(id);
  if (final.status === 'failed') {
    throw new Error(`voicebox generation failed: ${final.error || 'unknown'}`);
  }

  return {
    generationId: id,
    durationMs: Math.round((Number(final.duration) || 0) * 1000),
    audioUrl: `${BASE}/audio/${id}`,
  };
}

async function downloadAudio(generationId, destPath) {
  const fs = require('fs/promises');
  const res = await fetch(`${BASE}/audio/${generationId}`);
  if (!res.ok) throw new Error(`could not download audio ${generationId}: ${res.status}`);
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, Buffer.from(await res.arrayBuffer()));
  return destPath;
}

module.exports = {
  ensureRunning, shutdown, isUp, listProfiles, synthesise, downloadAudio,
  parseSseFrames, awaitGeneration, BASE, PORT,
};
