#!/usr/bin/env node
//
// SkyWatch Clipper agent.
//
// Runs on the workstation and does the media work the hosted backend cannot:
// downloading stock clips, recording the site in a real browser, driving
// Voicebox, aligning captions and rendering the final MP4. Railway has no GPU,
// no browser and no scratch disk, so none of that can live server-side.
//
// The design is deliberately dumb: poll for a job, run it, report back. No
// inbound ports, no webhooks, nothing to expose. That means the workstation can
// sleep, move networks or sit behind a router with no configuration, and the
// queue simply waits in Mongo until it comes back.

require('dotenv').config();

const pkg = require('./package.json');
const { heartbeat, claimJob, reportProgress, reportResult, BASE, AGENT } = require('./api');
const { getHandler, handlers } = require('./handlers');
const voicebox = require('./voicebox');

const POLL_MS = Math.max(1, Number(process.env.CLIPPER_POLL_SECONDS) || 5) * 1000;
const HEARTBEAT_MS = 10 * 1000;
const RUN_ONCE = process.argv.includes('--once');

let stopping = false;

const log = (...args) => console.log(`[clipper-agent ${new Date().toISOString()}]`, ...args);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function runJob(job) {
  log(`job ${job._id} (${job.type}) claimed`);
  const progress = (pct, label) =>
    reportProgress(job._id, pct, label).catch(() => { /* progress is best-effort */ });

  try {
    const handler = getHandler(job.type);
    const result = await handler({ job, progress });
    await reportResult(job._id, true, result ?? {});
    log(`job ${job._id} done`);
  } catch (err) {
    // Report the failure rather than swallowing it: the server decides whether
    // to retry, and an unreported job would sit 'claimed' forever.
    log(`job ${job._id} FAILED: ${err.message}`);
    await reportResult(job._id, false, err.message).catch(e =>
      log(`could not report failure for ${job._id}: ${e.message}`));
  }
}

// Voice profiles change rarely (you add one in the Voicebox app now and then),
// and asking Voicebox for them means starting it, so this is cached and only
// refreshed when the server happens to already be up.
let cachedVoices = [];

async function refreshVoices() {
  try {
    if (!(await voicebox.isUp())) return;
    const profiles = await voicebox.listProfiles();
    cachedVoices = (Array.isArray(profiles) ? profiles : [])
      .map(p => ({ id: p.id, name: p.name }))
      .filter(v => v.id);
  } catch { /* not fatal — the picker just shows what it had */ }
}

async function beat() {
  try {
    await heartbeat(pkg.version, cachedVoices);
  } catch (err) {
    // A missed heartbeat only means the pill in the UI goes grey. Log it once
    // per failure and carry on — the poll loop reports connectivity anyway.
    log(`heartbeat failed: ${err.message}`);
  }
}

async function main() {
  log(`starting v${pkg.version}`);
  log(`  api      ${BASE}`);
  log(`  agent id ${AGENT}`);
  const known = Object.keys(handlers);
  log(`  handlers ${known.length ? known.join(', ') : '(none registered yet)'}`);

  await refreshVoices();
  await beat();
  const heartbeatTimer = setInterval(beat, HEARTBEAT_MS);
  const voicesTimer = setInterval(refreshVoices, 60 * 1000);

  let warnedOffline = false;

  while (!stopping) {
    try {
      const data = await claimJob();
      warnedOffline = false;

      if (data?.job) {
        await runJob(data.job);
        continue;               // drain the queue before sleeping again
      }
    } catch (err) {
      // Don't spam the console when the backend is simply not running — say it
      // once, then stay quiet until it comes back.
      if (!warnedOffline) {
        log(`cannot reach backend (${err.message}) — will keep retrying`);
        warnedOffline = true;
      }
    }

    if (RUN_ONCE) break;
    await sleep(POLL_MS);
  }

  clearInterval(heartbeatTimer);
  clearInterval(voicesTimer);
  // Only kills a voicebox-server we spawned ourselves — see voicebox.js.
  voicebox.shutdown();
  log('stopped');
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (stopping) process.exit(1);   // second Ctrl-C forces it
    log(`${sig} received, finishing current work…`);
    stopping = true;
  });
}

main().catch(err => {
  console.error('[clipper-agent] fatal:', err.message);
  process.exit(1);
});
