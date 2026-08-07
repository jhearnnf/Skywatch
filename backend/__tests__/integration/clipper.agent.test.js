/**
 * clipper.agent.test.js
 *
 * The local-agent half of Clipper: token auth, atomic job claiming, progress,
 * result reporting and retry, and the status endpoint behind admin auth.
 */

process.env.JWT_SECRET = 'test_secret';
process.env.CLIPPER_AGENT_TOKEN = 'test_agent_token';

const request = require('supertest');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const mongoose = require('mongoose');
const app = require('../../app');
const db  = require('../helpers/setupDb');
const { createAdminUser, createUser, authCookie } = require('../helpers/factories');

const ClipperJob = require('../../models/ClipperJob');

const AGENT = 'Bearer test_agent_token';
let adminCookie, userCookie, scriptId;

const clipperRouter = require('../../routes/clipper');

beforeAll(async () => { await db.connect(); });
afterEach(async () => {
  jest.restoreAllMocks();
  // Agent liveness is in-memory and has a 30s window, so without this a
  // heartbeat in one test changes the behaviour of every test after it.
  clipperRouter._resetAgentPresenceForTests();
  await db.clearDatabase();
});
afterAll(async () => { await db.closeDatabase(); });

beforeEach(async () => {
  adminCookie = authCookie(await createAdminUser());
  userCookie  = authCookie(await createUser());
  scriptId = new mongoose.Types.ObjectId();
});

const queueJob = (type = 'voice', payload = {}) =>
  ClipperJob.create({ scriptId, type, payload });

describe('agent token auth', () => {
  it('rejects a request with no token', async () => {
    await request(app).get('/api/clipper/agent/jobs').expect(401);
  });

  it('rejects a wrong token', async () => {
    await request(app)
      .get('/api/clipper/agent/jobs')
      .set('Authorization', 'Bearer nope')
      .expect(401);
  });

  it('rejects a token of the same length but different bytes', async () => {
    // Guards the constant-time compare: same length takes the timingSafeEqual
    // path rather than the early length return.
    await request(app)
      .get('/api/clipper/agent/jobs')
      .set('Authorization', 'Bearer test_agent_tokeX')
      .expect(401);
  });

  it('does not accept an admin session cookie in place of the token', async () => {
    // The agent surface is a separate trust boundary; a logged-in admin browser
    // should not be able to drain the job queue by navigating to it.
    await request(app)
      .get('/api/clipper/agent/jobs')
      .set('Cookie', adminCookie)
      .expect(401);
  });

  it('accepts the configured token', async () => {
    await request(app).get('/api/clipper/agent/jobs').set('Authorization', AGENT).expect(204);
  });

  it('closes the endpoints entirely when no token is configured', async () => {
    const saved = process.env.CLIPPER_AGENT_TOKEN;
    delete process.env.CLIPPER_AGENT_TOKEN;
    try {
      await request(app).get('/api/clipper/agent/jobs').set('Authorization', AGENT).expect(503);
    } finally {
      process.env.CLIPPER_AGENT_TOKEN = saved;
    }
  });
});

