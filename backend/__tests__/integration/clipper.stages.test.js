/**
 * clipper.stages.test.js
 *
 * Stage 2 (footage search + pick) and stage 3 (voice job), plus the rule that
 * an agent result is folded back onto the script it belongs to.
 *
 * Provider HTTP is mocked — these tests must never hit DVIDS, Pexels or Pixabay.
 */

process.env.JWT_SECRET = 'test_secret';
process.env.CLIPPER_AGENT_TOKEN = 'test_agent_token';
process.env.DVIDS_API_KEY = 'test_dvids';
process.env.PEXELS_API_KEY = 'test_pexels';

const request = require('supertest');
const app = require('../../app');
const db  = require('../helpers/setupDb');
const { createAdminUser, authCookie } = require('../helpers/factories');

const ClipperScript = require('../../models/ClipperScript');
const ClipperJob    = require('../../models/ClipperJob');

const AGENT = 'Bearer test_agent_token';
let adminCookie;

beforeAll(async () => { await db.connect(); });
afterEach(async () => { jest.restoreAllMocks(); await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

beforeEach(async () => { adminCookie = authCookie(await createAdminUser()); });

const beat = (id, text, query) => ({
  id, text, factKeys: [],
  visual: { kind: 'stock', query, recipeId: '' },
  sfxCue: '', overlay: '',
});

async function makeScript(beats = [beat('b1', 'Line one.', 'fighter jet')]) {
  return ClipperScript.create({
    title: 'T', mode: 'tips',
    idea: { oneLiner: 'x', hook: 'h', angle: 'a', factKeys: [] },
    script: { beats, wordCount: 10, estDurationSec: 4 },
    outro: { enabled: true, copy: 'More tips at skywatch.academy' },
  });
}

// One fetch mock covering all three providers, keyed off the URL.
function mockProviders() {
  jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
    const u = String(url);
    const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

    if (u.includes('dvidshub.net')) {
      return ok({ results: [{ id: 'video:1', title: 'Typhoon takeoff', thumbnail: 't.jpg', duration: 12 }] });
    }
    if (u.includes('api.pexels.com')) {
      return ok({ videos: [{ id: 99, url: 'p.html', image: 'p.jpg', duration: 8,
        user: { name: 'Someone' },
        video_files: [{ link: 'clip-1080.mp4', width: 1080, height: 1920 }] }] });
    }
    if (u.includes('pixabay.com')) {
      return ok({ hits: [] });
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  });
}

describe('footage search', () => {
  it('merges candidates from the configured providers', async () => {
    mockProviders();
    const doc = await makeScript();

    const res = await request(app)
      .post(`/api/clipper/scripts/${doc._id}/footage/search`)
      .set('Cookie', adminCookie).send({}).expect(200);

    const entry = res.body.data.footage.b1;
    const providers = entry.candidates.map(c => c.provider);
    expect(providers).toEqual(expect.arrayContaining(['dvids', 'pexels']));
    expect(entry.term).toBe('fighter jet');
  });

  it('records a licence and source for every candidate', async () => {
    // These end up in published videos; "may we use this?" must stay answerable.
    mockProviders();
    const doc = await makeScript();
    const res = await request(app)
      .post(`/api/clipper/scripts/${doc._id}/footage/search`)
      .set('Cookie', adminCookie).send({}).expect(200);

    for (const c of res.body.data.footage.b1.candidates) {
      expect(typeof c.licence).toBe('string');
      expect(c.licence.length).toBeGreaterThan(0);
    }
  });

  it('survives a provider being down', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('dvidshub.net')) throw new Error('network down');
      return { ok: true, status: 200, json: async () => ({ videos: [], hits: [] }), text: async () => '{}' };
    });
    const doc = await makeScript();
    await request(app)
      .post(`/api/clipper/scripts/${doc._id}/footage/search`)
      .set('Cookie', adminCookie).send({}).expect(200);
  });

  it('skips capture beats when searching them all', async () => {
    mockProviders();
    const doc = await makeScript([
      beat('b1', 'Stock line.', 'jets'),
      { id: 'b2', text: 'Demo line.', factKeys: [], visual: { kind: 'capture', query: '', recipeId: 'play-dpt' }, sfxCue: '', overlay: '' },
    ]);

    const res = await request(app)
      .post(`/api/clipper/scripts/${doc._id}/footage/search`)
      .set('Cookie', adminCookie).send({}).expect(200);

    expect(res.body.data.footage.b1).toBeDefined();
    expect(res.body.data.footage.b2).toBeUndefined();
  });

  it('stores a chosen clip and can clear it again', async () => {
    const doc = await makeScript();
    const clip = { provider: 'dvids', providerId: 'video:1', licence: 'PD' };

    let res = await request(app)
      .patch(`/api/clipper/scripts/${doc._id}/footage`)
      .set('Cookie', adminCookie).send({ beatId: 'b1', chosen: clip }).expect(200);
    expect(res.body.data.footage.b1.chosen.providerId).toBe('video:1');

    res = await request(app)
      .patch(`/api/clipper/scripts/${doc._id}/footage`)
      .set('Cookie', adminCookie).send({ beatId: 'b1', chosen: null }).expect(200);
    expect(res.body.data.footage.b1.chosen).toBeNull();
  });

  // The trim scrubber sends inMs on its own while you drag it.
  describe('trim', () => {
    const clip = { provider: 'dvids', providerId: 'video:1', licence: 'PD' };
    const patch = (id, body) => request(app)
      .patch(`/api/clipper/scripts/${id}/footage`)
      .set('Cookie', adminCookie).send({ beatId: 'b1', ...body });

    it('saves an in-point without disturbing the chosen clip', async () => {
      const doc = await makeScript();
      await patch(doc._id, { chosen: clip }).expect(200);

      const res = await patch(doc._id, { trim: { inMs: 2400 } }).expect(200);
      expect(res.body.data.footage.b1.trim.inMs).toBe(2400);
      expect(res.body.data.footage.b1.chosen.providerId).toBe('video:1');
    });

    it('merges rather than replacing, so one field does not zero the other', async () => {
      const doc = await makeScript();
      await patch(doc._id, { chosen: clip, trim: { inMs: 1000, outMs: 5000 } }).expect(200);

      const res = await patch(doc._id, { trim: { inMs: 2000 } }).expect(200);
      expect(res.body.data.footage.b1.trim).toEqual({ inMs: 2000, outMs: 5000 });
    });

    it('refuses a negative in-point', async () => {
      const doc = await makeScript();
      const res = await patch(doc._id, { trim: { inMs: -500 } }).expect(200);
      expect(res.body.data.footage.b1.trim.inMs).toBe(0);
    });

    // An offset into a 30s stock clip is meaningless once a 6s recording takes
    // its place, and would seek past the end of it.
    it('drops the trim when a different clip is chosen', async () => {
      const doc = await makeScript();
      await patch(doc._id, { chosen: clip, trim: { inMs: 4000 } }).expect(200);

      const res = await patch(doc._id, {
        chosen: { provider: 'pexels', providerId: '99', licence: 'Pexels' },
      }).expect(200);
      expect(res.body.data.footage.b1.trim).toBeUndefined();
    });

    it('drops the trim when the pick is cleared', async () => {
      const doc = await makeScript();
      await patch(doc._id, { chosen: clip, trim: { inMs: 4000 } }).expect(200);

      const res = await patch(doc._id, { chosen: null }).expect(200);
      expect(res.body.data.footage.b1.trim).toBeUndefined();
    });

    it('keeps the trim when the same clip is re-sent', async () => {
      const doc = await makeScript();
      await patch(doc._id, { chosen: clip, trim: { inMs: 4000 } }).expect(200);

      const res = await patch(doc._id, { chosen: clip }).expect(200);
      expect(res.body.data.footage.b1.trim.inMs).toBe(4000);
    });
  });

  it('marks an approved footage stage stale when the search is rerun', async () => {
    mockProviders();
    const doc = await makeScript();
    doc.stageState.set('footage', 'approved');
    await doc.save();

    await request(app)
      .post(`/api/clipper/scripts/${doc._id}/footage/search`)
      .set('Cookie', adminCookie).send({}).expect(200);

    expect((await ClipperScript.findById(doc._id)).stageState.get('footage')).toBe('stale');
  });
});

