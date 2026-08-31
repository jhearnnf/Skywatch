const router = require('express').Router();
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
// Kept as the module, not a destructured `spawn`. Destructuring binds the
// original function at load time, so tests cannot intercept it — which meant an
// earlier version of the start-agent test spawned real detached agents.
const childProcess = require('child_process');

// The agent lives beside backend/ in the repo. Absent on a hosted deployment,
// which is what stops /agent/start doing anything there.
const AGENT_DIR = path.join(__dirname, '..', '..', 'clipper-agent');

const { protect, adminOnly } = require('../middleware/auth');
const { clipperAgentAuth }   = require('../middleware/clipperAgentAuth');
const { featureMiddleware }  = require('../utils/openRouter');

const ClipperSource = require('../models/ClipperSource');
const ClipperFact   = require('../models/ClipperFact');
const ClipperScript = require('../models/ClipperScript');
const ClipperCapture = require('../models/ClipperCapture');
const ClipperVoice = require('../models/ClipperVoice');
const ClipperJob    = require('../models/ClipperJob');
const ClipperMusic  = require('../models/ClipperMusic');

const { parseGuideSource, DEFAULT_GUIDE_PATH } = require('../utils/clipperFactParser');
const { validateScript } = require('../utils/clipperGuardrails');
const { generateIdeas, generateScript } = require('../services/clipperAi');
const { normaliseSubject, SUBJECTS } = require('../constants/clipperSubjects');
const { searchFootage, configuredProviders, providerStatus } = require('../utils/clipperFootage');
const {
  planBeatCarry, pruneFootage, pruneVoice, pruneBeatRows, placeVoiceLines,
} = require('../utils/clipperBeatCarry');
const { buildTimeline } = require('../utils/clipperTimeline');
const { buildCaptions } = require('../utils/clipperCaptions');
const { SFX, SFX_BY_ID, SFX_DIR, resolveCue } = require('../constants/clipperSfx');
const { MUSIC_DIR, MUSIC_ABS_DIR, slugify, musicPath } = require('../constants/clipperMusic');
const { detectBpm } = require('../utils/clipperTempo');
const { searchMusic, isFreeLicence } = require('../utils/clipperMusicSearch');

const SOURCE_SLUG = 'cbat-guide';

function fail(res, err) {
  res.status(err.status || 500).json({ message: err.message });
}

// ── Local agent ─────────────────────────────────────────────────────────────
// Declared BEFORE the admin middleware below, so these routes get agent-token
// auth instead of a session cookie. The agent has no browser and no user.

// Last time an agent checked in. Deliberately in memory rather than Mongo: it
// is a liveness signal with a 30-second useful life, so persisting it would
// only let a stale value survive a restart and report an agent that is not
// there. A fresh process correctly starts out believing the agent is offline.
const agentPresence = {
  at: null, agentId: null, version: null, voices: [], mediaBaseUrl: null,
  // Reported by the agent so a force-stop can name the exact process. Killing
  // by name would take down every node process on the machine.
  pid: null,
  // Set by POST /agent/stop, handed to the agent on its next heartbeat.
  stopRequested: false,
};

// Adopt a reported set of voice profiles.
//
// `agentPresence.voices` stays as the hot cache - a heartbeat arrives every ten
// seconds and re-writing Mongo each time would be a write per heartbeat for a
// list that changes when the admin makes a new profile, which is to say almost
// never. So the database is touched only when the set actually differs.
//
// The caller is responsible for never passing an empty list: an empty report
// means "I could not ask" (Voicebox was not running), not "there are none".
function rememberVoices(list) {
  const voices = list.slice(0, 100).map(v => ({
    id:   String(v.id ?? ''),
    name: String(v.name ?? '').slice(0, 80),
  })).filter(v => v.id);

  if (voices.length === 0) return;

  const same = JSON.stringify(voices) === JSON.stringify(agentPresence.voices);
  agentPresence.voices = voices;
  if (same) return;

  // Replace the stored set rather than merging, so a profile deleted in the
  // Voicebox app stops being offered. Fire-and-forget: the picker already has
  // the list from the cache, and a failed write costs the next restart's
  // memory, not this session's.
  (async () => {
    const ids = voices.map(v => v.id);
    await ClipperVoice.deleteMany({ voiceId: { $nin: ids } });
    await ClipperVoice.bulkWrite(voices.map(v => ({
      updateOne: {
        filter: { voiceId: v.id },
        update: { $set: { name: v.name, lastSeenAt: new Date() } },
        upsert: true,
      },
    })));
  })().catch(() => {});
}

// The profiles to show, preferring the hot cache and falling back to what was
// last persisted. The fallback is the whole point: a freshly restarted backend
// has an empty cache and cannot refill it on its own, because enumerating
// profiles requires Voicebox to be running and only the admin pressing Reload
// voices starts it.
async function knownVoices() {
  if (agentPresence.voices.length) return agentPresence.voices;

  const rows = await ClipperVoice.find({}).sort({ name: 1 }).lean().catch(() => []);
  const voices = rows.map(r => ({ id: r.voiceId, name: r.name }));
  agentPresence.voices = voices;
  return voices;
}

// Where the agent is serving its own temp files, if it managed to bind a port.
//
// Only loopback is accepted. The value is handed to the admin's browser as a
// media origin, and the agent is by definition on the same machine as that
// browser, so anything else is either a misconfiguration or a way to make the
// UI fetch from somewhere it has no business fetching from.
function sanitiseMediaBaseUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

const AGENT_ONLINE_MS = 30 * 1000;   // agent beats every 10s

// How long a claimed job may go untouched before another agent may take it.
// Comfortably longer than the slowest real job (a render), so a working agent
// is never robbed of work it is still doing.
const STALE_CLAIM_MS = 15 * 60 * 1000;

function agentIsOnline() {
  return Boolean(agentPresence.at) && (Date.now() - agentPresence.at) < AGENT_ONLINE_MS;
}

// Which script field each job type writes into. A job whose type is not here
// completes without touching the script, which is correct for jobs that only
// produce a file the next stage will pick up.
const JOB_RESULT_FIELD = {
  voice:  'voice',
  // captions and render are handled specially below — captions need alignment
  // against the script, renders append rather than replace.
  captions: null,
  render:   null,
};

// Fold a partial voice result into the lines a script already has.
//
// A regenerate narrates one beat, so the agent returns one line. Replacing
// `voice` wholesale with that would delete every other take.
//
// The offsets then have to be rebuilt from scratch. `startMs` is where a line
// sits in the finished narration, and it is what buildTimeline rebases caption
// words against — so a replacement take that is even 200ms longer or shorter
// silently slides every caption after it out of step with the audio. They are
// recomputed here, in the script's own beat order (outro last, exactly as
// buildTimeline lays them out), rather than trusted from the job.
function mergeVoiceLines(script, result) {
  const existing = Array.isArray(script.voice?.lines) ? script.voice.lines : [];
  const incoming = Array.isArray(result?.lines) ? result.lines : [];

  const byId = new Map(existing.map(l => [l.beatId, l]));
  for (const line of incoming) byId.set(line.beatId, line);

  // Anything whose beat has since been deleted from the script would otherwise
  // linger for ever, contributing its duration to a beat that no longer exists.
  const order = [...(script.script?.beats ?? []).map(b => b.id), 'outro'];
  const { lines, totalDurationMs } = placeVoiceLines([...byId.values()], order);

  return {
    ...(script.voice || {}),
    ...result,
    lines,
    totalDurationMs,
  };
}

