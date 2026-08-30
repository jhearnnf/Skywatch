/**
 * clipper.captureLibrary.test.js
 *
 * Reusing a screen recording instead of making it again.
 *
 * A recording of a game is not specific to the beat that asked for it: twenty
 * seconds of FLAG being played is twenty seconds of FLAG being played, whatever
 * line is spoken over it. Before this, every new script re-recorded the same
 * game - a minute of browser automation, and only possible with the agent up.
 *
 * The library is its own collection because neither existing home survives:
 * finished jobs can be cleared from the agent panel, and a script's footage is
 * pruned when its beats are rewritten.
 */

process.env.JWT_SECRET = 'test_secret';
process.env.CLIPPER_AGENT_TOKEN = 'test_agent_token';

const fs = require('fs');
const os = require('os');
const path = require('path');

const request = require('supertest');
const app = require('../../app');
const db  = require('../helpers/setupDb');
const { createAdminUser, authCookie } = require('../helpers/factories');

const ClipperScript  = require('../../models/ClipperScript');
const ClipperJob     = require('../../models/ClipperJob');
const ClipperCapture = require('../../models/ClipperCapture');

const AGENT = 'Bearer test_agent_token';
let adminCookie;
let realFile;

beforeAll(async () => {
  await db.connect();
  // A real file on disk, because the routes check that a recording still
  // exists - the agent keeps them in a temp folder the OS clears.
  realFile = path.join(os.tmpdir(), `clipper-library-test-${process.pid}.mp4`);
  fs.writeFileSync(realFile, 'not really an mp4');
});

afterEach(async () => { await db.clearDatabase(); });

afterAll(async () => {
  fs.rmSync(realFile, { force: true });
  await db.closeDatabase();
});

beforeEach(async () => { adminCookie = authCookie(await createAdminUser()); });

const captureBeat = (id, recipeId = 'play-flag') => ({
  id, text: `${id}.`, factKeys: [],
  visual: { kind: 'capture', query: '', recipeId },
  sfxCue: '', overlay: '',
});

async function makeScript(beats = [captureBeat('b1')]) {
  return ClipperScript.create({
    title: 'T', mode: 'tips',
    idea: { oneLiner: 'x', hook: 'h', angle: 'a', factKeys: [] },
    script: { beats, wordCount: 10, estDurationSec: 4 },
    outro: { enabled: false, copy: '' },
  });
}

const libraryRow = (over = {}) => ClipperCapture.create({
  recipeId: 'play-flag',
  label: 'Play FLAG',
  localPath: realFile,
  playbackUrl: `file:///${realFile.replace(/\\/g, '/')}`,
  durationSec: 24.5,
  inputLog: [{ atMs: 1000, x: 0.5, y: 0.8, kind: 'press' }],
  ...over,
});

describe('cataloguing a finished recording', () => {
  it('files a completed capture into the library', async () => {
    const script = await makeScript();
    const job = await ClipperJob.create({
      scriptId: script._id, type: 'capture',
      payload: { beatId: 'b1', recipeId: 'play-flag' }, status: 'claimed',
    });

    await request(app)
      .post(`/api/clipper/agent/jobs/${job._id}/result`)
      .set('Authorization', AGENT)
      .send({ ok: true, result: {
        recipeId: 'play-flag', label: 'Play FLAG', localPath: realFile,
        frames: 750, fps: 30, bytes: 12, width: 1080, height: 1920,
        inputLog: [{ atMs: 900, x: 0.4, y: 0.7, kind: 'type' }],
      } })
      .expect(200);

    const rows = await ClipperCapture.find({}).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].recipeId).toBe('play-flag');
    expect(rows[0].inputLog).toHaveLength(1);

    // And it still lands on the beat that asked for it.
    const saved = await ClipperScript.findById(script._id).lean();
    expect(saved.footage.b1.chosen.provider).toBe('capture');
    expect(saved.footage.b1.chosen.recipeId).toBe('play-flag');
  });

  it('keeps the recording even when the library write fails', async () => {
    jest.spyOn(ClipperCapture, 'create').mockRejectedValue(new Error('disk full'));

    const script = await makeScript();
    const job = await ClipperJob.create({
      scriptId: script._id, type: 'capture',
      payload: { beatId: 'b1', recipeId: 'play-flag' }, status: 'claimed',
    });

    await request(app)
      .post(`/api/clipper/agent/jobs/${job._id}/result`)
      .set('Authorization', AGENT)
      .send({ ok: true, result: { recipeId: 'play-flag', localPath: realFile, frames: 300, fps: 30 } })
      .expect(200);

    const saved = await ClipperScript.findById(script._id).lean();
    expect(saved.footage.b1.chosen.localPath).toBe(realFile);

    ClipperCapture.create.mockRestore();
  });
});