describe('voice job', () => {
  it('queues a job containing every beat plus the outro', async () => {
    const doc = await makeScript([beat('b1', 'One.', 'q'), beat('b2', 'Two.', 'q')]);

    const res = await request(app)
      .post(`/api/clipper/scripts/${doc._id}/voice/generate`)
      .set('Cookie', adminCookie)
      .send({ profileId: 'voice-abc', instruct: 'punchy' })
      .expect(202);

    const job = await ClipperJob.findById(res.body.data.job._id).lean();
    expect(job.type).toBe('voice');
    expect(job.payload.profileId).toBe('voice-abc');
    // The outro is narrated too, otherwise the video ends on silence.
    expect(job.payload.beats.map(b => b.id)).toEqual(['b1', 'b2', 'outro']);
  });

  it('refuses without a voice profile', async () => {
    const doc = await makeScript();
    await request(app)
      .post(`/api/clipper/scripts/${doc._id}/voice/generate`)
      .set('Cookie', adminCookie).send({}).expect(400);
    expect(await ClipperJob.countDocuments()).toBe(0);
  });

  it('refuses ElevenLabs when no key is configured', async () => {
    // The UI greys the option out, but a job that could never run must not be
    // queueable — it would sit there looking like a hung render.
    delete process.env.ELEVENLABS_API_KEY;
    const doc = await makeScript();
    const res = await request(app)
      .post(`/api/clipper/scripts/${doc._id}/voice/generate`)
      .set('Cookie', adminCookie)
      .send({ provider: 'elevenlabs', profileId: 'v' })
      .expect(400);
    expect(res.body.message).toMatch(/ELEVENLABS_API_KEY/);
    expect(await ClipperJob.countDocuments()).toBe(0);
  });

  it('allows ElevenLabs once a key is present', async () => {
    process.env.ELEVENLABS_API_KEY = 'test-key';
    try {
      const doc = await makeScript();
      const res = await request(app)
        .post(`/api/clipper/scripts/${doc._id}/voice/generate`)
        .set('Cookie', adminCookie)
        .send({ provider: 'elevenlabs', profileId: 'v' })
        .expect(202);
      const job = await ClipperJob.findById(res.body.data.job._id).lean();
      expect(job.payload.provider).toBe('elevenlabs');
    } finally {
      delete process.env.ELEVENLABS_API_KEY;
    }
  });

  it('defaults to Voicebox when no provider is named', async () => {
    const doc = await makeScript();
    const res = await request(app)
      .post(`/api/clipper/scripts/${doc._id}/voice/generate`)
      .set('Cookie', adminCookie).send({ profileId: 'v' }).expect(202);
    expect((await ClipperJob.findById(res.body.data.job._id).lean()).payload.provider).toBe('voicebox');
  });

  it('reports provider availability so the UI can grey the right option', async () => {
    delete process.env.ELEVENLABS_API_KEY;
    const res = await request(app).get('/api/clipper/voices').set('Cookie', adminCookie).expect(200);
    expect(res.body.data.providers.elevenlabs.available).toBe(false);
    expect(res.body.data.providers.elevenlabs.reason).toMatch(/ELEVENLABS_API_KEY/);
  });

  it('omits the outro when it is switched off', async () => {
    const doc = await makeScript();
    doc.outro = { enabled: false, copy: '' };
    await doc.save();

    const res = await request(app)
      .post(`/api/clipper/scripts/${doc._id}/voice/generate`)
      .set('Cookie', adminCookie).send({ profileId: 'v' }).expect(202);

    const job = await ClipperJob.findById(res.body.data.job._id).lean();
    expect(job.payload.beats.map(b => b.id)).toEqual(['b1']);
  });
});