async function applyJobResult(job) {
  const field = JOB_RESULT_FIELD[job.type];

  // Handled before the script lookup, because it is the one result that has
  // nothing to do with a script: the job carries an arbitrary scriptId only
  // because the model requires one. Behind the lookup, a voices result was
  // dropped whenever that borrowed script had since been deleted — and the
  // symptom would be the profile picker staying empty for no visible reason.
  if (job.type === 'voices') {
    if (Array.isArray(job.result?.voices)) rememberVoices(job.result.voices);
    return;
  }

  const script = await ClipperScript.findById(job.scriptId);
  if (!script) return;

  if (job.type === 'render') {
    const renders = Array.isArray(script.renders) ? [...script.renders] : [];
    renders.unshift({ ...(job.result || {}), jobId: String(job._id), createdAt: new Date() });
    script.renders = renders;
    script.markModified('renders');
  } else if (job.type === 'capture') {
    // A recording becomes that beat's chosen footage directly — there is
    // nothing to pick between, and making the admin choose a single candidate
    // would be busywork.
    const beatId = job.payload?.beatId;
    if (beatId && job.result?.localPath) {
      const footage = { ...(script.footage || {}) };
      footage[beatId] = {
        ...(footage[beatId] || {}),
        chosen: {
          provider: 'capture',
          providerId: String(job._id),
          title: job.result.label || 'Screen recording',
          // Stored as file:// because a path is the only durable identity the
          // clip has — it lives in the agent's temp folder and nowhere else.
          // Neither consumer can open that scheme (the browser refuses it from
          // an http page, the Remotion renderer downloads over http/https
          // only), so both rewrite it to the agent's media server at use time:
          // src/utils/clipperPreview.js and clipper-agent/handlers/render.js.
          // Rewriting here instead would bake in a port that dies with the
          // agent.
          playbackUrl: `file:///${String(job.result.localPath).replace(/\\/g, '/')}`,
          localPath: job.result.localPath,
          durationSec: job.result.frames && job.result.fps
            ? job.result.frames / job.result.fps : null,
          licence: 'Own content (SkyWatch screen recording)',
          sourceUrl: null,
          // Which game this is footage of. Stored on the clip so a beat can say
          // what it is holding without a lookup, and so a reused recording can
          // be told apart from one filmed for this beat.
          recipeId: job.result.recipeId || job.payload?.recipeId || '',
        },
        // Where the bot's hand went during this recording, in clip time. Kept
        // beside the clip rather than inside `chosen` because it describes the
        // recording session, not the file - a re-record replaces both, and a
        // clip picked from stock has no such thing.
        inputLog: Array.isArray(job.result.inputLog) ? job.result.inputLog : [],
      };
      script.footage = footage;
      script.markModified('footage');

      // Into the library as well, so the next script that needs this game can
      // take the recording instead of spending another twenty-five seconds of
      // browser automation reproducing it.
      //
      // Failure here must not fail the job: the recording exists and is already
      // on the beat, and a catalogue that could not be written is a smaller
      // problem than a capture reported as failed.
      const recipeId = job.result.recipeId || job.payload?.recipeId || '';
      if (recipeId) {
        await ClipperCapture.create({
          recipeId,
          label: job.result.label || 'Screen recording',
          localPath: job.result.localPath,
          playbackUrl: footage[beatId].chosen.playbackUrl,
          durationSec: footage[beatId].chosen.durationSec,
          bytes:  job.result.bytes  ?? null,
          width:  job.result.width  ?? null,
          height: job.result.height ?? null,
          inputLog: Array.isArray(job.result.inputLog) ? job.result.inputLog : [],
          jobId: job._id,
        }).catch(() => {});
      }
    }
  } else if (job.type === 'captions') {
    // The agent reports raw whisper timings. Alignment against the known script
    // happens here, not on the agent, so the algorithm stays unit-testable and
    // whisper's text never reaches the database.
    script.captions = {
      model: job.result?.model || '',
      words: buildCaptions(script, job.result?.byBeat || {}),
      style: script.captions?.style ?? {},
    };
    script.markModified('captions');
    if (script.stageState.get('captions') === 'approved') script.stageState.set('captions', 'stale');
  } else if (job.type === 'voice') {
    // Merged rather than assigned, so regenerating one line keeps the rest.
    script.voice = mergeVoiceLines(script, job.result);
    script.markModified('voice');
    if (script.stageState.get('voice') === 'approved') script.stageState.set('voice', 'stale');

    // Caption timings are measured against these takes. A new take of any
    // length moves the words after it, so alignment has to be redone — and a
    // captions stage still marked 'approved' would hide that.
    if (script.stageState.get('captions') === 'approved') script.stageState.set('captions', 'stale');
  } else if (field) {
    script[field] = job.result;
    script.markModified(field);
    // A fresh result supersedes any approval of that stage — the admin has not
    // seen this version yet.
    if (script.stageState.get(field) === 'approved') script.stageState.set(field, 'stale');
  }

  await script.save();
}

// POST /api/clipper/agent/heartbeat
router.post('/agent/heartbeat', clipperAgentAuth, (req, res) => {
  agentPresence.at = Date.now();
  agentPresence.agentId = req.agentId;
  agentPresence.version = String(req.body?.version || '').slice(0, 32);
  agentPresence.mediaBaseUrl = sanitiseMediaBaseUrl(req.body?.mediaBaseUrl);
  agentPresence.pid = Number.isInteger(req.body?.pid) ? req.body.pid : null;

  // Voice profiles are reported by the agent rather than fetched by the server:
  // Voicebox only listens on the workstation's loopback address, so a hosted
  // backend could never reach it. The agent is the only thing that can see them.
  // An EMPTY list means "I could not ask" — Voicebox was not running when the
  // agent last looked — not "there are none". Storing it anyway is why the
  // picker kept emptying: a /voices refresh would fetch the profiles, and the
  // next heartbeat ten seconds later would wipe them again, so the admin had to
  // press Reload voices over and over. Absence of knowledge is not knowledge of
  // absence, so a heartbeat can only ever add to what is known here.
  if (Array.isArray(req.body?.voices) && req.body.voices.length > 0) {
    rememberVoices(req.body.voices);
  }
  // The heartbeat is how a stop reaches the agent. Nothing can push to it — it
  // has no inbound port by design — so the reply carries the instruction, and
  // the agent decides when to act on it. That lets it finish the render in hand
  // instead of being killed mid-encode.
  //
  // Cleared on the way out: it is a one-shot instruction, and an agent that
  // read it has already begun stopping.
  const stop = agentPresence.stopRequested;
  agentPresence.stopRequested = false;

  res.json({ status: 'success', data: { ok: true, stop } });
});

// GET /api/clipper/agent/jobs — claim the oldest queued job, if any.
//
// The claim is one atomic findOneAndUpdate. Two agents polling simultaneously
// therefore cannot receive the same job: the second one's filter no longer
// matches because status has already moved off 'queued'.
router.get('/agent/jobs', clipperAgentAuth, async (req, res) => {
  try {
    agentPresence.at = Date.now();
    agentPresence.agentId = req.agentId;

    // Also reclaim jobs stuck in 'claimed'. An agent that crashed, lost power
    // or had its terminal closed mid-job leaves one behind, and without this it
    // sits there forever looking like a render that never finishes.
    const staleBefore = new Date(Date.now() - STALE_CLAIM_MS);

    const job = await ClipperJob.findOneAndUpdate(
      {
        $or: [
          { status: 'queued' },
          { status: 'claimed', claimedAt: { $lt: staleBefore } },
        ],
      },
      {
        $set: { status: 'claimed', claimedAt: new Date(), claimedBy: req.agentId },
        $inc: { attempts: 1 },
      },
      { sort: { createdAt: 1 }, returnDocument: 'after' },
    ).lean();

    // 204 rather than an empty 200: the agent polls constantly and this makes
    // "nothing to do" unambiguous without parsing a body.
    if (!job) return res.status(204).end();

    res.json({ status: 'success', data: { job } });
  } catch (err) { fail(res, err); }
});

// POST /api/clipper/agent/jobs/:id/progress
router.post('/agent/jobs/:id/progress', clipperAgentAuth, async (req, res) => {
  try {
    agentPresence.at = Date.now();
    const pct = Math.max(0, Math.min(100, Number(req.body?.progress) || 0));
    await ClipperJob.updateOne(
      { _id: req.params.id },
      { $set: { progress: pct, stepLabel: String(req.body?.stepLabel || '').slice(0, 120) } },
    );
    res.json({ status: 'success', data: { ok: true } });
  } catch (err) { fail(res, err); }
});

// POST /api/clipper/agent/jobs/:id/result   { ok, result?, error? }
router.post('/agent/jobs/:id/result', clipperAgentAuth, async (req, res) => {
  try {
    agentPresence.at = Date.now();

    const job = await ClipperJob.findById(req.params.id);
    if (!job) { const e = new Error('Job not found'); e.status = 404; throw e; }

    if (req.body?.ok) {
      job.status = 'done';
      job.result = req.body.result ?? null;
      job.progress = 100;
      job.error = '';

      // Fold the result onto the script it belongs to. Without this the work
      // would sit on the job document and the UI would never see it — the
      // script is what every later stage reads from.
      await applyJobResult(job);
    } else {
      // Retry until maxAttempts, then give up. attempts was already incremented
      // at claim time, so a job that has burned its allowance stays failed
      // rather than being handed out forever.
      const canRetry = job.attempts < job.maxAttempts;
      job.status = canRetry ? 'queued' : 'failed';
      job.error = String(req.body?.error || 'Unknown agent error').slice(0, 2000);
      if (canRetry) job.claimedAt = null;
    }
    job.finishedAt = new Date();
    await job.save();

    res.json({ status: 'success', data: { job: job.toObject() } });
  } catch (err) { fail(res, err); }
});

// ── Admin ───────────────────────────────────────────────────────────────────
// Clipper is admin-only end to end, and every AI call inside it should log
// against the 'clipper' feature on the OpenRouter usage page.
router.use(protect, adminOnly, featureMiddleware('clipper'));

