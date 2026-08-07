const router = require('express').Router();
const fs     = require('fs');
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
const ClipperJob    = require('../models/ClipperJob');

const { parseGuideSource, DEFAULT_GUIDE_PATH } = require('../utils/clipperFactParser');
const { validateScript } = require('../utils/clipperGuardrails');
const { generateIdeas, generateScript } = require('../services/clipperAi');
const { searchFootage, configuredProviders } = require('../utils/clipperFootage');
const { buildTimeline } = require('../utils/clipperTimeline');
const { buildCaptions } = require('../utils/clipperCaptions');
const { SFX, SFX_BY_ID, SFX_DIR, resolveCue } = require('../constants/clipperSfx');

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
const agentPresence = { at: null, agentId: null, version: null, voices: [], mediaBaseUrl: null };

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

async function applyJobResult(job) {
  const field = JOB_RESULT_FIELD[job.type];
  const script = await ClipperScript.findById(job.scriptId);
  if (!script) return;

  if (job.type === 'render') {
    const renders = Array.isArray(script.renders) ? [...script.renders] : [];
    renders.unshift({ ...(job.result || {}), jobId: String(job._id), createdAt: new Date() });
    script.renders = renders;
    script.markModified('renders');
  } else if (job.type === 'voices') {
    // Not script data — it belongs to the agent, so it lands on the presence
    // record the picker reads rather than on this (arbitrary) script.
    if (Array.isArray(job.result?.voices)) agentPresence.voices = job.result.voices;
    return;
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
        },
      };
      script.footage = footage;
      script.markModified('footage');
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

  // Voice profiles are reported by the agent rather than fetched by the server:
  // Voicebox only listens on the workstation's loopback address, so a hosted
  // backend could never reach it. The agent is the only thing that can see them.
  if (Array.isArray(req.body?.voices)) {
    agentPresence.voices = req.body.voices.slice(0, 100).map(v => ({
      id:   String(v.id ?? ''),
      name: String(v.name ?? '').slice(0, 80),
    })).filter(v => v.id);
  }
  res.json({ status: 'success', data: { ok: true } });
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
        queue,
      },
    });
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
      .select('title mode stage idea.oneLiner script.wordCount script.estDurationSec validation.ok updatedAt')
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
  );

  scriptDoc.validation = {
    ok: result.ok,
    checkedAt: new Date(),
    findings: result.findings,
  };
  return result;
}

// POST /api/clipper/scripts/:id/script/generate
router.post('/scripts/:id/script/generate', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      const e = new Error('Invalid script id'); e.status = 400; throw e;
    }
    const doc = await ClipperScript.findById(req.params.id);
    if (!doc) { const e = new Error('Script not found'); e.status = 404; throw e; }

    const facts = await ClipperFact.find({
      factKey: { $in: doc.idea.factKeys },
      grade: { $in: ['green', 'amber'] },
    }).lean();

    if (facts.length === 0) {
      const e = new Error('This idea has no usable facts attached'); e.status = 400; throw e;
    }

    const generated = await generateScript({
      idea: doc.idea,
      facts,
      mode: doc.mode,
      outroEnabled: doc.outro?.enabled !== false,
    });

    doc.title  = generated.title;
    doc.script = {
      beats: generated.beats,
      wordCount: generated.wordCount,
      estDurationSec: generated.estDurationSec,
    };
    if (doc.outro?.enabled) doc.outro.copy = generated.outro;

    // Regenerating the script invalidates everything built on top of it.
    for (const stage of ['footage', 'voice', 'captions', 'sfx', 'overlays', 'export']) {
      if (doc.stageState.get(stage) === 'approved') doc.stageState.set(stage, 'stale');
    }

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

    if (typeof req.body?.title === 'string') doc.title = req.body.title;
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
      const candidates = await searchFootage(term);
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
      data: { footage: doc.footage, providers: configuredProviders() },
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

    if (chosen !== undefined) entry.chosen = chosen;   // null clears the pick
    if (trim) entry.trim = { inMs: Number(trim.inMs) || 0, outMs: Number(trim.outMs) || 0 };
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

// GET /api/clipper/footage/providers — which sources are actually usable.
router.get('/footage/providers', (_req, res) => {
  res.json({ status: 'success', data: { providers: configuredProviders() } });
});

// ── Stage 3: voice ──────────────────────────────────────────────────────────

// GET /api/clipper/voices — Voicebox profiles, as last reported by the agent,
// plus which TTS providers are actually usable.
//
// Reporting availability rather than letting the UI guess means an unconfigured
// provider is greyed out up front, instead of failing several clicks later when
// the job reaches the agent.
router.get('/voices', (_req, res) => {
  res.json({
    status: 'success',
    data: {
      voices: agentPresence.voices || [],
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
    const payloadBeats = beats.map(b => ({ id: b.id, text: b.text }));
    if (doc.outro?.enabled && doc.outro.copy) {
      payloadBeats.push({ id: 'outro', text: doc.outro.copy });
    }

    const job = await ClipperJob.create({
      scriptId: doc._id,
      type: 'voice',
      payload: {
        beats: payloadBeats,
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
};
