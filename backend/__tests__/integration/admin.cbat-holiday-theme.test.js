/**
 * admin.cbat-holiday-theme.test.js
 *
 * cbatHolidayTheme picks the seasonal decoration on the CBAT hub (/cbat).
 * 'none' by default, exposed on the public settings so every visitor's hub can
 * read it, and only the four known keys may be saved.
 */

process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const {
  createSettings,
  createAdminUser,
  createUser,
  createRank,
  authCookie,
} = require('../helpers/factories');

const AppSettings = require('../../models/AppSettings');

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

describe('cbatHolidayTheme — default', () => {
  it("defaults to 'none'", async () => {
    const s = await AppSettings.getSettings();
    expect(s.cbatHolidayTheme).toBe('none');
  });

  it('is exposed on the public GET /api/settings response', async () => {
    await createSettings();
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.cbatHolidayTheme).toBe('none');
  });
});

describe('PATCH /api/admin/settings — cbatHolidayTheme', () => {
  beforeEach(async () => {
    await createRank();
    await createSettings();
  });

  it('rejects non-admin users with 403', async () => {
    const user = await createUser();
    const res  = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', authCookie(user._id))
      .send({ cbatHolidayTheme: 'christmas', reason: 'try' });
    expect(res.status).toBe(403);
    expect((await AppSettings.findOne()).cbatHolidayTheme).toBe('none');
  });

  it.each(['christmas', 'easter', 'halloween', 'none'])('persists %s for an admin', async (theme) => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', authCookie(admin._id))
      .send({ cbatHolidayTheme: theme, reason: 'seasonal theme' });
    expect(res.status).toBe(200);
    expect((await AppSettings.findOne()).cbatHolidayTheme).toBe(theme);
  });

  it.each(['diwali', '', 42, null])('rejects %p with 400', async (theme) => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', authCookie(admin._id))
      .send({ cbatHolidayTheme: theme, reason: 'bad theme' });
    expect(res.status).toBe(400);
    expect((await AppSettings.findOne()).cbatHolidayTheme).toBe('none');
  });
});