// POST /api/clipper/agent/start — launch the local agent from the UI.
//
// Clipper only runs on the workstation, so "the server" and "the machine with
// the agent on it" are the same box. Making the admin keep a terminal open
// purely to run a fixed command is friction with no upside — and forgetting to
// is indistinguishable, from the UI, from the feature being broken.
//
// This spawns one known script and nothing else: no user input reaches the
// command line. On a hosted deployment `clipper-agent/` is not shipped at all
// (Railway takes only backend/), so the path check refuses there.
router.post('/agent/start', async (_req, res) => {
  try {
    if (agentIsOnline()) {
      return res.json({ status: 'success', data: { alreadyRunning: true } });
    }

    const entry = path.join(AGENT_DIR, 'index.js');
    if (!fs.existsSync(entry)) {
      const e = new Error('The Clipper agent is not installed on this machine');
      e.status = 400; throw e;
    }

    // detached + unref so the agent outlives this request. Without it the
    // agent dies with the HTTP response and the pill flicks straight back
    // to offline.
    const child = childProcess.spawn(process.execPath, [entry], {
      cwd: AGENT_DIR,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();

    res.status(202).json({ status: 'success', data: { pid: child.pid } });
  } catch (err) { fail(res, err); }
});

// GET /api/clipper/agent/status — drives the online/offline pill in the UI.
router.get('/agent/status', async (_req, res) => {
  try {
    const counts = await ClipperJob.aggregate([
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]);
    const queue = { queued: 0, claimed: 0, done: 0, failed: 0 };
    for (const row of counts) if (row._id in queue) queue[row._id] = row.n;

    res.json({
      status: 'success',
      data: {
        online: agentIsOnline(),
        configured: Boolean(process.env.CLIPPER_AGENT_TOKEN),
        lastSeenAt: agentPresence.at ? new Date(agentPresence.at).toISOString() : null,
        agentId: agentPresence.agentId,
        version: agentPresence.version,
        pid: agentPresence.pid,
        stopping: agentPresence.stopRequested,
        installed: fs.existsSync(path.join(AGENT_DIR, 'index.js')),
        queue,
      },
    });
  } catch (err) { fail(res, err); }
});

// POST /api/clipper/agent/stop   { force? }
//
// Cooperative by default: the agent is told to stop on its next heartbeat and
// exits once the job in hand is done. A render can be minutes of work, and
// killing it wastes all of it — the file is only written at the end.
//
// `force` kills the process the agent reported instead. Reserved for an agent
// that has stopped heartbeating altogether, because it loses whatever was
// running. Always by PID: killing by name would take down every node process on
// the machine, this backend included.
router.post('/agent/stop', async (req, res) => {
  try {
    if (!agentIsOnline() && !req.body?.force) {
      return res.json({ status: 'success', data: { alreadyStopped: true } });
    }

    if (req.body?.force) {
      const pid = agentPresence.pid;
      if (!pid) {
        const e = new Error('The agent has not reported a process id, so it cannot be force-stopped');
        e.status = 400; throw e;
      }
      try {
        process.kill(pid, 'SIGKILL');
      } catch (err) {
        // ESRCH means it is already gone, which is the outcome we wanted.
        if (err.code !== 'ESRCH') throw err;
      }
      // Presence is in-memory; clearing it makes the UI show offline at once
      // rather than waiting out the 30-second liveness window.
      agentPresence.at = null;
      agentPresence.pid = null;
      agentPresence.stopRequested = false;
      return res.json({ status: 'success', data: { forced: true } });
    }

    agentPresence.stopRequested = true;
    res.status(202).json({ status: 'success', data: { requested: true } });
  } catch (err) { fail(res, err); }
});

// POST /api/clipper/agent/restart
//
// The reason this exists: node loads a module once, so an agent started before
// an edit keeps running the old code. Two bugs looked unfixed for exactly that
// reason before anyone thought to check the process start time.
//
// Force-stops rather than asking nicely, because a restart is usually wanted
// now; the response says whether work was interrupted so the UI can say so.
router.post('/agent/restart', async (_req, res) => {
  try {
    const entry = path.join(AGENT_DIR, 'index.js');
    if (!fs.existsSync(entry)) {
      const e = new Error('The Clipper agent is not installed on this machine');
      e.status = 400; throw e;
    }

    const busy = await ClipperJob.countDocuments({ status: 'claimed' });
    const pid = agentPresence.pid;

    if (pid) {
      try { process.kill(pid, 'SIGKILL'); } catch (err) { if (err.code !== 'ESRCH') throw err; }
    }
    agentPresence.at = null;
    agentPresence.pid = null;
    agentPresence.stopRequested = false;

    const child = childProcess.spawn(process.execPath, [entry], {
      cwd: AGENT_DIR, detached: true, stdio: 'ignore', windowsHide: true,
    });
    child.unref();

    res.status(202).json({ status: 'success', data: { pid: child.pid, interrupted: busy } });
  } catch (err) { fail(res, err); }
});

// GET /api/clipper/agent/queue
//
// Newest first, across every script. The per-script view already exists; this
// is for the times when something is stuck and you do not yet know which script
// it belongs to.
router.get('/agent/queue', async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));

    const jobs = await ClipperJob.find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      // Payloads carry whole timelines and base64 nothing-in-particular; the
      // queue view wants none of it and the response should not be a megabyte.
      .select('-payload -result')
      .lean();

    const counts = await ClipperJob.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
    const queue = { queued: 0, claimed: 0, done: 0, failed: 0 };
    for (const row of counts) if (row._id in queue) queue[row._id] = row.n;

    // Titles, so a row reads as "the render for the DPT video" rather than an
    // ObjectId. One query rather than one per job.
    const scriptIds = [...new Set(jobs.map(j => String(j.scriptId)).filter(Boolean))];
    const scripts = await ClipperScript.find({ _id: { $in: scriptIds } }).select('title').lean();
    const titleById = new Map(scripts.map(s => [String(s._id), s.title]));

    res.json({
      status: 'success',
      data: {
        queue,
        jobs: jobs.map(j => ({ ...j, scriptTitle: titleById.get(String(j.scriptId)) || null })),
      },
    });
  } catch (err) { fail(res, err); }
});

// DELETE /api/clipper/agent/jobs/:id
//
// Refuses a job the agent is running. Deleting it would not stop the work — the
// agent already has the payload — and the result would then land on a job that
// no longer exists, so the stage would silently never update.
router.delete('/agent/jobs/:id', async (req, res) => {
  try {
    const job = await ClipperJob.findById(req.params.id);
    if (!job) { const e = new Error('Job not found'); e.status = 404; throw e; }

    if (job.status === 'claimed') {
      const e = new Error(
        'That job is running right now. Stop the agent first, or wait for it to finish.',
      );
      e.status = 409; throw e;
    }

    await job.deleteOne();
    res.json({ status: 'success', data: { deleted: String(job._id) } });
  } catch (err) { fail(res, err); }
});

// POST /api/clipper/agent/jobs/:id/retry
//
// Requeue a failed job as it was. The usual cause of a failure is something
// outside the job — Voicebox not running, the agent on stale code — so the
// payload is still exactly right and re-driving the UI to rebuild it is busywork.
router.post('/agent/jobs/:id/retry', async (req, res) => {
  try {
    const job = await ClipperJob.findById(req.params.id);
    if (!job) { const e = new Error('Job not found'); e.status = 404; throw e; }
    if (job.status !== 'failed') {
      const e = new Error('Only a failed job can be retried'); e.status = 400; throw e;
    }

    job.status = 'queued';
    job.error = '';
    job.progress = 0;
    job.stepLabel = '';
    job.claimedAt = null;
    job.claimedBy = '';
    job.finishedAt = null;
    // Reset the count too: attempts exists to stop a broken job looping for
    // ever, and this is a deliberate human decision to try it again.
    job.attempts = 0;
    await job.save();

    res.json({ status: 'success', data: { job: job.toObject() } });
  } catch (err) { fail(res, err); }
});

// POST /api/clipper/agent/jobs/clear   { status: 'failed' | 'done' }
//
// Clearing failures is the point: a failed job sits in the queue for ever and
// its error is the first thing shown, long after it has been fixed.
router.post('/agent/jobs/clear', async (req, res) => {
  try {
    const status = String(req.body?.status || '');
    if (!['failed', 'done'].includes(status)) {
      // Never queued or claimed: those are live work, and clearing them is
      // deleting a job, which has its own endpoint and its own guard.
      const e = new Error('Only failed or done jobs can be cleared'); e.status = 400; throw e;
    }

    const { deletedCount } = await ClipperJob.deleteMany({ status });
    res.json({ status: 'success', data: { deleted: deletedCount } });
  } catch (err) { fail(res, err); }
});

// ── Facts ───────────────────────────────────────────────────────────────────