describe('claiming jobs', () => {
  it('204s when the queue is empty', async () => {
    await request(app).get('/api/clipper/agent/jobs').set('Authorization', AGENT).expect(204);
  });

  it('claims the oldest queued job and marks it claimed', async () => {
    const first  = await queueJob('voice');
    await new Promise(r => setTimeout(r, 5));
    await queueJob('render');

    const res = await request(app)
      .get('/api/clipper/agent/jobs').set('Authorization', AGENT).expect(200);

    expect(res.body.data.job._id).toBe(String(first._id));
    expect(res.body.data.job.status).toBe('claimed');
    expect(res.body.data.job.attempts).toBe(1);
  });

  it('never hands the same job to two agents at once', async () => {
    // The whole point of doing the claim as one findOneAndUpdate.
    await queueJob('voice');

    const results = await Promise.all([
      request(app).get('/api/clipper/agent/jobs').set('Authorization', AGENT),
      request(app).get('/api/clipper/agent/jobs').set('Authorization', AGENT),
      request(app).get('/api/clipper/agent/jobs').set('Authorization', AGENT),
    ]);

    const claimed = results.filter(r => r.status === 200);
    const empty   = results.filter(r => r.status === 204);
    expect(claimed).toHaveLength(1);
    expect(empty).toHaveLength(2);
  });

  it('does not re-claim a job another agent is actively working', async () => {
    await ClipperJob.create({ scriptId, type: 'voice', status: 'claimed', claimedAt: new Date() });
    await request(app).get('/api/clipper/agent/jobs').set('Authorization', AGENT).expect(204);
  });

  it('reclaims a job whose agent died mid-run', async () => {
    // An agent that crashed or had its terminal closed leaves a job stuck in
    // 'claimed'. Without reclaim it sits there forever looking like a render
    // that never finishes.
    const stale = new Date(Date.now() - 20 * 60 * 1000);
    const job = await ClipperJob.create({
      scriptId, type: 'capture', status: 'claimed', claimedAt: stale, claimedBy: 'dead-agent',
    });

    const res = await request(app)
      .get('/api/clipper/agent/jobs').set('Authorization', AGENT).expect(200);

    expect(res.body.data.job._id).toBe(String(job._id));
    expect(res.body.data.job.claimedBy).toBe('agent');
    expect(res.body.data.job.attempts).toBe(1);
  });

  it('still respects maxAttempts on a reclaimed job', async () => {
    // Reclaiming must not become an infinite retry loop for a job that fails
    // by crashing the agent every time.
    const stale = new Date(Date.now() - 20 * 60 * 1000);
    const job = await ClipperJob.create({
      scriptId, type: 'capture', status: 'claimed', claimedAt: stale,
      attempts: 3, maxAttempts: 3,
    });

    await request(app).get('/api/clipper/agent/jobs').set('Authorization', AGENT).expect(200);
    await request(app)
      .post(`/api/clipper/agent/jobs/${job._id}/result`)
      .set('Authorization', AGENT).send({ ok: false, error: 'crashed again' }).expect(200);

    expect((await ClipperJob.findById(job._id).lean()).status).toBe('failed');
  });
});

describe('reporting results', () => {
  it('stores a successful result and completes the job', async () => {
    const job = await queueJob('voice');
    await request(app)
      .post(`/api/clipper/agent/jobs/${job._id}/result`)
      .set('Authorization', AGENT)
      .send({ ok: true, result: { wavPath: 'x.wav', durationMs: 4200 } })
      .expect(200);

    const saved = await ClipperJob.findById(job._id).lean();
    expect(saved.status).toBe('done');
    expect(saved.progress).toBe(100);
    expect(saved.result.durationMs).toBe(4200);
  });

  it('requeues a failure while attempts remain', async () => {
    const job = await ClipperJob.create({ scriptId, type: 'voice', attempts: 1, maxAttempts: 3 });
    await request(app)
      .post(`/api/clipper/agent/jobs/${job._id}/result`)
      .set('Authorization', AGENT)
      .send({ ok: false, error: 'voicebox not running' })
      .expect(200);

    const saved = await ClipperJob.findById(job._id).lean();
    expect(saved.status).toBe('queued');
    expect(saved.error).toMatch(/voicebox/);
  });

  it('gives up once maxAttempts is exhausted', async () => {
    const job = await ClipperJob.create({ scriptId, type: 'voice', attempts: 3, maxAttempts: 3 });
    await request(app)
      .post(`/api/clipper/agent/jobs/${job._id}/result`)
      .set('Authorization', AGENT)
      .send({ ok: false, error: 'still broken' })
      .expect(200);

    expect((await ClipperJob.findById(job._id).lean()).status).toBe('failed');
  });

  it('records progress on a running job', async () => {
    const job = await queueJob('render');
    await request(app)
      .post(`/api/clipper/agent/jobs/${job._id}/progress`)
      .set('Authorization', AGENT)
      .send({ progress: 42, stepLabel: 'encoding' })
      .expect(200);

    const saved = await ClipperJob.findById(job._id).lean();
    expect(saved.progress).toBe(42);
    expect(saved.stepLabel).toBe('encoding');
  });

  it('clamps out-of-range progress rather than storing it', async () => {
    const job = await queueJob('render');
    await request(app)
      .post(`/api/clipper/agent/jobs/${job._id}/progress`)
      .set('Authorization', AGENT).send({ progress: 999 }).expect(200);
    expect((await ClipperJob.findById(job._id).lean()).progress).toBe(100);
  });
});

