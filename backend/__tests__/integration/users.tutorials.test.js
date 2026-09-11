/**
 * users.tutorials.test.js
 *
 * PATCH /api/users/me/tutorials — the "has this player seen it" flag.
 *
 * The route validates against its own VALID_TUTORIAL_IDS list while the values
 * are written into a fixed sub-schema on the User model. Those are two lists in
 * two files, and the route file carries a comment asking whoever edits one to
 * edit the other. Nothing enforced it, and the failure is quiet in the worst
 * way: the id passes validation, mongoose strict mode drops the unknown path on
 * write, the endpoint answers 200, and the flag reads back as unset forever.
 *
 * Any feature that opens itself once and then remembers not to (CUT's game
 * walkthrough is the first) would simply reopen every visit.
 */

process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const User = require('../../models/User');

let user, cookie;

beforeAll(async () => { await db.connect(); });
beforeEach(async () => {
  await createSettings();
  user   = await createUser({ agentNumber: '1000001' });
  cookie = authCookie(user._id);
});
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => db.closeDatabase());

const patch = (body) => request(app)
  .patch('/api/users/me/tutorials')
  .set('Cookie', cookie)
  .send(body);

describe('PATCH /api/users/me/tutorials', () => {
  it('requires a signed-in user', async () => {
    const res = await request(app)
      .patch('/api/users/me/tutorials')
      .send({ tutorialId: 'cbat_cut', status: 'viewed' });
    expect(res.status).toBe(401);
  });

  it('records a CBAT game walkthrough as seen', async () => {
    const res = await patch({ tutorialId: 'cbat_cut', status: 'viewed' });

    expect(res.status).toBe(200);
    expect(res.body.data.tutorials.cbat_cut).toBe('viewed');

    // Read back from the database, not the response: a path mongoose dropped on
    // write can still be echoed by the document the route happens to be holding.
    const fresh = await User.findById(user._id).lean();
    expect(fresh.tutorials.cbat_cut).toBe('viewed');
  });

  it('tells skipped apart from viewed', async () => {
    await patch({ tutorialId: 'cbat_cut', status: 'skipped' });
    const fresh = await User.findById(user._id).lean();
    expect(fresh.tutorials.cbat_cut).toBe('skipped');
  });

  it('defaults to unseen before anything is recorded', async () => {
    const fresh = await User.findById(user._id).lean();
    expect(fresh.tutorials.cbat_cut).toBe('unseen');
  });

  it('rejects an id it does not know', async () => {
    const res = await patch({ tutorialId: 'not_a_tutorial', status: 'viewed' });
    expect(res.status).toBe(400);
  });

  it('rejects a status outside the enum', async () => {
    const res = await patch({ tutorialId: 'cbat_cut', status: 'halfway' });
    expect(res.status).toBe(400);
  });

  // The guard the route's own comment asks for, in the direction that bites:
  // every id the endpoint accepts must be a real path on the schema. Adding one
  // to the route and forgetting the model fails here rather than in front of a
  // user, where it looks like a feature that simply will not remember anything.
  //
  // Not asserted the other way round. The schema carries the caseFile_* keys,
  // which this endpoint has never accepted, and that is a separate question from
  // the one this test is protecting.
  it('can actually store every id it accepts', async () => {
    const { VALID_TUTORIAL_IDS } = require('../../routes/users');
    expect(VALID_TUTORIAL_IDS.length).toBeGreaterThan(0);
    expect(VALID_TUTORIAL_IDS).toContain('cbat_cut');

    for (const id of VALID_TUTORIAL_IDS) {
      const res = await patch({ tutorialId: id, status: 'viewed' });
      expect([id, res.status]).toEqual([id, 200]);

      const fresh = await User.findById(user._id).lean();
      expect([id, fresh.tutorials?.[id]]).toEqual([id, 'viewed']);
    }
  });
});