// POST /api/clipper/facts/ingest
// Body: { source?: string }  — the guide's raw HTML/JS source.
//
// In production the guide file does not exist: Railway ships only backend/, so
// APPLICATION_INFO/ is absent (project_railway_backend_only). The source must
// therefore be supplied in the request body. Reading from disk is a local-dev
// convenience only, and never a fallback we rely on.
router.post('/facts/ingest', async (req, res) => {
  try {
    let source = typeof req.body?.source === 'string' ? req.body.source : '';

    if (!source) {
      if (!fs.existsSync(DEFAULT_GUIDE_PATH)) {
        const err = new Error(
          'No source supplied and the guide file is not present on this server. ' +
          'Upload the guide from the Clipper page.',
        );
        err.status = 400;
        throw err;
      }
      source = fs.readFileSync(DEFAULT_GUIDE_PATH, 'utf8');
    }

    const { facts, blocklist, counts } = parseGuideSource(source);

    // Upsert per fact so the ledger (useCount / anglesUsed) survives re-ingest.
    // $setOnInsert covers the ledger fields; $set covers content that may have
    // been edited in the guide.
    const ops = facts.map(f => ({
      updateOne: {
        filter: { factKey: f.factKey },
        update: {
          $set: {
            sourceSlug: SOURCE_SLUG,
            sourceKind: f.sourceKind,
            containerId: f.containerId,
            containerName: f.containerName,
            containerAbbr: f.containerAbbr,
            grade: f.grade,
            tag: f.tag,
            text: f.text,
            why: f.why,
            refs: f.refs,
            refCount: f.refCount,
            contentHash: f.contentHash,
          },
          $setOnInsert: { useCount: 0, anglesUsed: [], retired: false, lastUsedAt: null },
        },
        upsert: true,
      },
    }));
    if (ops.length) await ClipperFact.bulkWrite(ops);

    const sourceDoc = await ClipperSource.findOneAndUpdate(
      { slug: SOURCE_SLUG },
      {
        $set: {
          title: 'CBAT Complete Guide',
          nameBlocklist: blocklist,
          sourceHash: crypto.createHash('sha256').update(source).digest('hex'),
          factCount: counts.total,
          gradeCounts: { green: counts.green, amber: counts.amber, red: counts.red },
          ingestedBy: req.user?._id ?? null,
          ingestedAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();

    res.json({
      status: 'success',
      data: { counts, blocklistSize: blocklist.length, source: sourceDoc },
    });
  } catch (err) { fail(res, err); }
});

// GET /api/clipper/facts — the ledger view.
router.get('/facts', async (req, res) => {
  try {
    const query = {};
    if (req.query.grade)  query.grade = req.query.grade;
    if (req.query.kind)   query.sourceKind = req.query.kind;
    if (req.query.unused === 'true') query.useCount = 0;
    if (req.query.includeRetired !== 'true') query.retired = false;

    const facts = await ClipperFact.find(query)
      .sort({ useCount: 1, grade: 1, factKey: 1 })
      .lean();

    const source = await ClipperSource.findOne({ slug: SOURCE_SLUG }).lean();

    res.json({
      status: 'success',
      data: {
        facts,
        ingested: Boolean(source),
        counts: source?.gradeCounts ?? { green: 0, amber: 0, red: 0 },
      },
    });
  } catch (err) { fail(res, err); }
});

// PATCH /api/clipper/facts/:factKey — retire / un-retire.
router.patch('/facts/:factKey', async (req, res) => {
  try {
    const fact = await ClipperFact.findOneAndUpdate(
      { factKey: req.params.factKey },
      { $set: { retired: Boolean(req.body?.retired) } },
      { new: true },
    ).lean();
    if (!fact) { const e = new Error('Fact not found'); e.status = 404; throw e; }
    res.json({ status: 'success', data: { fact } });
  } catch (err) { fail(res, err); }
});

// ── Ideas ───────────────────────────────────────────────────────────────────

// Facts eligible for generation. Red is excluded at the source rather than
// relying on the model to skip it — see the grade gate in clipperGuardrails.
async function eligibleFacts() {
  return ClipperFact.find({ retired: false, grade: { $in: ['green', 'amber'] } })
    .sort({ useCount: 1 })
    .lean();
}

// POST /api/clipper/ideas/generate  { count?, mode? }
router.post('/ideas/generate', async (req, res) => {
  try {
    const facts = await eligibleFacts();
    if (facts.length === 0) {
      const e = new Error('No facts ingested yet - run ingest first'); e.status = 400; throw e;
    }

    // Prior one-liners feed the dedup pass so a new batch cannot restate an
    // idea we already scripted.
    const prior = await ClipperScript.find({}, { 'idea.oneLiner': 1 }).lean();
    const priorOneLiners = prior.map(s => s?.idea?.oneLiner).filter(Boolean);

    const count = Math.min(Math.max(parseInt(req.body?.count, 10) || 6, 1), 12);
    const mode  = req.body?.mode === 'feature' || req.body?.mode === 'tips' ? req.body.mode : null;

    const ideas = await generateIdeas({ facts, priorOneLiners, count, mode });
    res.json({ status: 'success', data: { ideas, generated: ideas.length } });
  } catch (err) { fail(res, err); }
});

// ── Scripts ─────────────────────────────────────────────────────────────────

// POST /api/clipper/scripts — promote a chosen idea into a script project.
router.post('/scripts', async (req, res) => {
  try {
    const idea = req.body?.idea;
    if (!idea?.oneLiner) { const e = new Error('idea.oneLiner is required'); e.status = 400; throw e; }

    const doc = await ClipperScript.create({
      title: String(idea.oneLiner).slice(0, 60),
      mode:  idea.mode === 'feature' ? 'feature' : 'tips',
      subject: normaliseSubject(req.body?.subject ?? idea.subject),
      idea: {
        oneLiner: String(idea.oneLiner),
        hook:     String(idea.hook  ?? ''),
        angle:    String(idea.angle ?? ''),
        factKeys: Array.isArray(idea.factKeys) ? idea.factKeys : [],
      },
      outro: { enabled: req.body?.outroEnabled !== false, copy: '' },
      createdBy: req.user?._id ?? null,
    });

    res.status(201).json({ status: 'success', data: { script: doc.toObject() } });
  } catch (err) { fail(res, err); }
});

router.get('/scripts', async (_req, res) => {
  try {
    const scripts = await ClipperScript.find({})
      .sort({ updatedAt: -1 })
      .select('title mode subject stage idea.oneLiner script.wordCount script.estDurationSec validation.ok updatedAt')
      .lean();
    res.json({ status: 'success', data: { scripts } });
  } catch (err) { fail(res, err); }
});

router.get('/scripts/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      const e = new Error('Invalid script id'); e.status = 400; throw e;
    }
    const script = await ClipperScript.findById(req.params.id).lean();
    if (!script) { const e = new Error('Script not found'); e.status = 404; throw e; }

    // Resolve each beat's free-text SFX cue to a catalogue id here rather than
    // in the browser: the alias table lives server-side with the catalogue, and
    // duplicating it in the UI would let the two drift.
    if (Array.isArray(script.script?.beats)) {
      script.script.beats = script.script.beats.map(b => ({
        ...b,
        resolvedSfxId: resolveCue(b.sfxCue),
      }));
    }

    res.json({ status: 'success', data: { script } });
  } catch (err) { fail(res, err); }
});

// Run the guardrails over a script's current copy and persist the result.
async function revalidate(scriptDoc) {
  const keys = new Set();
  for (const b of scriptDoc.script?.beats ?? []) {
    for (const k of b.factKeys ?? []) keys.add(k);
  }
  const facts  = await ClipperFact.find({ factKey: { $in: [...keys] } }).lean();
  const source = await ClipperSource.findOne({ slug: SOURCE_SLUG }).lean();

  const result = validateScript(
    { beats: scriptDoc.script?.beats ?? [], outro: scriptDoc.outro },
    facts,
    source?.nameBlocklist ?? [],
    scriptDoc.subject,
  );

  scriptDoc.validation = {
    ok: result.ok,
    checkedAt: new Date(),
    findings: result.findings,
  };
  return result;
}

// Cut loose the per-beat work that no longer belongs to the beat holding it.
//
// Call this after replacing doc.script.beats, with the beats (and outro copy)
// as they were beforehand. Beat ids are positional, so without it a rewritten
// script inherits the previous one's footage, takes, sfx, overlays and captions
// by id alone - see utils/clipperBeatCarry.js for what survives and why.
function carryBeatWork(doc, previousBeats, previousOutro) {
  const beats = doc.script?.beats ?? [];
  const plan  = planBeatCarry(previousBeats, beats);

  const outroCopy = doc.outro?.copy ?? '';
  const outroSurvives = Boolean(previousOutro) && previousOutro === outroCopy;
  const extra = outroSurvives ? ['outro'] : [];

  // Saving a script whose lines nobody touched must cost nothing, so what was
  // actually let go decides whether the timeline stands - a rendered edit is
  // expensive to rebuild and it is still true of work that all survived.
  const snapshot = () => JSON.stringify([doc.footage, doc.voice, doc.sfx, doc.overlays, doc.captions]);
  const before = snapshot();

  doc.footage  = pruneFootage(doc.footage, plan, beats);
  doc.voice    = pruneVoice(doc.voice, plan, beats, outroSurvives);
  doc.sfx      = pruneBeatRows(doc.sfx, plan, extra);
  doc.overlays = pruneBeatRows(doc.overlays, plan, extra);

  if (doc.captions) {
    // The style is a look the admin chose for the video, not work done on a
    // line, so it outlives the words it was set on.
    doc.captions = { ...doc.captions, words: pruneBeatRows(doc.captions.words, plan, extra) };
  }

  const fields = ['footage', 'voice', 'sfx', 'overlays', 'captions'];

  if (snapshot() !== before) {
    // Built from every one of the above, so it cannot outlive them.
    doc.timeline = null;
    fields.push('timeline');
  }

  for (const field of fields) doc.markModified(field);
}

// Beats as plain objects, captured before they are overwritten - a Mongoose
// subdocument array is replaced in place, so reading it afterwards would give
// the new beats and every carry decision would trivially agree with itself.
const beatsSnapshot = (doc) =>
  (doc.script?.beats ?? []).map(b => (typeof b?.toObject === 'function' ? b.toObject() : b));

