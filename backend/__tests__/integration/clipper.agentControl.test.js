/**
 * clipper.agentControl.test.js
 *
 * The agent settings panel's endpoints: stop, restart, queue listing, removing
 * a job, retrying a failed one, and clearing finished/failed.
 *
 * The rules worth protecting are the ones that lose work when broken — a stop
 * that kills a render mid-encode, a delete that removes a job the agent is
 * already running, a clear that takes live work with it.
 */

process.env.JWT_SECRET = 'test_secret';
process.env.CLIPPER_AGENT_TOKEN = 'test_agent_token';

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../app');
const db  = require('../helpers/setupDb');
const { createAdminUser, createUser, authCookie } = require('../helpers/factories');

const ClipperJob    = require('../../models/ClipperJob');
const ClipperScript = require('../../models/ClipperScript');
const clipperRouter = require('../../routes/clipper');

const AGENT = 'Bearer test_agent_token';
let adminCookie, userCookie, scriptId;

beforeAll(async () => { await db.connect(); });
afterEach(async () => {
  jest.restoreAllMocks();
  clipperRouter._resetAgentPresenceForTests();
  await db.clearDatabase();
});
afterAll(async () => { await db.closeDatabase(); });

beforeEach(async () => {
  adminCookie = authCookie(await createAdminUser());
  userCookie  = authCookie(await createUser());
  scriptId = new mongoose.Types.ObjectId();
});

const beat = (body = {}) => request(app)
  .post('/api/clipper/agent/heartbeat').set('Authorization', AGENT).send(body).expect(200);

const job = (over = {}) => ClipperJob.create({ scriptId, type: 'voice', ...over });

describe('stopping the agent', () => {
  // A render is minutes of work and only writes its file at the end, so the
  // default has to let the agent finish rather than killing it.
  it('asks the agent to stop on its next heartbeat', async () => {
    await beat({ pid: 4242 });

    await request(app).post('/api/clipper/agent/stop')
      .set('Cookie', adminCookie).send({}).expect(202);

    const res = await beat({ pid: 4242 });
    expect(res.body.data.stop).toBe(true);
  });

  it('only says stop once', async () => {
    await beat({ pid: 4242 });
    await request(app).post('/api/clipper/agent/stop').set('Cookie', adminCookie).send({}).expect(202);

    expect((await beat({ pid: 4242 })).body.data.stop).toBe(true);
    expect((await beat({ pid: 4242 })).body.data.stop).toBe(false);
  });

  it('does not ask an agent that is not there', async () => {
    const res = await request(app).post('/api/clipper/agent/stop')
      .set('Cookie', adminCookie).send({}).expect(200);
    expect(res.body.data.alreadyStopped).toBe(true);
  });

  it('shows in the status while it is pending', async () => {
    await beat({ pid: 4242 });
    await request(app).post('/api/clipper/agent/stop').set('Cookie', adminCookie).send({}).expect(202);

    const res = await request(app).get('/api/clipper/agent/status').set('Cookie', adminCookie).expect(200);
    expect(res.body.data.stopping).toBe(true);
  });
});

describe('force-stopping the agent', () => {
  it('kills the reported process, and only that one', async () => {
    await beat({ pid: 4242 });
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);

    await request(app).post('/api/clipper/agent/stop')
      .set('Cookie', adminCookie).send({ force: true }).expect(200);

    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(4242, 'SIGKILL');
  });

  it('reports offline immediately rather than waiting out the liveness window', async () => {
    await beat({ pid: 4242 });
    jest.spyOn(process, 'kill').mockImplementation(() => true);

    await request(app).post('/api/clipper/agent/stop')
      .set('Cookie', adminCookie).send({ force: true }).expect(200);

    const res = await request(app).get('/api/clipper/agent/status').set('Cookie', adminCookie).expect(200);
    expect(res.body.data.online).toBe(false);
  });

  it('refuses when the agent never reported a pid', async () => {
    await beat({});
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);

    await request(app).post('/api/clipper/agent/stop')
      .set('Cookie', adminCookie).send({ force: true }).expect(400);
    expect(kill).not.toHaveBeenCalled();
  });

  // The process being gone already is the outcome we wanted, not a failure.
  it('treats an already-dead process as success', async () => {
    await beat({ pid: 4242 });
    jest.spyOn(process, 'kill').mockImplementation(() => {
      const err = new Error('no such process'); err.code = 'ESRCH'; throw err;
    });

    await request(app).post('/api/clipper/agent/stop')
      .set('Cookie', adminCookie).send({ force: true }).expect(200);
  });
});