describe('agent results land on the script', () => {
  it('writes a completed voice result onto script.voice', async () => {
    const doc = await makeScript();
    const job = await ClipperJob.create({ scriptId: doc._id, type: 'voice', payload: {} });

    await request(app)
      .post(`/api/clipper/agent/jobs/${job._id}/result`)
      .set('Authorization', AGENT)
      .send({ ok: true, result: {
        provider: 'voicebox',
        lines: [{ beatId: 'b1', durationMs: 41000, wavPath: 'b1.wav' }],
      } })
      .expect(200);

    const saved = await ClipperScript.findById(doc._id).lean();
    expect(saved.voice.provider).toBe('voicebox');
    expect(saved.voice.lines[0].wavPath).toBe('b1.wav');
    // Summed from the lines rather than taken from the job: after a partial
    // re-record the agent's total only covers the beats it was asked for.
    expect(saved.voice.totalDurationMs).toBe(41000);
  });

  it('marks an approved voice stage stale when it is re-recorded', async () => {
    const doc = await makeScript();
    doc.stageState.set('voice', 'approved');
    await doc.save();
    const job = await ClipperJob.create({ scriptId: doc._id, type: 'voice', payload: {} });

    await request(app)
      .post(`/api/clipper/agent/jobs/${job._id}/result`)
      .set('Authorization', AGENT).send({ ok: true, result: { lines: [] } }).expect(200);

    expect((await ClipperScript.findById(doc._id)).stageState.get('voice')).toBe('stale');
  });

  // Regenerating one line narrates one beat, so the agent returns one line.
  // Assigning that to script.voice would delete every other take.
  describe('regenerating a single line', () => {
    const threeBeats = [
      beat('b1', 'One.', 'q'), beat('b2', 'Two.', 'q'), beat('b3', 'Three.', 'q'),
    ];

    const narrateAll = async (doc) => {
      const job = await ClipperJob.create({ scriptId: doc._id, type: 'voice', payload: {} });
      await request(app)
        .post(`/api/clipper/agent/jobs/${job._id}/result`)
        .set('Authorization', AGENT)
        .send({ ok: true, result: { provider: 'voicebox', profileId: 'p1', lines: [
          { beatId: 'b1', text: 'One.',   durationMs: 1000, wavPath: 'a.wav' },
          { beatId: 'b2', text: 'Two.',   durationMs: 2000, wavPath: 'b.wav' },
          { beatId: 'b3', text: 'Three.', durationMs: 3000, wavPath: 'c.wav' },
        ] } })
        .expect(200);
      return doc;
    };

    const redo = async (doc, line) => {
      const job = await ClipperJob.create({
        scriptId: doc._id, type: 'voice', payload: { beatIds: [line.beatId] },
      });
      await request(app)
        .post(`/api/clipper/agent/jobs/${job._id}/result`)
        .set('Authorization', AGENT)
        .send({ ok: true, result: { lines: [line] } })
        .expect(200);
      return ClipperScript.findById(doc._id).lean();
    };

    it('keeps the takes it did not re-record', async () => {
      const doc = await narrateAll(await makeScript(threeBeats));
      const saved = await redo(doc, { beatId: 'b2', text: 'Two.', durationMs: 2500, wavPath: 'b2.wav' });

      expect(saved.voice.lines.map(l => l.beatId)).toEqual(['b1', 'b2', 'b3']);
      expect(saved.voice.lines[0].wavPath).toBe('a.wav');
      expect(saved.voice.lines[2].wavPath).toBe('c.wav');
    });

    it('replaces the take it did re-record', async () => {
      const doc = await narrateAll(await makeScript(threeBeats));
      const saved = await redo(doc, { beatId: 'b2', text: 'Two.', durationMs: 2500, wavPath: 'b2.wav' });

      expect(saved.voice.lines[1].wavPath).toBe('b2.wav');
      expect(saved.voice.lines[1].durationMs).toBe(2500);
    });

    // startMs is what buildTimeline rebases caption words against, so a take
    // even 500ms longer slides every later caption out of step with the audio.
    it('rebuilds the offsets after a longer take', async () => {
      const doc = await narrateAll(await makeScript(threeBeats));
      const saved = await redo(doc, { beatId: 'b2', text: 'Two.', durationMs: 2500, wavPath: 'b2.wav' });

      expect(saved.voice.lines.map(l => l.startMs)).toEqual([0, 1000, 3500]);
      expect(saved.voice.totalDurationMs).toBe(6500);
    });

    it('rebuilds the offsets after a shorter take', async () => {
      const doc = await narrateAll(await makeScript(threeBeats));
      const saved = await redo(doc, { beatId: 'b1', text: 'One.', durationMs: 400, wavPath: 'b1.wav' });

      expect(saved.voice.lines.map(l => l.startMs)).toEqual([0, 400, 2400]);
      expect(saved.voice.totalDurationMs).toBe(5400);
    });

    it('keeps lines in script order however they arrive', async () => {
      const doc = await narrateAll(await makeScript(threeBeats));
      const saved = await redo(doc, { beatId: 'b1', text: 'One.', durationMs: 900, wavPath: 'z.wav' });
      expect(saved.voice.lines.map(l => l.beatId)).toEqual(['b1', 'b2', 'b3']);
    });

    // Caption timings were measured against the old take.
    it('marks an approved captions stage stale', async () => {
      const doc = await narrateAll(await makeScript(threeBeats));
      doc.stageState.set('captions', 'approved');
      await doc.save();

      await redo(doc, { beatId: 'b2', text: 'Two.', durationMs: 2500, wavPath: 'b2.wav' });
      expect((await ClipperScript.findById(doc._id)).stageState.get('captions')).toBe('stale');
    });
  });

  it('appends renders rather than replacing them', async () => {
    // Render history is worth keeping — you want to compare takes.
    const doc = await makeScript();
    for (const url of ['first.mp4', 'second.mp4']) {
      const job = await ClipperJob.create({ scriptId: doc._id, type: 'render', payload: {} });
      await request(app)
        .post(`/api/clipper/agent/jobs/${job._id}/result`)
        .set('Authorization', AGENT).send({ ok: true, result: { url } }).expect(200);
    }
    const saved = await ClipperScript.findById(doc._id).lean();
    expect(saved.renders).toHaveLength(2);
    expect(saved.renders[0].url).toBe('second.mp4');   // newest first
  });

  it('does not touch the script when a job fails', async () => {
    const doc = await makeScript();
    const job = await ClipperJob.create({ scriptId: doc._id, type: 'voice', attempts: 3, maxAttempts: 3 });

    await request(app)
      .post(`/api/clipper/agent/jobs/${job._id}/result`)
      .set('Authorization', AGENT).send({ ok: false, error: 'voicebox missing' }).expect(200);

    expect((await ClipperScript.findById(doc._id).lean()).voice).toBeNull();
  });
});