// POST /api/clipper/scripts/:id/script/generate
router.post('/scripts/:id/script/generate', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      const e = new Error('Invalid script id'); e.status = 400; throw e;
    }
    const doc = await ClipperScript.findById(req.params.id);
    if (!doc) { const e = new Error('Script not found'); e.status = 404; throw e; }

    // The subject decides what the writer is told to say and to film, so it is
    // taken here as well as on PATCH. Picking a game and pressing Regenerate is
    // the whole gesture, and it used to write a script for whatever subject was
    // last saved - usually none, which is a video that shows no product.
    if ('subject' in (req.body || {})) doc.subject = normaliseSubject(req.body.subject);

    const facts = await ClipperFact.find({
      factKey: { $in: doc.idea.factKeys },
      grade: { $in: ['green', 'amber'] },
    }).lean();

    if (facts.length === 0) {
      const e = new Error('This idea has no usable facts attached'); e.status = 400; throw e;
    }

    const previousBeats = beatsSnapshot(doc);
    const previousOutro = doc.outro?.copy ?? '';

    const generated = await generateScript({
      idea: doc.idea,
      facts,
      mode: doc.mode,
      outroEnabled: doc.outro?.enabled !== false,
      subject: doc.subject,
    });

    doc.title  = generated.title;
    doc.script = {
      beats: generated.beats,
      wordCount: generated.wordCount,
      estDurationSec: generated.estDurationSec,
      format: generated.format,
    };
    if (doc.outro?.enabled) doc.outro.copy = generated.outro;

    // Regenerating the script invalidates everything built on top of it.
    for (const stage of ['footage', 'voice', 'captions', 'sfx', 'overlays', 'export']) {
      if (doc.stageState.get(stage) === 'approved') doc.stageState.set(stage, 'stale');
    }
    carryBeatWork(doc, previousBeats, previousOutro);

    const validation = await revalidate(doc);
    await doc.save();

    res.json({ status: 'success', data: { script: doc.toObject(), validation } });
  } catch (err) { fail(res, err); }
});

// PATCH /api/clipper/scripts/:id — edit beats/outro by hand, then revalidate.
router.patch('/scripts/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      const e = new Error('Invalid script id'); e.status = 400; throw e;
    }
    const doc = await ClipperScript.findById(req.params.id);
    if (!doc) { const e = new Error('Script not found'); e.status = 404; throw e; }

    const previousBeats = beatsSnapshot(doc);
    const previousOutro = doc.outro?.copy ?? '';

    if (typeof req.body?.title === 'string') doc.title = req.body.title;
    // Changing what the video is about changes what the validator asks of it,
    // so it is edited here rather than being fixed at creation.
    if ('subject' in (req.body || {})) doc.subject = normaliseSubject(req.body.subject);
    if (Array.isArray(req.body?.beats)) {
      doc.script.beats = req.body.beats;
      doc.script.wordCount = req.body.beats
        .reduce((n, b) => n + String(b.text || '').split(/\s+/).filter(Boolean).length, 0);
      doc.script.estDurationSec = Math.round(doc.script.wordCount / 2.6);
    }
    if (req.body?.outro && typeof req.body.outro === 'object') {
      if (typeof req.body.outro.enabled === 'boolean') doc.outro.enabled = req.body.outro.enabled;
      if (typeof req.body.outro.copy === 'string')     doc.outro.copy    = req.body.outro.copy;
    }

    // Rewriting a line by hand strands its clip and its take exactly as
    // regenerating does. Skipped when neither was touched, so renaming a script
    // does not throw away a built timeline.
    const rewroteCopy = Array.isArray(req.body?.beats) || typeof req.body?.outro?.copy === 'string';
    if (rewroteCopy) carryBeatWork(doc, previousBeats, previousOutro);

    const validation = await revalidate(doc);
    await doc.save();

    res.json({ status: 'success', data: { script: doc.toObject(), validation } });
  } catch (err) { fail(res, err); }
});

// ── Stage 2: footage ────────────────────────────────────────────────────────

// POST /api/clipper/scripts/:id/footage/search   { beatId?, term? }
// Searches for one beat, or every stock beat when no beatId is given.
router.post('/scripts/:id/footage/search', async (req, res) => {
  try {
    const doc = await ClipperScript.findById(req.params.id);
    if (!doc) { const e = new Error('Script not found'); e.status = 404; throw e; }

    const beats = doc.script?.beats ?? [];
    const targets = req.body?.beatId
      ? beats.filter(b => b.id === req.body.beatId)
      : beats.filter(b => b.visual?.kind === 'stock');

    if (targets.length === 0) {
      const e = new Error('No matching beats to search for'); e.status = 400; throw e;
    }

    const footage = { ...(doc.footage || {}) };

    // Sequential rather than parallel: three providers per beat already fans
    // out, and hammering them with every beat at once invites rate limiting.
    for (const beat of targets) {
      const term = String(req.body?.term || beat.visual?.query || '').trim();
      if (!term) continue;
      // The beat's own words go with the term: the query names a thing to
      // film, the line says what the shot has to sit under, and a candidate
      // that matches both is the one that belongs there.
      const candidates = await searchFootage(term, { beatText: beat.text });
      footage[beat.id] = {
        ...(footage[beat.id] || {}),
        term,
        candidates,
        searchedAt: new Date().toISOString(),
      };
    }

    doc.footage = footage;
    doc.markModified('footage');
    if (doc.stageState.get('footage') === 'approved') doc.stageState.set('footage', 'stale');
    await doc.save();

    res.json({
      status: 'success',
      data: { footage: doc.footage, providers: configuredProviders(), providerErrors: providerStatus().failing },
    });
  } catch (err) { fail(res, err); }
});

// PATCH /api/clipper/scripts/:id/footage   { beatId, chosen, trim? }
router.patch('/scripts/:id/footage', async (req, res) => {
  try {
    const { beatId, chosen, trim } = req.body || {};
    if (!beatId) { const e = new Error('beatId is required'); e.status = 400; throw e; }

    const doc = await ClipperScript.findById(req.params.id);
    if (!doc) { const e = new Error('Script not found'); e.status = 404; throw e; }

    const footage = { ...(doc.footage || {}) };
    const entry = { ...(footage[beatId] || {}) };

    if (chosen !== undefined) {
      // A trim is an offset into one specific clip, so it cannot survive being
      // pointed at a different one — 4s into a 30s stock clip is past the end
      // of the 6s recording that replaced it.
      const before = entry.chosen;
      const changed = !before || !chosen
        || before.provider !== chosen.provider || before.providerId !== chosen.providerId;
      if (changed) delete entry.trim;

      entry.chosen = chosen;   // null clears the pick
    }

    // Merge rather than replace. The scrubber sends inMs alone, and rebuilding
    // the whole object from one field silently zeroed the other.
    if (trim) {
      const keep = entry.trim || {};
      entry.trim = {
        inMs:  trim.inMs  === undefined ? (Number(keep.inMs)  || 0) : Math.max(0, Number(trim.inMs)  || 0),
        outMs: trim.outMs === undefined ? (Number(keep.outMs) || 0) : Math.max(0, Number(trim.outMs) || 0),
      };
    }
    footage[beatId] = entry;

    doc.footage = footage;
    doc.markModified('footage');
    if (doc.stageState.get('footage') === 'approved') doc.stageState.set('footage', 'stale');
    await doc.save();

    res.json({ status: 'success', data: { footage: doc.footage } });
  } catch (err) { fail(res, err); }
});

// POST /api/clipper/scripts/:id/capture   { beatId }
// Queues a browser recording for a capture beat.
router.post('/scripts/:id/capture', async (req, res) => {
  try {
    const doc = await ClipperScript.findById(req.params.id).lean();
    if (!doc) { const e = new Error('Script not found'); e.status = 404; throw e; }

    const beat = (doc.script?.beats ?? []).find(b => b.id === req.body?.beatId);
    if (!beat) { const e = new Error('No such beat'); e.status = 400; throw e; }
    if (beat.visual?.kind !== 'capture' || !beat.visual.recipeId) {
      const e = new Error('That beat is not a capture beat'); e.status = 400; throw e;
    }

    const job = await ClipperJob.create({
      scriptId: doc._id,
      type: 'capture',
      payload: { beatId: beat.id, recipeId: beat.visual.recipeId },
      maxAttempts: 2,
    });

    res.status(202).json({ status: 'success', data: { job: job.toObject() } });
  } catch (err) { fail(res, err); }
});

// GET /api/clipper/subjects — what a video can be about.
// Served rather than duplicated in the frontend so the picker and the validator
// can never disagree about which games are filmable.
router.get('/subjects', (_req, res) => {
  res.json({ status: 'success', data: { subjects: SUBJECTS } });
});

// ── The capture library ─────────────────────────────────────────────────────

// GET /api/clipper/captures?recipeId=play-flag
// Recordings of this game that already exist, newest first.
//
// `missing` is the point of doing any work here: the files live in the agent's
// %TEMP% folder and Windows clears that, so an entry is a claim about a file
// that may be gone. Offering a dead clip would set it as the beat's footage and
// fail much later, in the render, as an asset that will not download.
router.get('/captures', async (req, res) => {
  try {
    const recipeId = String(req.query?.recipeId || '').trim();
    const query = recipeId ? { recipeId } : {};

    const rows = await ClipperCapture.find(query)
      .sort({ createdAt: -1 })
      .limit(40)
      .lean();

    const captures = rows.map(row => ({
      _id: String(row._id),
      recipeId: row.recipeId,
      label: row.label,
      playbackUrl: row.playbackUrl,
      durationSec: row.durationSec,
      width: row.width,
      height: row.height,
      recordedAt: row.createdAt,
      useCount: row.useCount || 0,
      // A recording made before the human-input work has no log and will fall
      // back to the recipe's measured crop. Surfaced so the difference between
      // an old take and a new one is visible in the picker rather than a
      // surprise in the edit.
      hasInputLog: Array.isArray(row.inputLog) && row.inputLog.length > 0,
      missing: row.localPath ? !fs.existsSync(row.localPath) : true,
    }));

    res.json({ status: 'success', data: { captures } });
  } catch (err) { fail(res, err); }
});

