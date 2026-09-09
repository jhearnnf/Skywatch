/**
 * POST /api/users/report-problem — the context stored with a report.
 *
 * A report used to keep whatever the client put in `pageReported`, which was
 * document.referrer: empty on every app launch, so every report filed from the
 * Android app recorded "unknown" and nothing else. The form now sends the pages
 * the person was actually on plus the build they were running, and this covers
 * what the route does with them — including that neither can be used to store a
 * record id or an arbitrary string.
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const ProblemReport = require('../../models/ProblemReport');

async function report(user, body) {
  return request(app)
    .post('/api/users/report-problem')
    .set('Cookie', authCookie(user._id))
    .send({ description: 'The dot never stops drifting', ...body });
}

beforeAll(async () => { await db.connect(); });
beforeEach(async () => createSettings());
afterEach(async ()  => db.clearDatabase());
afterAll(async ()   => db.closeDatabase());

describe('POST /api/users/report-problem — page context', () => {
  it('stores the reported page as its label, not its path', async () => {
    const user = await createUser();
    const res  = await report(user, { pageReported: '/cbat/sma' });

    expect(res.status).toBe(201);
    const saved = await ProblemReport.findOne({ userId: user._id });
    expect(saved.pageReported).toBe('CBAT · Sensory Motor');
  });

  it('stores the route trail as labels, oldest first', async () => {
    const user = await createUser();
    await report(user, { routeTrail: ['/cbat', '/cbat/sma', '/profile'] });

    const saved = await ProblemReport.findOne({ userId: user._id });
    expect(saved.routeTrail).toEqual(['CBAT menu', 'CBAT · Sensory Motor', 'Profile']);
  });

  // The paths carry record ids; the labels are what the presence strip already
  // decided is safe to keep, and the report queue is no different.
  it('keeps the brief label rather than the brief id in the trail', async () => {
    const user = await createUser();
    await report(user, { routeTrail: ['/brief/68b0d1f2c3a4b5d6e7f80912'] });

    const saved = await ProblemReport.findOne({ userId: user._id });
    expect(saved.routeTrail).toEqual(['Reading a brief']);
  });

  it('drops paths it does not recognise instead of storing them raw', async () => {
    const user = await createUser();
    await report(user, {
      pageReported: '/not-a-real-route',
      routeTrail: ['/cbat', '/not-a-real-route', 'javascript:alert(1)'],
    });

    const saved = await ProblemReport.findOne({ userId: user._id });
    expect(saved.pageReported).toBe('unknown');
    expect(saved.routeTrail).toEqual(['CBAT menu']);
  });

  it('caps how many pages of trail a caller can store', async () => {
    const user = await createUser();
    await report(user, { routeTrail: Array(50).fill('/cbat') });

    const saved = await ProblemReport.findOne({ userId: user._id });
    expect(saved.routeTrail.length).toBeLessThanOrEqual(5);
  });

  it('ignores a trail that is not an array', async () => {
    const user = await createUser();
    const res  = await report(user, { routeTrail: 'the whole internet' });

    expect(res.status).toBe(201);
    const saved = await ProblemReport.findOne({ userId: user._id });
    expect(saved.routeTrail).toEqual([]);
  });

  // Bundles built before the trail existed still send document.referrer here.
  it('records unknown for an old client sending a referrer URL', async () => {
    const user = await createUser();
    await report(user, { pageReported: 'https://www.google.com/' });

    const saved = await ProblemReport.findOne({ userId: user._id });
    expect(saved.pageReported).toBe('unknown');
  });
});

describe('POST /api/users/report-problem — client build', () => {
  it('stores the platform, version and build the client reported', async () => {
    const user = await createUser();
    await report(user, { client: { platform: 'android', version: '1.2.34', build: '39' } });

    const saved = await ProblemReport.findOne({ userId: user._id });
    expect(saved.clientPlatform).toBe('android');
    expect(saved.clientVersion).toBe('1.2.34');
    expect(saved.clientBuild).toBe('39');
  });

  it('accepts a report from a client that cannot name its build', async () => {
    const user = await createUser();
    const res  = await report(user, {});

    expect(res.status).toBe(201);
    const saved = await ProblemReport.findOne({ userId: user._id });
    expect(saved.clientPlatform).toBeNull();
  });

  // Same rule as the heartbeat: these strings end up rendered in the admin
  // panel, so an unrecognised platform is discarded rather than stored.
  it('discards a client payload naming a platform that does not exist', async () => {
    const user = await createUser();
    const res  = await report(user, { client: { platform: 'toaster', version: '9.9.9' } });

    expect(res.status).toBe(201);
    const saved = await ProblemReport.findOne({ userId: user._id });
    expect(saved.clientPlatform).toBeNull();
    expect(saved.clientVersion).toBeNull();
  });

  it('does not let a junk client payload cost us the report', async () => {
    const user = await createUser();
    const res  = await report(user, { client: 'android maybe' });

    expect(res.status).toBe(201);
    expect(await ProblemReport.countDocuments({ userId: user._id })).toBe(1);
  });
});
