process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');

const app = require('../../app');
const db  = require('../helpers/setupDb');
const { createUser, createAdminUser, createSettings, authCookie } = require('../helpers/factories');

const ChatGuide = require('../../models/ChatGuide');

beforeAll(async () => {
  await db.connect();
  await createSettings();
});
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

const LIVE = {
  title: 'CBAT Community Guide', url: '/cbat-guide',
  description: 'What candidates reported', emoji: '📖', order: 0,
};
const DRAFT = {
  title: 'Canadian Aircrew Selection', url: '/cbat-guide-canada',
  description: 'CFAST at Trenton', emoji: '🇨🇦', order: 10, adminOnly: true,
};

const overviewGuides = async (userId) => {
  const res = await request(app).get('/api/chat/overview').set('Cookie', authCookie(userId));
  expect(res.status).toBe(200);
  return res.body.data.guides;
};

describe('admin-only guides — who can see them', () => {
  it('keeps a staged guide out of an ordinary member’s rail entirely', async () => {
    await ChatGuide.create([LIVE, DRAFT]);
    const user = await createUser({ email: 'member@test.com' });

    const guides = await overviewGuides(user._id);

    expect(guides.map(g => g.title)).toEqual(['CBAT Community Guide']);
    // Not merely unrendered: the draft's title, URL and description must never
    // reach the browser, because the document it points at is a public static
    // file and the URL is the only thing keeping it unfound.
    expect(JSON.stringify(guides)).not.toContain('cbat-guide-canada');
    expect(JSON.stringify(guides)).not.toContain('Canadian');
  });

  it('shows it to an admin, flagged so they know it is not public', async () => {
    await ChatGuide.create([LIVE, DRAFT]);
    const admin = await createAdminUser({ email: 'admin@test.com' });

    const guides = await overviewGuides(admin._id);

    expect(guides).toHaveLength(2);
    const draft = guides.find(g => g.url === '/cbat-guide-canada');
    expect(draft.adminOnly).toBe(true);
    expect(guides.find(g => g.url === '/cbat-guide').adminOnly).toBe(false);
  });

  it('still hides a hidden guide from admins, because that flag means something else', async () => {
    // isHidden takes a link out of the rail for everyone. adminOnly stages it.
    // Collapsing the two would make a retired link reappear for admins.
    await ChatGuide.create({ ...DRAFT, isHidden: true });
    const admin = await createAdminUser({ email: 'admin@test.com' });

    expect(await overviewGuides(admin._id)).toHaveLength(0);
  });

  it('defaults to public, so an existing guide is unaffected by the new field', async () => {
    await ChatGuide.create(LIVE);
    const user = await createUser({ email: 'member@test.com' });

    const guides = await overviewGuides(user._id);
    expect(guides).toHaveLength(1);
    expect(guides[0].adminOnly).toBe(false);
  });
});

describe('admin-only guides — managing them', () => {
  it('creates a guide as admin only when asked, and lists it back', async () => {
    const admin = await createAdminUser({ email: 'admin@test.com' });

    const created = await request(app)
      .post('/api/chat/admin/guides')
      .set('Cookie', authCookie(admin._id))
      .send({ ...DRAFT });
    expect(created.status).toBe(200);
    expect(created.body.data.guide.adminOnly).toBe(true);

    const listed = await request(app)
      .get('/api/chat/admin/guides')
      .set('Cookie', authCookie(admin._id));
    expect(listed.body.data.guides[0].adminOnly).toBe(true);
  });

  it('publishes a staged guide, which puts it in everyone’s rail', async () => {
    const guide = await ChatGuide.create(DRAFT);
    const admin = await createAdminUser({ email: 'admin@test.com' });
    const user  = await createUser({ email: 'member@test.com' });

    expect(await overviewGuides(user._id)).toHaveLength(0);

    const res = await request(app)
      .patch(`/api/chat/admin/guides/${guide._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ adminOnly: false });
    expect(res.status).toBe(200);
    expect(res.body.data.guide.adminOnly).toBe(false);

    expect(await overviewGuides(user._id)).toHaveLength(1);
  });

  it('leaves the flag alone on a patch that does not mention it', async () => {
    // Retitling a draft must not accidentally publish it.
    const guide = await ChatGuide.create(DRAFT);
    const admin = await createAdminUser({ email: 'admin@test.com' });

    const res = await request(app)
      .patch(`/api/chat/admin/guides/${guide._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ title: 'Canadian Aircrew Selection (CFAST)' });

    expect(res.status).toBe(200);
    expect(res.body.data.guide.adminOnly).toBe(true);
  });

  it('refuses to let a non-admin manage guides at all', async () => {
    const guide = await ChatGuide.create(DRAFT);
    const user  = await createUser({ email: 'member@test.com' });

    const res = await request(app)
      .patch(`/api/chat/admin/guides/${guide._id}`)
      .set('Cookie', authCookie(user._id))
      .send({ adminOnly: false });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await ChatGuide.findById(guide._id)).adminOnly).toBe(true);
  });
});