// POST /api/clipper/scripts/:id/footage/reuse   { beatId, captureId }
// Point a capture beat at a recording we already have.
router.post('/scripts/:id/footage/reuse', async (req, res) => {
  try {
    const doc = await ClipperScript.findById(req.params.id);
    if (!doc) { const e = new Error('Script not found'); e.status = 404; throw e; }

    const beat = (doc.script?.beats ?? []).find(b => b.id === req.body?.beatId);
    if (!beat) { const e = new Error('No such beat'); e.status = 400; throw e; }
    if (beat.visual?.kind !== 'capture') {
      const e = new Error('That beat is not a capture beat'); e.status = 400; throw e;
    }

    const capture = await ClipperCapture.findById(req.body?.captureId);
    if (!capture) { const e = new Error('That recording is no longer in the library'); e.status = 404; throw e; }

    // Filming a different game while the voice talks about this one is worse
    // than stock footage, because it looks deliberate. Enforced here and not
    // only in the picker: the beat's recipe is the whole basis for reuse.
    if (beat.visual.recipeId && capture.recipeId !== beat.visual.recipeId) {
      const e = new Error(
        `That recording is of "${capture.recipeId}", but this beat asks for "${beat.visual.recipeId}"`,
      );
      e.status = 400; throw e;
    }

    if (capture.localPath && !fs.existsSync(capture.localPath)) {
      const e = new Error(
        "That recording's file is gone - the agent keeps them in a temp folder that gets cleared. Record it again.",
      );
      e.status = 409; throw e;
    }

    const footage = { ...(doc.footage || {}) };
    footage[beat.id] = {
      ...(footage[beat.id] || {}),
      chosen: {
        provider: 'capture',
        providerId: String(capture._id),
        title: capture.label || 'Screen recording',
        playbackUrl: capture.playbackUrl,
        localPath: capture.localPath,
        durationSec: capture.durationSec,
        licence: 'Own content (SkyWatch screen recording)',
        sourceUrl: null,
        recipeId: capture.recipeId,
      },
      // Travels with the recording, so a reused clip keeps the punch-in derived
      // from where the hand actually went.
      inputLog: Array.isArray(capture.inputLog) ? capture.inputLog : [],
      // A different clip is a different length, so a trim measured against the
      // old one would seek into the wrong part of this one - or past its end.
      trim: { inMs: 0 },
    };

    doc.footage = footage;
    doc.markModified('footage');
    if (doc.stageState.get('footage') === 'approved') doc.stageState.set('footage', 'stale');
    await doc.save();

    await ClipperCapture.updateOne(
      { _id: capture._id },
      { $inc: { useCount: 1 }, $set: { lastUsedAt: new Date() } },
    ).catch(() => {});

    res.json({ status: 'success', data: { footage: doc.footage } });
  } catch (err) { fail(res, err); }
});

// DELETE /api/clipper/captures/:id — forget a recording.
//
// The catalogue entry only; the file is the agent's and its temp folder is
// cleared by the OS anyway. Deleting the row is how a bad take stops being
// offered.
router.delete('/captures/:id', async (req, res) => {
  try {
    const gone = await ClipperCapture.findByIdAndDelete(req.params.id);
    if (!gone) { const e = new Error('No such recording'); e.status = 404; throw e; }
    res.json({ status: 'success', data: { removed: String(gone._id) } });
  } catch (err) { fail(res, err); }
});

// GET /api/clipper/footage/providers — which sources are actually usable.
router.get('/footage/providers', (_req, res) => {
  const { configured, failing } = providerStatus();
  res.json({ status: 'success', data: { providers: configured, providerErrors: failing } });
});

// ── Stage 3: voice ──────────────────────────────────────────────────────────

// GET /api/clipper/voices — Voicebox profiles, as last reported by the agent,
// plus which TTS providers are actually usable.
//
// Reporting availability rather than letting the UI guess means an unconfigured
// provider is greyed out up front, instead of failing several clicks later when
// the job reaches the agent.
router.get('/voices', async (_req, res) => {
  res.json({
    status: 'success',
    data: {
      voices: await knownVoices(),
      online: agentIsOnline(),
      // Only meaningful while the agent is up — the port dies with it, so
      // reporting a stale one would have the preview retry a dead socket.
      mediaBaseUrl: agentIsOnline() ? agentPresence.mediaBaseUrl : null,
      providers: {
        voicebox:   { available: agentIsOnline(), reason: agentIsOnline() ? null : 'agent offline' },
        elevenlabs: {
          available: Boolean(process.env.ELEVENLABS_API_KEY),
          reason: process.env.ELEVENLABS_API_KEY ? null : 'ELEVENLABS_API_KEY not set',
        },
      },
    },
  });
});

// POST /api/clipper/voices/refresh — ask the agent to start Voicebox and list
// its profiles. Explicit rather than automatic: see handlers/voices.js.
router.post('/voices/refresh', async (_req, res) => {
  try {
    if (!agentIsOnline()) {
      const e = new Error('The agent is offline - start it first'); e.status = 400; throw e;
    }
    // scriptId is required by the model but meaningless here, so reuse any
    // script rather than inventing a nullable field for one job type.
    const anyScript = await ClipperScript.findOne({}).select('_id').lean();
    const job = await ClipperJob.create({
      scriptId: anyScript?._id ?? new mongoose.Types.ObjectId(),
      type: 'voices',
      payload: {},
      maxAttempts: 1,
    });
    res.status(202).json({ status: 'success', data: { job: job.toObject() } });
  } catch (err) { fail(res, err); }
});

// POST /api/clipper/scripts/:id/voice/generate  { profileId, instruct?, seed? }
router.post('/scripts/:id/voice/generate', async (req, res) => {
  try {
    const doc = await ClipperScript.findById(req.params.id);
    if (!doc) { const e = new Error('Script not found'); e.status = 404; throw e; }

    const beats = doc.script?.beats ?? [];
    if (beats.length === 0) { const e = new Error('Script has no beats'); e.status = 400; throw e; }

    const provider = req.body?.provider === 'elevenlabs' ? 'elevenlabs' : 'voicebox';
    if (provider === 'elevenlabs' && !process.env.ELEVENLABS_API_KEY) {
      // Enforced server-side too: the UI greys the option out, but a queued job
      // that could never run would sit in the queue looking like a hung render.
      const e = new Error('ElevenLabs is not configured - set ELEVENLABS_API_KEY');
      e.status = 400; throw e;
    }

    const profileId = String(req.body?.profileId || '').trim();
    if (!profileId) { const e = new Error('A voice profile is required'); e.status = 400; throw e; }

    // The outro is a real beat for every downstream stage, so it must be
    // narrated too — otherwise the video ends on silence over the end card.
    let payloadBeats = beats.map(b => ({ id: b.id, text: b.text }));
    if (doc.outro?.enabled && doc.outro.copy) {
      payloadBeats.push({ id: 'outro', text: doc.outro.copy });
    }

    // A regenerate targets one line. Re-narrating the whole script to redo a
    // single take costs a Voicebox generation per beat and, worse, gives every
    // other line a new delivery the admin has already approved.
    const beatIds = Array.isArray(req.body?.beatIds)
      ? req.body.beatIds.map(String).filter(Boolean)
      : null;

    if (beatIds) {
      payloadBeats = payloadBeats.filter(b => beatIds.includes(b.id));
      if (payloadBeats.length === 0) {
        const e = new Error('None of those beats exist in this script'); e.status = 400; throw e;
      }
    }

    const job = await ClipperJob.create({
      scriptId: doc._id,
      type: 'voice',
      payload: {
        beats: payloadBeats,
        // Recorded so the result can be merged rather than replacing every
        // line — the agent only returns what it was asked to narrate.
        beatIds: beatIds || undefined,
        provider,
        profileId,
        instruct: String(req.body?.instruct || '').slice(0, 500) || undefined,
        seed: Number.isInteger(req.body?.seed) ? req.body.seed : undefined,
      },
    });

    res.status(202).json({ status: 'success', data: { job: job.toObject() } });
  } catch (err) { fail(res, err); }
});

// ── Stage 4: captions ───────────────────────────────────────────────────────

// POST /api/clipper/scripts/:id/captions/generate
router.post('/scripts/:id/captions/generate', async (req, res) => {
  try {
    const doc = await ClipperScript.findById(req.params.id).lean();
    if (!doc) { const e = new Error('Script not found'); e.status = 404; throw e; }

    const lines = doc.voice?.lines ?? [];
    if (lines.length === 0) {
      const e = new Error('Record the narration first - captions are timed against it');
      e.status = 400; throw e;
    }

    const job = await ClipperJob.create({
      scriptId: doc._id,
      type: 'captions',
      payload: { lines: lines.map(l => ({ beatId: l.beatId, wavPath: l.wavPath })) },
    });

    res.status(202).json({ status: 'success', data: { job: job.toObject() } });
  } catch (err) { fail(res, err); }
});

