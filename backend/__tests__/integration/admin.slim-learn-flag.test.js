process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createSettings, createAdminUser, createRank, authCookie } = require('../helpers/factories');
const AppSettings = require('../../models/AppSettings');

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

describe('PATCH /api/admin/settings — slimLearnEnabled', () => {
  beforeEach(async () => { await createRank(); await createSettings(); });

  it('persists the Feature Flags save that turns Learn off', async () => {
    const admin = await createAdminUser();
    const res = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', authCookie(admin._id))
      .send({
        useLiveLeaderboard: false, mnemonicsClickEnabled: true, chatEnabled: true,
        featureFlags: { rsvpReader: 'off', briefReel: 'off' },
        slimModeEnabled: true, slimLandingEnabled: true, slimLearnEnabled: false,
        reason: 'turn learn off',
      });
    expect(res.status).toBe(200);
    const pub = await request(app).get('/api/settings');
    expect(pub.body.slimLearnEnabled).toBe(false);
  });

  // The live settings still carried the retired `world3d` flag. The admin page
  // loads the map and sends all of it back, and the PATCH rejects unknown
  // keys — so every Feature Flags save failed and the switch snapped back.
  it('saves even when a retired flag was left in the stored settings', async () => {
    await AppSettings.collection.updateOne({}, { $set: { featureFlags: { rsvpReader: 'admin', briefReel: 'admin', world3d: 'admin' } } });
    const admin = await createAdminUser();

    const loaded = await request(app).get('/api/admin/settings').set('Cookie', authCookie(admin._id));
    const echoed = loaded.body.data.settings.featureFlags;
    expect(echoed).toEqual({ rsvpReader: 'admin', briefReel: 'admin' });

    const res = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', authCookie(admin._id))
      .send({ featureFlags: echoed, slimLearnEnabled: false, reason: 'turn learn off' });
    expect(res.status).toBe(200);
    const pub = await request(app).get('/api/settings');
    expect(pub.body.slimLearnEnabled).toBe(false);
  });
});