describe('restarting the agent', () => {
  it('kills the old process and spawns a new one', async () => {
    await beat({ pid: 4242 });
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
    const spawn = jest.spyOn(require('child_process'), 'spawn')
      .mockReturnValue({ pid: 99, unref: jest.fn() });

    const res = await request(app).post('/api/clipper/agent/restart')
      .set('Cookie', adminCookie).expect(202);

    expect(kill).toHaveBeenCalledWith(4242, 'SIGKILL');
    expect(spawn).toHaveBeenCalled();
    expect(res.body.data.pid).toBe(99);
  });

  it('says how much work it interrupted', async () => {
    await beat({ pid: 4242 });
    await job({ status: 'claimed' });
    jest.spyOn(process, 'kill').mockImplementation(() => true);
    jest.spyOn(require('child_process'), 'spawn').mockReturnValue({ pid: 99, unref: jest.fn() });

    const res = await request(app).post('/api/clipper/agent/restart')
      .set('Cookie', adminCookie).expect(202);
    expect(res.body.data.interrupted).toBe(1);
  });

  it('starts one even when none was running', async () => {
    const spawn = jest.spyOn(require('child_process'), 'spawn')
      .mockReturnValue({ pid: 99, unref: jest.fn() });

    await request(app).post('/api/clipper/agent/restart').set('Cookie', adminCookie).expect(202);
    expect(spawn).toHaveBeenCalled();
  });
});

describe('the queue view', () => {
  it('lists jobs newest first with their script title', async () => {
    const doc = await ClipperScript.create({
      _id: scriptId, title: 'DPT tips', mode: 'tips',
      idea: { oneLiner: 'x', hook: 'h', angle: 'a', factKeys: [] },
      script: { beats: [], wordCount: 0, estDurationSec: 0 },
    });
    await job({ type: 'voice' });
    await new Promise(r => setTimeout(r, 5));
    await job({ type: 'render' });

    const res = await request(app).get('/api/clipper/agent/queue')
      .set('Cookie', adminCookie).expect(200);

    expect(res.body.data.jobs.map(j => j.type)).toEqual(['render', 'voice']);
    expect(res.body.data.jobs[0].scriptTitle).toBe('DPT tips');
    expect(String(doc._id)).toBe(String(scriptId));
  });

  // Payloads carry whole render timelines; the list would be megabytes.
  it('leaves payloads and results out of the list', async () => {
    await job({ payload: { huge: 'x'.repeat(1000) }, result: { alsoHuge: true } });

    const res = await request(app).get('/api/clipper/agent/queue')
      .set('Cookie', adminCookie).expect(200);

    expect(res.body.data.jobs[0].payload).toBeUndefined();
    expect(res.body.data.jobs[0].result).toBeUndefined();
  });

  it('counts every status', async () => {
    await job({ status: 'failed' });
    await job({ status: 'done' });
    await job({ status: 'queued' });

    const res = await request(app).get('/api/clipper/agent/queue')
      .set('Cookie', adminCookie).expect(200);
    expect(res.body.data.queue).toMatchObject({ failed: 1, done: 1, queued: 1 });
  });

  it('is admin-only', async () => {
    await request(app).get('/api/clipper/agent/queue').set('Cookie', userCookie).expect(403);
  });
});