// PATCH /api/clipper/scripts/:id/captions — styling only; word timings are
// measured, not edited.
router.patch('/scripts/:id/captions', async (req, res) => {
  try {
    const doc = await ClipperScript.findById(req.params.id);
    if (!doc) { const e = new Error('Script not found'); e.status = 404; throw e; }

    doc.captions = { ...(doc.captions || {}), style: req.body?.style ?? {} };
    doc.markModified('captions');
    await doc.save();

    res.json({ status: 'success', data: { captions: doc.captions } });
  } catch (err) { fail(res, err); }
});

// ── Stage 5: SFX ────────────────────────────────────────────────────────────

// GET /api/clipper/sfx/library — the closed catalogue, plus how the script
// writer's free-text cues map onto it.
router.get('/sfx/library', (_req, res) => {
  res.json({ status: 'success', data: { sfx: SFX, dir: SFX_DIR } });
});

// ── Music ───────────────────────────────────────────────────────────────────

// GET /api/clipper/music/library — the tracks available to put under a video.
router.get('/music/library', async (_req, res) => {
  try {
    const tracks = await ClipperMusic.find({}).sort({ title: 1 }).lean();
    res.json({
      status: 'success',
      data: {
        dir: MUSIC_DIR,
        // Reported so the UI can say why a library is empty on a fresh clone,
        // rather than looking broken.
        writable: fs.existsSync(path.dirname(MUSIC_ABS_DIR)),
        tracks: tracks.map(t => ({ ...t, src: musicPath(t.file) })),
      },
    });
  } catch (err) { fail(res, err); }
});

// GET /api/clipper/music/search?q= — CC0 / public-domain candidates.
router.get('/music/search', async (req, res) => {
  try {
    const term = String(req.query.q || '').trim();
    if (!term) { const e = new Error('A search term is required'); e.status = 400; throw e; }

    // Openverse rate-limits anonymous callers, so its refusal is a 400-class
    // problem the admin can act on, not a 500 that reads as our fault.
    let results;
    try {
      results = await searchMusic(term, { limit: 24 });
    } catch (err) {
      err.status = 502;
      throw err;
    }

    // Which are already in the library, so the UI can say "added" rather than
    // offering to import a second copy.
    const ids = results.map(r => r.providerId);
    const have = await ClipperMusic.find({ providerId: { $in: ids } }).select('providerId').lean();
    const haveIds = new Set(have.map(t => t.providerId));

    res.json({
      status: 'success',
      data: { results: results.map(r => ({ ...r, imported: haveIds.has(r.providerId) })) },
    });
  } catch (err) { fail(res, err); }
});

// POST /api/clipper/music/import   { candidate }
//
// Downloads a track into public/sounds/music/ and registers it.
//
// The licence is checked here as well as at search time. This is the last point
// before a file becomes something that can end up under a published video, and
// the request body comes from a browser — so "the search only returns CC0" is
// not a guarantee this route may rely on.
router.post('/music/import', async (req, res) => {
  try {
    const c = req.body?.candidate;
    if (!c?.downloadUrl || !c?.title) {
      const e = new Error('A track to import is required'); e.status = 400; throw e;
    }

    // Licence, restated from the source of truth rather than trusted from the
    // client: a request could otherwise relabel a CC-BY track as CC0 simply by
    // sending a different string.
    const licence = String(c.licence || '');
    const code = licence.split(/\s+/)[0].toLowerCase();
    if (!isFreeLicence(code)) {
      const e = new Error(
        `Refusing to import "${c.title}": its licence (${licence || 'unknown'}) is not CC0 or ` +
        'public domain. Only licences that require no attribution are imported automatically.',
      );
      e.status = 400; throw e;
    }

    if (!fs.existsSync(path.dirname(MUSIC_ABS_DIR))) {
      const e = new Error(
        'public/sounds/ is not present, so there is nowhere to put the file. Clipper imports ' +
        'run on the workstation, against the repo.',
      );
      e.status = 400; throw e;
    }
    fs.mkdirSync(MUSIC_ABS_DIR, { recursive: true });

    const ext = ['mp3', 'ogg', 'wav', 'flac', 'm4a'].includes(String(c.filetype)) ? c.filetype : 'mp3';
    let slug = slugify(c.title);
    // Two tracks can share a title; the slug is a filename and a key.
    if (await ClipperMusic.exists({ slug })) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
    const file = `${slug}.${ext}`;

    const download = await fetch(c.downloadUrl, { headers: { 'User-Agent': 'SkyWatch/1.0' } });
    if (!download.ok) {
      const e = new Error(`Could not download the track (${download.status})`); e.status = 502; throw e;
    }
    const bytes = Buffer.from(await download.arrayBuffer());
    fs.writeFileSync(path.join(MUSIC_ABS_DIR, file), bytes);

    // Measured here rather than at render time: it is a property of the file,
    // it costs a decode, and the answer never changes.
    const tempo = await detectBpm(path.join(MUSIC_ABS_DIR, file));

    const track = await ClipperMusic.create({
      slug,
      title: String(c.title).slice(0, 200),
      creator: String(c.creator || '').slice(0, 120),
      file,
      durationMs: Number(c.durationMs) || 0,
      bytes: bytes.length,
      licence,
      licenceUrl: String(c.licenceUrl || ''),
      sourceUrl: String(c.sourceUrl || ''),
      attribution: String(c.attribution || ''),
      provider: 'openverse',
      providerId: String(c.providerId || ''),
      bpm: tempo.bpm,
      bpmConfidence: tempo.confidence || 0,
    });

    res.status(201).json({
      status: 'success',
      data: { track: { ...track.toObject(), src: musicPath(track.file) } },
    });
  } catch (err) { fail(res, err); }
});

// DELETE /api/clipper/music/:slug
//
// Removes the file as well as the row. A track left on disk with no entry is
// invisible clutter that still ships in the Remotion bundle.
router.delete('/music/:slug', async (req, res) => {
  try {
    const track = await ClipperMusic.findOne({ slug: req.params.slug });
    if (!track) { const e = new Error('Track not found'); e.status = 404; throw e; }

    const inUse = await ClipperScript.countDocuments({ 'music.slug': track.slug });
    if (inUse > 0) {
      const e = new Error(`That track is used by ${inUse} script(s). Change those first.`);
      e.status = 409; throw e;
    }

    fs.rmSync(path.join(MUSIC_ABS_DIR, track.file), { force: true });
    await track.deleteOne();
    res.json({ status: 'success', data: { deleted: track.slug } });
  } catch (err) { fail(res, err); }
});

// PATCH /api/clipper/scripts/:id/music   { slug, volume?, duckVolume?, fadeOutMs? }
//
// One track per video, chosen here. Levels live on the script rather than the
// track: the same bed sits differently under a busy read than a sparse one.
router.patch('/scripts/:id/music', async (req, res) => {
  try {
    const doc = await ClipperScript.findById(req.params.id);
    if (!doc) { const e = new Error('Script not found'); e.status = 404; throw e; }

    const slug = req.body?.slug;
    if (slug === null || slug === '') {
      doc.music = null;
    } else if (slug !== undefined) {
      const track = await ClipperMusic.findOne({ slug }).lean();
      if (!track) { const e = new Error('Track not found'); e.status = 400; throw e; }
      doc.music = {
        ...(doc.music || {}),
        slug: track.slug,
        title: track.title,
        file: track.file,
        licence: track.licence,
        sourceUrl: track.sourceUrl,
        durationMs: track.durationMs,
        // Copied onto the script rather than looked up at render time, so a
        // video renders identically after the library row is edited or gone.
        bpm: track.bpm ?? null,
      };
    }

    if (doc.music) {
      const clamp01 = (v, fallback) =>
        (v === undefined ? fallback : Math.max(0, Math.min(1, Number(v) || 0)));
      doc.music.volume     = clamp01(req.body?.volume, doc.music.volume ?? 0.18);
      doc.music.duckVolume = clamp01(req.body?.duckVolume, doc.music.duckVolume ?? 0.06);
      doc.music.fadeOutMs  = Math.max(0, Number(req.body?.fadeOutMs ?? doc.music.fadeOutMs ?? 1500));
    }

    doc.markModified('music');
    await doc.save();
    res.json({ status: 'success', data: { music: doc.music } });
  } catch (err) { fail(res, err); }
});

// PATCH /api/clipper/scripts/:id/sfx   { sfx: [{ beatId, sfxId, atMs, gain, enabled }] }
router.patch('/scripts/:id/sfx', async (req, res) => {
  try {
    const doc = await ClipperScript.findById(req.params.id);
    if (!doc) { const e = new Error('Script not found'); e.status = 404; throw e; }

    const rows = Array.isArray(req.body?.sfx) ? req.body.sfx : [];
    doc.sfx = rows
      .filter(s => s && s.beatId && SFX_BY_ID.has(s.sfxId))
      .slice(0, 60)
      .map(s => ({
        beatId:  String(s.beatId),
        sfxId:   String(s.sfxId),
        atMs:    Math.max(0, Number(s.atMs) || 0),
        // Capped below 1: a stinger at full volume competes with the narration
        // and costs you the line it was meant to punctuate.
        gain:    Math.max(0, Math.min(0.9, Number(s.gain ?? 0.6))),
        enabled: s.enabled !== false,
      }));
    doc.markModified('sfx');
    await doc.save();

    res.json({ status: 'success', data: { sfx: doc.sfx } });
  } catch (err) { fail(res, err); }
});

