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
// webhooks and nothing exposed beyond loopback. That means the workstation can
// sleep, move networks or sit behind a router with no configuration, and the
// queue simply waits in Mongo until it comes back.
//
// The one listening socket is the media server (mediaServer.js), bound to
// 127.0.0.1 so the preview player can play back screen recordings that only
// exist on this disk.

require('dotenv').config();

const pkg = require('./package.json');
const { heartbeat, claimJob, reportProgress, reportResult, BASE, AGENT } = require('./api');
const { getHandler, handlers } = require('./handlers');
const mediaServer = require('./mediaServer');
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

    // A voices job is the one thing that STARTS Voicebox, so it is also the
    // moment this process first learns what profiles exist. Without adopting
    // the answer, our own cache stays empty until the 60-second refresh
    // happens to find Voicebox up — and every heartbeat in between reports
    // "no profiles" for a machine that plainly has some.
    if (job.type === 'voices' && Array.isArray(result?.voices) && result.voices.length) {
      cachedVoices = result.voices;
      log(`cached ${cachedVoices.length} voice profiles`);
    }

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

// Advertised on every heartbeat rather than stored anywhere: the port is
// ephemeral, so a value that outlived the process would point at nothing.
let mediaBaseUrl = null;

async function beat() {
  try {
    const reply = await heartbeat(pkg.version, cachedVoices, mediaBaseUrl);

    // A stop asked for from the UI. Handled exactly like Ctrl-C: the flag ends
    // the poll loop after the current job, so a render that is minutes in still
    // gets to write its file. The panel offers a force-stop for an agent that
    // is wedged and never reads this.
    if (reply?.stop && !stopping) {
      log('stop requested from the admin panel - finishing current work…');
      stopping = true;
    }
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

  // Not fatal if it cannot bind. Everything the agent actually produces still
  // works without it; the only casualty is previewing screen recordings, and
  // losing the whole agent over that would be a poor trade.
  let media = null;
  try {
    media = await mediaServer.start();
    mediaBaseUrl = media.baseUrl;
    log(`  media    ${media.baseUrl} (serving ${mediaServer.ROOT})`);
  } catch (err) {
    log(`media server did not start (${err.message}) — screen recordings will not preview`);
  }

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
  await media?.close().catch(() => {});
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
