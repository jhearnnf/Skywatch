/**
 * clipper.routes.test.js
 *
 * Covers the Clipper backend: admin-only access, guide ingest and re-ingest,
 * the anti-repetition ledger, and the guardrail gate on script approval.
 *
 * services/clipperAi is mocked so tests never call OpenRouter.
 */

process.env.JWT_SECRET = 'test_secret';

jest.mock('../../services/clipperAi', () => {
  const real = jest.requireActual('../../services/clipperAi');
  return {
    ...real,
    generateIdeas:  jest.fn(),
    generateScript: jest.fn(),
  };
});

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createAdminUser, createUser, authCookie } = require('../helpers/factories');

const ClipperFact   = require('../../models/ClipperFact');
const ClipperSource = require('../../models/ClipperSource');
const ClipperScript = require('../../models/ClipperScript');
const clipperAi     = require('../../services/clipperAi');

// Minimal guide source: one green fact, one amber, one red, plus a person to
// harvest into the name blocklist.
const GUIDE = `
<script>
const ANALYSTS = ['blitz1031'];
const TESTS = [
 { id:'flag', name:'Figures, Logistics and Groups', abbr:'FLAG', facts:[
   {c:'green',tag:'Real test',t:'Only circled aircraft matter.',why:'Confirmed.',refs:[]},
   {c:'amber',tag:'Prep',t:'Arithmetic drills help.',why:'One source.',refs:[]},
   {c:'red',tag:'Rumour',t:'Unverified scoring claim.',why:'Nobody confirmed.',refs:[]}
 ]}
];
</script>`;

let adminCookie;
let userCookie;