// ── Stage 6: overlays ───────────────────────────────────────────────────────

// PATCH /api/clipper/scripts/:id/overlays   { overlays: [...] }
//
// Overlays are stored as a flat list keyed by beat rather than on the beats
// themselves, so regenerating the script does not wipe hand-tuned callouts —
// they re-attach by beat id.
router.patch('/scripts/:id/overlays', async (req, res) => {
  try {
    const doc = await ClipperScript.findById(req.params.id);
    if (!doc) { const e = new Error('Script not found'); e.status = 404; throw e; }

    const rows = Array.isArray(req.body?.overlays) ? req.body.overlays : [];
    doc.overlays = rows
      .filter(o => o && o.beatId && String(o.text || '').trim())
      .slice(0, 50)
      .map(o => ({
        beatId:    String(o.beatId),
        text:      String(o.text).slice(0, 120),
        animation: ['pop', 'slide', 'none'].includes(o.animation) ? o.animation : 'pop',
        topPct:    Math.max(2, Math.min(90, Number(o.topPct) || 16)),
        fontSize:  Math.max(24, Math.min(110, Number(o.fontSize) || 58)),
        color:       String(o.color || '#ddeaf8').slice(0, 32),
        borderColor: String(o.borderColor || '#5baaff').slice(0, 32),
      }));
    doc.markModified('overlays');
    await doc.save();

    res.json({ status: 'success', data: { overlays: doc.overlays } });
  } catch (err) { fail(res, err); }
});

// ── Stage 7: render ─────────────────────────────────────────────────────────

// PATCH /api/clipper/scripts/:id/branding — { enabled }
//
// Where the mark goes and when it names the domain is decided by the timeline
// builder, not here; the only per-video choice is whether it appears at all.
// Footage we do not own the rights to brand as ours is the case this exists for.
router.patch('/scripts/:id/branding', async (req, res) => {
  try {
    const doc = await ClipperScript.findById(req.params.id);
    if (!doc) { const e = new Error('Script not found'); e.status = 404; throw e; }

    doc.branding = { ...(doc.branding || {}), enabled: req.body?.enabled !== false };
    doc.markModified('branding');
    await doc.save();

    res.json({ status: 'success', data: { branding: doc.branding } });
  } catch (err) { fail(res, err); }
});

// GET /api/clipper/scripts/:id/timeline — what the preview player mounts.
router.get('/scripts/:id/timeline', async (req, res) => {
  try {
    const doc = await ClipperScript.findById(req.params.id).lean();
    if (!doc) { const e = new Error('Script not found'); e.status = 404; throw e; }
    res.json({ status: 'success', data: { timeline: buildTimeline(doc) } });
  } catch (err) { fail(res, err); }
});

// POST /api/clipper/scripts/:id/render
router.post('/scripts/:id/render', async (req, res) => {
  try {
    const doc = await ClipperScript.findById(req.params.id).lean();
    if (!doc) { const e = new Error('Script not found'); e.status = 404; throw e; }

    const timeline = buildTimeline(doc);
    if (timeline.beats.length === 0) {
      const e = new Error('Nothing to render - write a script first'); e.status = 400; throw e;
    }

    // The timeline is snapshotted into the job rather than rebuilt by the agent.
    // A render must reproduce what was on screen when the button was pressed,
    // even if someone edits the script while it runs.
    const job = await ClipperJob.create({
      scriptId: doc._id,
      type: 'render',
      payload: { timeline },
      maxAttempts: 1,   // renders are slow; retrying a broken one wastes minutes
    });

    res.status(202).json({ status: 'success', data: { job: job.toObject() } });
  } catch (err) { fail(res, err); }
});

// Where the agent writes finished MP4s. Mirrors OUT_DIR in
// clipper-agent/handlers/render.js — both read the same variable and fall back
// to the same temp path, so they agree without the backend importing agent code
// it cannot rely on being present (Railway ships backend/ alone).
//
// This is the allowlist for the reveal endpoint below, which is why it has to
// agree with the agent exactly: set CLIPPER_RENDER_DIR on one side only and
// every "Show in folder" is refused as being outside the renders folder.
const RENDER_DIR = process.env.CLIPPER_RENDER_DIR
  ? path.resolve(process.env.CLIPPER_RENDER_DIR)
  : path.join(os.tmpdir(), 'skywatch-clipper', 'renders');

// POST /api/clipper/renders/reveal   { path }
//
// Opens the containing folder with the file selected. The render lands in a
// temp directory nobody would find by guessing, and "it's on the machine
// somewhere" is not an answer when the whole point of the stage is to hand you
// a file to upload.
//
// The path comes from the client, so it is resolved and checked against
// RENDER_DIR before it goes anywhere near a shell. Only renders — not the
// capture folder, not the rest of the disk.
router.post('/renders/reveal', async (req, res) => {
  try {
    const wanted = path.resolve(String(req.body?.path || ''));
    const rel = path.relative(RENDER_DIR, wanted);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      const e = new Error('That file is not in the Clipper renders folder'); e.status = 400; throw e;
    }
    if (!fs.existsSync(wanted)) {
      // Temp files get swept. Say so plainly rather than opening an empty
      // folder and leaving you to work out which file went missing.
      const e = new Error('That render is no longer on disk - render it again'); e.status = 404; throw e;
    }

    // Argument arrays throughout, never a shell string: the path is
    // user-supplied and a quoted concatenation is one stray character away
    // from being a command. explorer.exe is the exception it looks like — it
    // insists on the single `/select,<path>` token — but that is still one
    // argv entry, not shell syntax.
    if (process.platform === 'win32') {
      childProcess.spawn('explorer.exe', [`/select,${wanted}`], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      childProcess.spawn('open', ['-R', wanted], { detached: true, stdio: 'ignore' }).unref();
    } else {
      childProcess.spawn('xdg-open', [path.dirname(wanted)], { detached: true, stdio: 'ignore' }).unref();
    }

    res.json({ status: 'success', data: { revealed: wanted, folder: path.dirname(wanted) } });
  } catch (err) { fail(res, err); }
});

// GET /api/clipper/scripts/:id/jobs — queue state for one script, so the UI can
// show progress on work the agent is doing right now.
router.get('/scripts/:id/jobs', async (req, res) => {
  try {
    const jobs = await ClipperJob.find({ scriptId: req.params.id })
      .sort({ createdAt: -1 }).limit(20).lean();
    res.json({ status: 'success', data: { jobs } });
  } catch (err) { fail(res, err); }
});

// POST /api/clipper/scripts/:id/stages/:stage/approve
router.post('/scripts/:id/stages/:stage/approve', async (req, res) => {
  try {
    const { stage } = req.params;
    if (!ClipperScript.STAGES.includes(stage)) {
      const e = new Error(`Unknown stage "${stage}"`); e.status = 400; throw e;
    }
    const doc = await ClipperScript.findById(req.params.id);
    if (!doc) { const e = new Error('Script not found'); e.status = 404; throw e; }

    if (stage === 'script') {
      const validation = await revalidate(doc);
      if (!validation.ok) {
        await doc.save();
        const e = new Error('Script has unresolved guardrail errors'); e.status = 422;
        return res.status(422).json({ message: e.message, data: { validation } });
      }

      // Credit the ledger once, on first approval. Without the guard, toggling
      // approve off and on would inflate useCount and make the coverage map lie.
      if (!doc.ledgerCommittedAt) {
        const keys = [...new Set(doc.script.beats.flatMap(b => b.factKeys ?? []))];
        if (keys.length) {
          await ClipperFact.updateMany(
            { factKey: { $in: keys } },
            {
              $inc: { useCount: 1 },
              $set: { lastUsedAt: new Date() },
              $push: {
                anglesUsed: {
                  scriptId: doc._id,
                  hook:  doc.idea.hook,
                  angle: doc.idea.angle,
                  usedAt: new Date(),
                },
              },
            },
          );
        }
        doc.ledgerCommittedAt = new Date();
      }
    }

    doc.stageState.set(stage, 'approved');
    await doc.save();

    res.json({ status: 'success', data: { script: doc.toObject() } });
  } catch (err) { fail(res, err); }
});

module.exports = router;

// Agent presence is deliberately module-level, in-memory state (see the note
// where it is declared). That makes it survive between tests in a file, so a
// heartbeat in one test leaves the agent "online" for the next thirty seconds
// and silently changes what later tests exercise. Tests reset it explicitly.
module.exports._resetAgentPresenceForTests = () => {
  agentPresence.at = null;
  agentPresence.agentId = null;
  agentPresence.version = null;
  agentPresence.voices = [];
  agentPresence.mediaBaseUrl = null;
  agentPresence.pid = null;
  agentPresence.stopRequested = false;
};