describe('GET /captures', () => {
  it('lists only the recipe asked for, newest first', async () => {
    await libraryRow({ label: 'older' });
    await new Promise(r => setTimeout(r, 10));
    await libraryRow({ label: 'newer' });
    await libraryRow({ recipeId: 'play-dpt', label: 'other game' });

    const res = await request(app)
      .get('/api/clipper/captures?recipeId=play-flag')
      .set('Cookie', adminCookie).expect(200);

    expect(res.body.data.captures.map(c => c.label)).toEqual(['newer', 'older']);
  });

  // The files live in the agent's %TEMP%, which Windows clears. Offering a dead
  // clip would set it as the beat's footage and fail much later, in the render,
  // as an asset that will not download.
  it('marks a recording whose file has gone', async () => {
    await libraryRow({ localPath: path.join(os.tmpdir(), 'definitely-not-here.mp4') });

    const res = await request(app)
      .get('/api/clipper/captures?recipeId=play-flag')
      .set('Cookie', adminCookie).expect(200);

    expect(res.body.data.captures[0].missing).toBe(true);
  });

  it('says whether a take predates the input log', async () => {
    await libraryRow({ inputLog: [] });

    const res = await request(app)
      .get('/api/clipper/captures?recipeId=play-flag')
      .set('Cookie', adminCookie).expect(200);

    expect(res.body.data.captures[0].hasInputLog).toBe(false);
  });

  it('is admin only', async () => {
    await request(app).get('/api/clipper/captures?recipeId=play-flag').expect(401);
  });
});

describe('POST /footage/reuse', () => {
  it('points a beat at a recording we already have', async () => {
    const script = await makeScript();
    const row = await libraryRow();

    const res = await request(app)
      .post(`/api/clipper/scripts/${script._id}/footage/reuse`)
      .set('Cookie', adminCookie)
      .send({ beatId: 'b1', captureId: String(row._id) })
      .expect(200);

    const entry = res.body.data.footage.b1;
    expect(entry.chosen.provider).toBe('capture');
    expect(entry.chosen.durationSec).toBe(24.5);
    // The input log travels with the recording, so the reused clip keeps the
    // punch-in derived from where the hand actually went.
    expect(entry.inputLog).toHaveLength(1);
    // A different clip is a different length, so an inherited trim would seek
    // into the wrong part of it - or past its end.
    expect(entry.trim.inMs).toBe(0);
  });

  it('counts the reuse', async () => {
    const script = await makeScript();
    const row = await libraryRow();

    await request(app)
      .post(`/api/clipper/scripts/${script._id}/footage/reuse`)
      .set('Cookie', adminCookie)
      .send({ beatId: 'b1', captureId: String(row._id) })
      .expect(200);

    const after = await ClipperCapture.findById(row._id).lean();
    expect(after.useCount).toBe(1);
    expect(after.lastUsedAt).toBeTruthy();
  });

  // Filming a different game while the voice talks about this one is worse than
  // stock footage, because it looks deliberate.
  it('refuses a recording of a different game', async () => {
    const script = await makeScript();
    const row = await libraryRow({ recipeId: 'play-dpt' });

    const res = await request(app)
      .post(`/api/clipper/scripts/${script._id}/footage/reuse`)
      .set('Cookie', adminCookie)
      .send({ beatId: 'b1', captureId: String(row._id) })
      .expect(400);

    expect(res.body.message).toMatch(/play-dpt/);
  });

  it('refuses a recording whose file has gone', async () => {
    const script = await makeScript();
    const row = await libraryRow({ localPath: path.join(os.tmpdir(), 'gone.mp4') });

    await request(app)
      .post(`/api/clipper/scripts/${script._id}/footage/reuse`)
      .set('Cookie', adminCookie)
      .send({ beatId: 'b1', captureId: String(row._id) })
      .expect(409);
  });

  it('refuses a stock beat', async () => {
    const script = await makeScript([
      { id: 'b1', text: 'One.', factKeys: [], visual: { kind: 'stock', query: 'jets', recipeId: '' } },
    ]);
    const row = await libraryRow();

    await request(app)
      .post(`/api/clipper/scripts/${script._id}/footage/reuse`)
      .set('Cookie', adminCookie)
      .send({ beatId: 'b1', captureId: String(row._id) })
      .expect(400);
  });

  it('marks an approved footage stage stale again', async () => {
    const script = await makeScript();
    script.stageState.set('footage', 'approved');
    await script.save();
    const row = await libraryRow();

    await request(app)
      .post(`/api/clipper/scripts/${script._id}/footage/reuse`)
      .set('Cookie', adminCookie)
      .send({ beatId: 'b1', captureId: String(row._id) })
      .expect(200);

    const saved = await ClipperScript.findById(script._id).lean();
    expect(saved.stageState.footage).toBe('stale');
  });
});

describe('DELETE /captures/:id', () => {
  it('forgets a bad take so it stops being offered', async () => {
    const row = await libraryRow();

    await request(app)
      .delete(`/api/clipper/captures/${row._id}`)
      .set('Cookie', adminCookie).expect(200);

    expect(await ClipperCapture.countDocuments()).toBe(0);
  });

  it('404s on one that is already gone', async () => {
    const row = await libraryRow();
    await ClipperCapture.deleteOne({ _id: row._id });

    await request(app)
      .delete(`/api/clipper/captures/${row._id}`)
      .set('Cookie', adminCookie).expect(404);
  });
});