describe('removing a job', () => {
  it('removes a queued job', async () => {
    const j = await job({ status: 'queued' });
    await request(app).delete(`/api/clipper/agent/jobs/${j._id}`)
      .set('Cookie', adminCookie).expect(200);
    expect(await ClipperJob.findById(j._id)).toBeNull();
  });

  // The agent already holds the payload, so deleting the row does not stop the
  // work — it just means the result lands on a job that no longer exists and
  // the stage silently never updates.
  it('refuses to remove one the agent is running', async () => {
    const j = await job({ status: 'claimed' });
    await request(app).delete(`/api/clipper/agent/jobs/${j._id}`)
      .set('Cookie', adminCookie).expect(409);
    expect(await ClipperJob.findById(j._id)).not.toBeNull();
  });

  it('404s a job that is already gone', async () => {
    await request(app).delete(`/api/clipper/agent/jobs/${new mongoose.Types.ObjectId()}`)
      .set('Cookie', adminCookie).expect(404);
  });
});

describe('retrying a failed job', () => {
  it('requeues it unchanged', async () => {
    const j = await job({ status: 'failed', error: 'voicebox was not running', payload: { keep: 1 } });

    await request(app).post(`/api/clipper/agent/jobs/${j._id}/retry`)
      .set('Cookie', adminCookie).expect(200);

    const saved = await ClipperJob.findById(j._id).lean();
    expect(saved.status).toBe('queued');
    expect(saved.error).toBe('');
    expect(saved.payload.keep).toBe(1);
  });

  // attempts exists to stop a broken job looping for ever; a retry is a
  // deliberate decision to try again, so it starts from zero.
  it('resets the attempt count so a burnt-out job can run', async () => {
    const j = await job({ status: 'failed', attempts: 3, maxAttempts: 3 });

    await request(app).post(`/api/clipper/agent/jobs/${j._id}/retry`)
      .set('Cookie', adminCookie).expect(200);

    expect((await ClipperJob.findById(j._id).lean()).attempts).toBe(0);
  });

  it('refuses anything that has not failed', async () => {
    const j = await job({ status: 'done' });
    await request(app).post(`/api/clipper/agent/jobs/${j._id}/retry`)
      .set('Cookie', adminCookie).expect(400);
  });
});

describe('clearing jobs', () => {
  it('clears failures, which is what keeps a stale error on screen', async () => {
    await job({ status: 'failed' });
    await job({ status: 'failed' });
    await job({ status: 'queued' });

    const res = await request(app).post('/api/clipper/agent/jobs/clear')
      .set('Cookie', adminCookie).send({ status: 'failed' }).expect(200);

    expect(res.body.data.deleted).toBe(2);
    expect(await ClipperJob.countDocuments({})).toBe(1);
  });

  it('clears finished jobs', async () => {
    await job({ status: 'done' });
    await request(app).post('/api/clipper/agent/jobs/clear')
      .set('Cookie', adminCookie).send({ status: 'done' }).expect(200);
    expect(await ClipperJob.countDocuments({})).toBe(0);
  });

  // Queued and claimed are live work. Clearing them in bulk is deleting jobs,
  // which has its own endpoint and its own running-job guard.
  it('refuses to bulk-clear live work', async () => {
    await job({ status: 'queued' });
    await job({ status: 'claimed' });

    for (const status of ['queued', 'claimed', '', 'all']) {
      await request(app).post('/api/clipper/agent/jobs/clear')
        .set('Cookie', adminCookie).send({ status }).expect(400);
    }
    expect(await ClipperJob.countDocuments({})).toBe(2);
  });
});

