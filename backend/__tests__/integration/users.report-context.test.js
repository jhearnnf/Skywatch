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

// No model call for a title from inside the suite.
jest.mock('../../utils/reportTitle', () => ({
  ...jest.requireActual('../../utils/reportTitle'),
  scheduleReportTitle: jest.fn(),
  scheduleTicketTitle: jest.fn(),
}));

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

describe('POST /api/users/report-problem — device environment', () => {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

  it('stores what the client read about its device', async () => {
    const user = await createUser();
    await request(app)
      .post('/api/users/report-problem')
      .set('Cookie', authCookie(user._id))
      .set('User-Agent', UA)
      .send({
        description: 'The needles are off the dial',
        environment: {
          uaPlatform: 'Windows', uaPlatformVersion: '15.0.0',
          uaBrands: [{ brand: 'Google Chrome', version: '128.0.6613.84' }],
          screenWidth: 1920, screenHeight: 1080, viewportWidth: 1440, viewportHeight: 760,
          dpr: 1, touchPoints: 0, theme: 'cbat',
          webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
        },
      });

    const saved = await ProblemReport.findOne({ userId: user._id }).lean();
    expect(saved.environment.uaPlatformVersion).toBe('15.0.0');
    expect(saved.environment.uaBrands).toEqual([{ brand: 'Google Chrome', version: '128.0.6613.84' }]);
    expect(saved.environment.screenWidth).toBe(1920);
    expect(saved.environment.webglRenderer).toMatch(/RTX 3060/);
  });

  // The header, not the payload — and it is recorded even when the client
  // sent no environment at all (a bundle from before the collector shipped).
  it('stamps the User-Agent from the request header regardless of the payload', async () => {
    const user = await createUser();
    await request(app)
      .post('/api/users/report-problem')
      .set('Cookie', authCookie(user._id))
      .set('User-Agent', UA)
      .send({ description: 'Nothing loads after the splash' });

    const saved = await ProblemReport.findOne({ userId: user._id }).lean();
    expect(saved.environment.userAgent).toBe(UA);
  });

  it('does not let a junk environment cost us the report', async () => {
    const user = await createUser();
    const res = await report(user, { environment: ['not', 'an', 'object'] });

    expect(res.status).toBe(201);
    expect(await ProblemReport.countDocuments({ userId: user._id })).toBe(1);
  });

  it('keeps nothing it does not recognise', async () => {
    const user = await createUser();
    await report(user, { environment: { cookies: 'all of them', screenWidth: 1280 } });

    const saved = await ProblemReport.findOne({ userId: user._id }).lean();
    expect(saved.environment.cookies).toBeUndefined();
    expect(saved.environment.screenWidth).toBe(1280);
  });
});