describe('starting the agent from the UI', () => {
  // Never actually spawn: a test that leaves a detached agent polling the dev
  // backend would outlive the suite.
  const child_process = require('child_process');

  function mockSpawn() {
    return jest.spyOn(child_process, 'spawn').mockReturnValue({ pid: 4242, unref() {} });
  }

  it('is admin-only', async () => {
    await request(app).post('/api/clipper/agent/start').expect(401);
    await request(app).post('/api/clipper/agent/start').set('Cookie', userCookie).expect(403);
  });

  it('spawns the agent detached so it outlives the request', async () => {
    const spy = mockSpawn();
    const res = await request(app)
      .post('/api/clipper/agent/start').set('Cookie', adminCookie).expect(202);

    expect(res.body.data.pid).toBe(4242);
    const [, , opts] = spy.mock.calls[0];
    expect(opts.detached).toBe(true);
    expect(opts.stdio).toBe('ignore');
  });

  it('passes no user input to the command line', async () => {
    // The endpoint runs one fixed script; nothing from the request reaches it.
    const spy = mockSpawn();
    await request(app)
      .post('/api/clipper/agent/start').set('Cookie', adminCookie)
      .send({ evil: '; rm -rf /' }).expect(202);

    const [cmd, args] = spy.mock.calls[0];
    expect(cmd).toBe(process.execPath);
    expect(args).toHaveLength(1);
    expect(args[0]).toMatch(/clipper-agent[\\/]index\.js$/);
  });

  it('does not spawn a second agent when one is already running', async () => {
    const spy = mockSpawn();
    await request(app)
      .post('/api/clipper/agent/heartbeat').set('Authorization', AGENT).send({}).expect(200);

    const res = await request(app)
      .post('/api/clipper/agent/start').set('Cookie', adminCookie).expect(200);

    expect(res.body.data.alreadyRunning).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses when the agent is not installed on this machine', async () => {
    // The hosted deployment ships only backend/, so the directory is absent.
    const realExists = fs.existsSync;
    jest.spyOn(fs, 'existsSync').mockImplementation(p =>
      String(p).includes('clipper-agent') ? false : realExists(p));

    const res = await request(app)
      .post('/api/clipper/agent/start').set('Cookie', adminCookie).expect(400);
    expect(res.body.message).toMatch(/not installed/i);
  });
});

describe('agent status', () => {
  it('is admin-only, not agent-token-only', async () => {
    await request(app).get('/api/clipper/agent/status').set('Authorization', AGENT).expect(401);
    await request(app).get('/api/clipper/agent/status').set('Cookie', userCookie).expect(403);
    await request(app).get('/api/clipper/agent/status').set('Cookie', adminCookie).expect(200);
  });

  it('reports the agent online after a heartbeat, with queue counts', async () => {
    await queueJob('voice');
    await ClipperJob.create({ scriptId, type: 'render', status: 'failed' });

    await request(app)
      .post('/api/clipper/agent/heartbeat')
      .set('Authorization', AGENT)
      .send({ version: '0.1.0' })
      .expect(200);

    const res = await request(app)
      .get('/api/clipper/agent/status').set('Cookie', adminCookie).expect(200);

    expect(res.body.data.online).toBe(true);
    expect(res.body.data.configured).toBe(true);
    expect(res.body.data.queue.queued).toBe(1);
    expect(res.body.data.queue.failed).toBe(1);
  });
});

