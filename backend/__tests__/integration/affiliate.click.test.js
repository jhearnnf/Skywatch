process.env.JWT_SECRET = 'test_secret';
const request = require('supertest');
const app = require('../../app');
const db = require('../helpers/setupDb');
const AffiliateClickCount = require('../../models/AffiliateClickCount');
const { createAdminUser, createSettings, authCookie } = require('../helpers/factories');

beforeAll(() => db.connect());
afterEach(() => db.clearDatabase());
afterAll(() => db.closeDatabase());

it('stores concurrent repeat clicks and includes every product/store in admin stats', async () => {
  await createSettings();
  const admin = await createAdminUser();
  const empty = await request(app).get('/api/admin/stats').set('Cookie', authCookie(admin));
  expect(empty.body.data.users.amazonAffiliateClicks).toBe(0);
  const clicks = [
    ...Array.from({ length: 8 }, () => ({ item: 'stick', store: 'uk' })),
    { item: 'pedals', store: 'ca' }, { item: 'stick', store: 'ca' },
    { item: 'pedals', store: 'uk' },
  ];
  const responses = await Promise.all(clicks.map(body => request(app).post('/api/affiliate/click').send(body)));
  expect(responses.map(res => res.status)).toEqual(clicks.map(() => 204));
  expect((await AffiliateClickCount.findById('stick:uk')).count).toBe(8);
  expect(await AffiliateClickCount.countDocuments()).toBe(4);
  const stats = await request(app).get('/api/admin/stats').set('Cookie', authCookie(admin));
  expect(stats.status).toBe(200);
  expect(stats.body.data.users.amazonAffiliateClicks).toBe(11);
});

it('rejects malformed click reports without storing counters', async () => {
  for (const body of [{}, { item: 'other', store: 'uk' }, { item: 'stick', store: 'us' }, { item: { $ne: null }, store: 'uk' }]) {
    const res = await request(app).post('/api/affiliate/click').send(body);
    expect(res.status).toBe(400);
  }
  expect(await AffiliateClickCount.countDocuments()).toBe(0);
});