// The Voice tab's profile picker is filled from agentPresence.voices, which
// two things write to: a /voices job (which STARTS Voicebox and enumerates) and
// the heartbeat (which only reports what the agent happened to already know).
describe('voice profiles surviving heartbeats', () => {
  const voices = () => request(app).get('/api/clipper/voices').set('Cookie', adminCookie).expect(200);

  const reportProfiles = async (list) => {
    const j = await job({ type: 'voices' });
    await request(app)
      .post(`/api/clipper/agent/jobs/${j._id}/result`)
      .set('Authorization', AGENT).send({ ok: true, result: { voices: list } }).expect(200);
  };

  it('fills the picker from a voices job', async () => {
    await reportProfiles([{ id: 'v1', name: 'Bethan' }, { id: 'v2', name: 'News Lady' }]);
    expect((await voices()).body.data.voices).toHaveLength(2);
  });

  // The bug: the agent reports an empty list when Voicebox is not running, and
  // that arrived ten seconds after every refresh and wiped the profiles — so
  // the picker emptied and had to be reloaded again, and again.
  it('does not let an empty heartbeat wipe known profiles', async () => {
    await reportProfiles([{ id: 'v1', name: 'Bethan' }]);
    await beat({ voices: [] });

    expect((await voices()).body.data.voices).toHaveLength(1);
  });

  it('still lets a heartbeat report profiles when it has them', async () => {
    await beat({ voices: [{ id: 'v1', name: 'Bethan' }] });
    expect((await voices()).body.data.voices).toHaveLength(1);
  });

  it('lets a later heartbeat replace the list with a different one', async () => {
    await reportProfiles([{ id: 'v1', name: 'Bethan' }]);
    await beat({ voices: [{ id: 'v2', name: 'News Lady' }, { id: 'v3', name: 'Mr House' }] });

    const list = (await voices()).body.data.voices;
    expect(list.map(v => v.name)).toEqual(['News Lady', 'Mr House']);
  });

  // The complaint this fixed: the picker emptied "on refresh". It was not the
  // refresh - the browser re-polls GET /voices on mount and would have shown
  // whatever the server knew. The list lived on agentPresence, which is
  // in-memory by design because it is a liveness signal, so every backend
  // restart forgot it. Under nodemon that is every save of a backend file.
  //
  // And it could not always recover: the agent only enumerates profiles while
  // Voicebox is running, and the one thing that STARTS Voicebox is the admin
  // pressing Reload voices.
  it('remembers profiles across a backend restart', async () => {
    await reportProfiles([{ id: 'v1', name: 'Bethan' }, { id: 'v2', name: 'News Lady' }]);

    // What a restart actually does to this process: the module-level cache is
    // gone, and no agent has checked in yet.
    clipperRouter._resetAgentPresenceForTests();

    const list = (await voices()).body.data.voices;
    expect(list.map(v => v.name).sort()).toEqual(['Bethan', 'News Lady']);
  });

  it('forgets a profile deleted in the Voicebox app', async () => {
    await reportProfiles([{ id: 'v1', name: 'Bethan' }, { id: 'v2', name: 'News Lady' }]);
    await beat({ voices: [{ id: 'v2', name: 'News Lady' }] });
    clipperRouter._resetAgentPresenceForTests();

    const list = (await voices()).body.data.voices;
    expect(list.map(v => v.id)).toEqual(['v2']);
  });

  // The rule the whole design turns on, now across restarts too.
  it('does not let an empty report erase what was stored', async () => {
    await reportProfiles([{ id: 'v1', name: 'Bethan' }]);
    await beat({ voices: [] });
    clipperRouter._resetAgentPresenceForTests();

    expect((await voices()).body.data.voices).toHaveLength(1);
  });

  it('survives a run of empty heartbeats', async () => {
    await reportProfiles([{ id: 'v1', name: 'Bethan' }]);
    for (let i = 0; i < 5; i++) await beat({ voices: [] });

    expect((await voices()).body.data.voices).toHaveLength(1);
  });

  it('reports none before anything has enumerated them', async () => {
    await beat({ voices: [] });
    expect((await voices()).body.data.voices).toHaveLength(0);
  });
});

describe('access', () => {
  it('keeps every control behind an admin session', async () => {
    const j = await job({ status: 'failed' });
    const calls = [
      ['post', '/api/clipper/agent/stop'],
      ['post', '/api/clipper/agent/restart'],
      ['get',  '/api/clipper/agent/queue'],
      ['delete', `/api/clipper/agent/jobs/${j._id}`],
      ['post', `/api/clipper/agent/jobs/${j._id}/retry`],
      ['post', '/api/clipper/agent/jobs/clear'],
    ];
    for (const [method, url] of calls) {
      await request(app)[method](url).set('Cookie', userCookie).send({}).expect(403);
    }
  });

  it('does not accept the agent token in place of a session', async () => {
    await request(app).post('/api/clipper/agent/restart').set('Authorization', AGENT).send({}).expect(401);
  });
});