// A render lands in a temp folder nobody would guess, so the UI offers to open
// it. The path comes from the client, which makes the containment check the
// whole point of the endpoint.
describe('revealing a render', () => {
  const os = require('os');
  const RENDER_DIR = path.join(os.tmpdir(), 'skywatch-clipper', 'renders');
  const FILE = path.join(RENDER_DIR, 'reveal-test.mp4');

  let spawn;
  beforeEach(() => {
    fs.mkdirSync(RENDER_DIR, { recursive: true });
    fs.writeFileSync(FILE, 'x');
    spawn = jest.spyOn(childProcess, 'spawn')
      .mockReturnValue({ unref: jest.fn(), on: jest.fn() });
  });
  afterEach(() => { fs.rmSync(FILE, { force: true }); });

  const reveal = (p) => request(app)
    .post('/api/clipper/renders/reveal').set('Cookie', adminCookie).send({ path: p });

  it('opens the folder for a real render', async () => {
    const res = await reveal(FILE).expect(200);
    expect(res.body.data.folder).toBe(RENDER_DIR);
    expect(spawn).toHaveBeenCalled();
  });

  it('never passes the path through a shell', async () => {
    await reveal(FILE).expect(200);
    const [, args, opts] = spawn.mock.calls[0];
    expect(Array.isArray(args)).toBe(true);
    expect(opts.shell).toBeUndefined();
  });

  it('refuses a path outside the renders folder', async () => {
    await reveal(path.join(os.homedir(), '.ssh', 'id_rsa')).expect(400);
    await reveal(path.join(RENDER_DIR, '..', 'capture', 'x.mp4')).expect(400);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('refuses an empty path rather than opening the folder itself', async () => {
    await reveal('').expect(400);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('404s a render the OS has already swept', async () => {
    await reveal(path.join(RENDER_DIR, 'gone.mp4')).expect(404);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('is admin-only', async () => {
    await request(app).post('/api/clipper/renders/reveal')
      .set('Cookie', userCookie).send({ path: FILE }).expect(403);
    expect(spawn).not.toHaveBeenCalled();
  });
});

// Screen recordings live only on the agent's disk. The preview player can play
// them only if the agent is serving them, so the base URL it reports has to
// reach the UI — and has to disappear the moment the agent does.
describe('agent media server', () => {
  const heartbeat = (body) => request(app)
    .post('/api/clipper/agent/heartbeat').set('Authorization', AGENT).send(body).expect(200);

  const voices = () => request(app)
    .get('/api/clipper/voices').set('Cookie', adminCookie).expect(200);

  it('passes a loopback media URL through to the UI', async () => {
    await heartbeat({ version: '0.1.0', mediaBaseUrl: 'http://127.0.0.1:52341' });
    expect((await voices()).body.data.mediaBaseUrl).toBe('http://127.0.0.1:52341');
  });

  it('normalises the URL down to its origin', async () => {
    await heartbeat({ mediaBaseUrl: 'http://localhost:9001/file?path=x' });
    expect((await voices()).body.data.mediaBaseUrl).toBe('http://localhost:9001');
  });

  it('rejects a non-loopback host', async () => {
    await heartbeat({ mediaBaseUrl: 'http://evil.example.com:8080' });
    expect((await voices()).body.data.mediaBaseUrl).toBeNull();
  });

  it('rejects a non-http scheme', async () => {
    await heartbeat({ mediaBaseUrl: 'file:///C:/Users/James/AppData/Local/Temp' });
    expect((await voices()).body.data.mediaBaseUrl).toBeNull();
  });

  it('reports nothing when the agent could not bind a port', async () => {
    await heartbeat({ version: '0.1.0' });
    expect((await voices()).body.data.mediaBaseUrl).toBeNull();
  });

  // A port dies with the process that opened it, so serving a remembered one
  // would have the preview retry a socket that is no longer there.
  it('drops the URL once the agent goes offline', async () => {
    await heartbeat({ mediaBaseUrl: 'http://127.0.0.1:52341' });

    // Past the 30s liveness window, without waiting 30 seconds for it.
    const later = Date.now() + 31 * 1000;
    jest.spyOn(Date, 'now').mockReturnValue(later);
    const res = await voices();
    Date.now.mockRestore();

    expect(res.body.data.online).toBe(false);
    expect(res.body.data.mediaBaseUrl).toBeNull();
  });
});