beforeAll(async () => { await db.connect(); });
afterEach(async () => { jest.clearAllMocks(); await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

beforeEach(async () => {
  const admin = await createAdminUser();
  const user  = await createUser();
  adminCookie = authCookie(admin);
  userCookie  = authCookie(user);
});

const ingest = () => request(app)
  .post('/api/clipper/facts/ingest')
  .set('Cookie', adminCookie)
  .send({ source: GUIDE });

describe('access control', () => {
  it('rejects an anonymous request', async () => {
    await request(app).get('/api/clipper/facts').expect(401);
  });

  it('rejects a signed-in non-admin', async () => {
    await request(app).get('/api/clipper/facts').set('Cookie', userCookie).expect(403);
  });

  it('allows an admin', async () => {
    await request(app).get('/api/clipper/facts').set('Cookie', adminCookie).expect(200);
  });
});

describe('ingest', () => {
  it('extracts graded facts and the name blocklist', async () => {
    const res = await ingest().expect(200);
    expect(res.body.data.counts).toEqual({ total: 3, green: 1, amber: 1, red: 1 });

    const source = await ClipperSource.findOne({ slug: 'cbat-guide' }).lean();
    expect(source.nameBlocklist).toContain('blitz1031');

    const facts = await ClipperFact.find({}).lean();
    expect(facts).toHaveLength(3);
  });

  it('400s when no source is supplied and no server file exists', async () => {
    // The guide is not deployed to Railway, so an empty body must fail loudly
    // rather than silently ingesting nothing.
    const parser = require('../../utils/clipperFactParser');
    const fs = require('fs');
    jest.spyOn(fs, 'existsSync').mockImplementation(p =>
      p === parser.DEFAULT_GUIDE_PATH ? false : jest.requireActual('fs').existsSync(p));

    const res = await request(app)
      .post('/api/clipper/facts/ingest')
      .set('Cookie', adminCookie)
      .send({})
      .expect(400);
    expect(res.body.message).toMatch(/upload the guide/i);
  });

  it('preserves ledger history across a re-ingest', async () => {
    await ingest().expect(200);
    await ClipperFact.updateOne(
      { factKey: 'test:flag:0' },
      { $set: { useCount: 3, anglesUsed: [{ hook: 'h', angle: 'a' }] } },
    );

    await ingest().expect(200);

    const fact = await ClipperFact.findOne({ factKey: 'test:flag:0' }).lean();
    expect(fact.useCount).toBe(3);
    expect(fact.anglesUsed).toHaveLength(1);
  });

  it('updates fact text when the guide changes', async () => {
    await ingest().expect(200);
    await request(app)
      .post('/api/clipper/facts/ingest')
      .set('Cookie', adminCookie)
      .send({ source: GUIDE.replace('Only circled aircraft matter.', 'Rewritten.') })
      .expect(200);

    const fact = await ClipperFact.findOne({ factKey: 'test:flag:0' }).lean();
    expect(fact.text).toBe('Rewritten.');
  });
});

describe('idea generation', () => {
  it('never offers red-grade facts to the model', async () => {
    await ingest().expect(200);
    clipperAi.generateIdeas.mockResolvedValue([]);

    await request(app)
      .post('/api/clipper/ideas/generate')
      .set('Cookie', adminCookie)
      .send({ count: 3 })
      .expect(200);

    const { facts } = clipperAi.generateIdeas.mock.calls[0][0];
    expect(facts.map(f => f.grade)).not.toContain('red');
    expect(facts).toHaveLength(2);
  });

  it('excludes retired facts', async () => {
    await ingest().expect(200);
    await request(app)
      .patch('/api/clipper/facts/test:flag:0')
      .set('Cookie', adminCookie)
      .send({ retired: true })
      .expect(200);

    clipperAi.generateIdeas.mockResolvedValue([]);
    await request(app)
      .post('/api/clipper/ideas/generate')
      .set('Cookie', adminCookie)
      .send({}).expect(200);

    const { facts } = clipperAi.generateIdeas.mock.calls[0][0];
    expect(facts.map(f => f.factKey)).not.toContain('test:flag:0');
  });

  it('400s before any AI call when nothing has been ingested', async () => {
    await request(app)
      .post('/api/clipper/ideas/generate')
      .set('Cookie', adminCookie)
      .send({}).expect(400);
    expect(clipperAi.generateIdeas).not.toHaveBeenCalled();
  });

  it('passes prior one-liners through for deduping', async () => {
    await ingest().expect(200);
    await ClipperScript.create({ idea: { oneLiner: 'An existing premise', factKeys: [] } });
    clipperAi.generateIdeas.mockResolvedValue([]);

    await request(app)
      .post('/api/clipper/ideas/generate')
      .set('Cookie', adminCookie).send({}).expect(200);

    const { priorOneLiners } = clipperAi.generateIdeas.mock.calls[0][0];
    expect(priorOneLiners).toContain('An existing premise');
  });
});

describe('script generation and approval', () => {
  async function makeScript(factKeys = ['test:flag:0']) {
    await ingest().expect(200);
    const res = await request(app)
      .post('/api/clipper/scripts')
      .set('Cookie', adminCookie)
      .send({ idea: { oneLiner: 'A premise', hook: 'A hook', angle: 'An angle', factKeys } })
      .expect(201);
    return res.body.data.script._id;
  }

  function mockScript(beats, outro = '') {
    clipperAi.generateScript.mockResolvedValue({
      title: 'T', beats, wordCount: 20, estDurationSec: 8, outro,
    });
  }

  const beat = (text, factKeys = ['test:flag:0']) => ({
    id: 'b1', text, factKeys,
    visual: { kind: 'stock', query: 'jets', recipeId: '' },
    sfxCue: '', overlay: '',
  });

  it('stores a generated script and marks it valid', async () => {
    const id = await makeScript();
    mockScript([beat('Only circled aircraft matter.')]);

    const res = await request(app)
      .post(`/api/clipper/scripts/${id}/script/generate`)
      .set('Cookie', adminCookie).expect(200);

    expect(res.body.data.validation.ok).toBe(true);
    expect(res.body.data.script.script.beats).toHaveLength(1);
  });

  it('flags an unhedged amber fact', async () => {
    const id = await makeScript(['test:flag:1']);
    mockScript([beat('Arithmetic drills definitely help.', ['test:flag:1'])]);

    const res = await request(app)
      .post(`/api/clipper/scripts/${id}/script/generate`)
      .set('Cookie', adminCookie).expect(200);

    expect(res.body.data.validation.ok).toBe(false);
    expect(res.body.data.validation.findings.map(f => f.rule)).toContain('unhedged-amber');
  });

  it('flags a real name from the ingested blocklist', async () => {
    const id = await makeScript();
    mockScript([beat('As blitz1031 put it, only circled aircraft matter.')]);

    const res = await request(app)
      .post(`/api/clipper/scripts/${id}/script/generate`)
      .set('Cookie', adminCookie).expect(200);

    expect(res.body.data.validation.findings.map(f => f.rule)).toContain('real-name');
  });

  it('refuses to approve a script with guardrail errors', async () => {
    const id = await makeScript(['test:flag:1']);
    mockScript([beat('Arithmetic drills definitely help.', ['test:flag:1'])]);
    await request(app).post(`/api/clipper/scripts/${id}/script/generate`).set('Cookie', adminCookie);

    await request(app)
      .post(`/api/clipper/scripts/${id}/stages/script/approve`)
      .set('Cookie', adminCookie)
      .expect(422);

    const fact = await ClipperFact.findOne({ factKey: 'test:flag:1' }).lean();
    expect(fact.useCount).toBe(0);
  });

  it('credits the ledger on approval', async () => {
    const id = await makeScript();
    mockScript([beat('Only circled aircraft matter.')]);
    await request(app).post(`/api/clipper/scripts/${id}/script/generate`).set('Cookie', adminCookie);

    await request(app)
      .post(`/api/clipper/scripts/${id}/stages/script/approve`)
      .set('Cookie', adminCookie).expect(200);

    const fact = await ClipperFact.findOne({ factKey: 'test:flag:0' }).lean();
    expect(fact.useCount).toBe(1);
    expect(fact.anglesUsed[0].hook).toBe('A hook');
    expect(fact.lastUsedAt).toBeTruthy();
  });

  it('does not double-credit the ledger when approved twice', async () => {
    const id = await makeScript();
    mockScript([beat('Only circled aircraft matter.')]);
    await request(app).post(`/api/clipper/scripts/${id}/script/generate`).set('Cookie', adminCookie);

    const approve = () => request(app)
      .post(`/api/clipper/scripts/${id}/stages/script/approve`)
      .set('Cookie', adminCookie).expect(200);
    await approve();
    await approve();

    const fact = await ClipperFact.findOne({ factKey: 'test:flag:0' }).lean();
    expect(fact.useCount).toBe(1);
  });

  it('marks downstream stages stale when the script is regenerated', async () => {
    const id = await makeScript();
    mockScript([beat('Only circled aircraft matter.')]);
    await request(app).post(`/api/clipper/scripts/${id}/script/generate`).set('Cookie', adminCookie);

    await ClipperScript.updateOne({ _id: id }, { $set: { 'stageState.footage': 'approved' } });
    await request(app).post(`/api/clipper/scripts/${id}/script/generate`).set('Cookie', adminCookie);

    const doc = await ClipperScript.findById(id).lean();
    expect(doc.stageState.footage).toBe('stale');
  });

  it('revalidates a hand-edited script', async () => {
    const id = await makeScript();
    mockScript([beat('Only circled aircraft matter.')]);
    await request(app).post(`/api/clipper/scripts/${id}/script/generate`).set('Cookie', adminCookie);

    const res = await request(app)
      .patch(`/api/clipper/scripts/${id}`)
      .set('Cookie', adminCookie)
      .send({ beats: [beat('This is the real CBAT, free on our site.')] })
      .expect(200);

    expect(res.body.data.validation.ok).toBe(false);
    expect(res.body.data.validation.findings.map(f => f.rule)).toContain('real-cbat-claim');
  });
});
