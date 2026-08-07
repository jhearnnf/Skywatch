/**
 * Community Guides — curated links out to the best CBAT reading, shown above
 * Channels in the rail.
 *
 * The URL is admin-entered and becomes a real anchor in every reader's browser,
 * so the interesting cases here are the ones that keep a hostile or malformed
 * address out of the database in the first place.
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const ChatGuide   = require('../../models/ChatGuide');
const AdminAction = require('../../models/AdminAction');

beforeAll(async () => { await db.connect(); });
beforeEach(async () => { await createSettings(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

const GUIDE = { title: 'CBAT Guide', url: 'https://cbatguide.com', description: 'Everything on the tests' };

async function admin() {
  const a = await createUser({ isAdmin: true });
  return authCookie(a._id);
}

const post = (cookie, body) =>
  request(app).post('/api/chat/admin/guides').set('Cookie', cookie).send(body);

describe('POST /api/chat/admin/guides', () => {
  it('adds a guide and records the admin action', async () => {
    const cookie = await admin();

    const res = await post(cookie, GUIDE);

    expect(res.status).toBe(200);
    expect(res.body.data.guide.title).toBe('CBAT Guide');
    expect(res.body.data.guide.url).toBe('https://cbatguide.com/');
    expect(await ChatGuide.countDocuments()).toBe(1);
    expect(await AdminAction.countDocuments({ actionType: 'chat_guide_create' })).toBe(1);
  });

  it('refuses a title with no URL, and a URL with no title', async () => {
    const cookie = await admin();

    expect((await post(cookie, { title: 'CBAT Guide' })).status).toBe(400);
    expect((await post(cookie, { url: 'https://cbatguide.com' })).status).toBe(400);
    expect(await ChatGuide.countDocuments()).toBe(0);
  });

  it('refuses any address that is not http or https', async () => {
    // The rail renders this as an anchor, so a javascript: URL stored here would
    // run in the reader's page the moment they clicked it.
    const cookie = await admin();

    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'cbatguide.com',          // no scheme — URL() cannot parse it
      'not a url at all',
    ]) {
      const res = await post(cookie, { title: 'Bad', url });
      expect(res.status).toBe(400);
    }
    expect(await ChatGuide.countDocuments()).toBe(0);
  });

  it('accepts a site-relative path, which is how the guide page is linked', async () => {
    const cookie = await admin();

    const res = await post(cookie, { title: 'CBAT Community Guide', url: '/cbat-guide.html' });

    expect(res.status).toBe(200);
    expect(res.body.data.guide.url).toBe('/cbat-guide.html');
  });

  it('refuses a protocol-relative URL dressed up as a path', async () => {
    // "//evil.com" looks site-relative and is not — the browser reads it as
    // protocol-relative and leaves the site.
    const cookie = await admin();

    const res = await post(cookie, { title: 'Sneaky', url: '//evil.com/cbat' });

    expect(res.status).toBe(400);
    expect(await ChatGuide.countDocuments()).toBe(0);
  });

  it('refuses a non-admin', async () => {
    const user = await createUser();

    const res = await post(authCookie(user._id), GUIDE);

    expect(res.status).toBe(403);
    expect(await ChatGuide.countDocuments()).toBe(0);
  });
});

describe('seedChatGuides', () => {
  const seedChatGuides = require('../../seeds/seedChatGuides');
  const AppSettings    = require('../../models/AppSettings');

  it('adds the CBAT guide row on a fresh database', async () => {
    await seedChatGuides();

    const guide = await ChatGuide.findOne({ url: '/cbat-guide.html' });
    expect(guide.title).toBe('CBAT Community Guide');
    expect((await AppSettings.findOne()).communityGuidesSeeded).toBe(true);
  });

  it('repairs a row left pointing at the app route instead of the document', async () => {
    // "/cbat-guide" shipped first and is not the document — the SPA has no such
    // route, so slim mode redirected it to /cbat and the guide looked broken.
    // The repair runs outside the one-shot guard or a database that already
    // took the bad URL would keep it forever.
    await seedChatGuides();
    await ChatGuide.updateOne({}, { $set: { url: '/cbat-guide' } });

    await seedChatGuides();

    expect(await ChatGuide.countDocuments({ url: '/cbat-guide' })).toBe(0);
    expect(await ChatGuide.countDocuments({ url: '/cbat-guide.html' })).toBe(1);
  });

  it('does not put it back once an admin removes it', async () => {
    await seedChatGuides();
    await ChatGuide.deleteMany({});

    await seedChatGuides();

    expect(await ChatGuide.countDocuments()).toBe(0);
  });

  it('does not duplicate a row an admin added by hand', async () => {
    const cookie = await admin();
    await post(cookie, { title: 'The guide', url: '/cbat-guide.html' });

    await seedChatGuides();

    expect(await ChatGuide.countDocuments({ url: '/cbat-guide.html' })).toBe(1);
  });
});

describe('PATCH /api/chat/admin/guides/:id', () => {
  it('repoints, retitles and hides', async () => {
    const cookie = await admin();
    const { body } = await post(cookie, GUIDE);
    const id = body.data.guide._id;

    const res = await request(app).patch(`/api/chat/admin/guides/${id}`)
      .set('Cookie', cookie)
      .send({ title: 'The CBAT Guide', url: 'https://cbatguide.com/start', isHidden: true });

    expect(res.status).toBe(200);
    expect(res.body.data.guide.title).toBe('The CBAT Guide');
    expect(res.body.data.guide.url).toBe('https://cbatguide.com/start');
    expect(res.body.data.guide.isHidden).toBe(true);
  });

  it('will not let an edit smuggle in an unsafe URL', async () => {
    const cookie = await admin();
    const { body } = await post(cookie, GUIDE);

    const res = await request(app).patch(`/api/chat/admin/guides/${body.data.guide._id}`)
      .set('Cookie', cookie).send({ url: 'javascript:alert(1)' });

    expect(res.status).toBe(400);
    expect((await ChatGuide.findById(body.data.guide._id)).url).toBe('https://cbatguide.com/');
  });

  it('404s on an id that is not a guide', async () => {
    const cookie = await admin();
    const res = await request(app).patch('/api/chat/admin/guides/not-an-id')
      .set('Cookie', cookie).send({ title: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/chat/admin/guides/:id', () => {
  it('removes the link and logs it', async () => {
    const cookie = await admin();
    const { body } = await post(cookie, GUIDE);

    const res = await request(app).delete(`/api/chat/admin/guides/${body.data.guide._id}`)
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(await ChatGuide.countDocuments()).toBe(0);
    expect(await AdminAction.countDocuments({ actionType: 'chat_guide_delete' })).toBe(1);
  });

  it('refuses a non-admin', async () => {
    const cookie = await admin();
    const { body } = await post(cookie, GUIDE);
    const user = await createUser();

    const res = await request(app).delete(`/api/chat/admin/guides/${body.data.guide._id}`)
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(403);
    expect(await ChatGuide.countDocuments()).toBe(1);
  });
});

describe('GET /api/chat/overview', () => {
  it('lists visible guides in order, for an ordinary user', async () => {
    const cookie = await admin();
    await post(cookie, { ...GUIDE, order: 2 });
    await post(cookie, { title: 'RAF recruitment', url: 'https://raf.mod.uk', order: 1 });

    const user = await createUser({ displayName: 'Falcon', displayNameLower: 'falcon' });
    const res = await request(app).get('/api/chat/overview').set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    expect(res.body.data.guides.map(g => g.title)).toEqual(['RAF recruitment', 'CBAT Guide']);
  });

  it('leaves hidden guides out', async () => {
    const cookie = await admin();
    const { body } = await post(cookie, GUIDE);
    await request(app).patch(`/api/chat/admin/guides/${body.data.guide._id}`)
      .set('Cookie', cookie).send({ isHidden: true });

    const user = await createUser();
    const res = await request(app).get('/api/chat/overview').set('Cookie', authCookie(user._id));

    expect(res.body.data.guides).toEqual([]);
  });

  it('returns an empty list, not an error, when none exist', async () => {
    const user = await createUser();
    const res = await request(app).get('/api/chat/overview').set('Cookie', authCookie(user._id));
    expect(res.body.data.guides).toEqual([]);
  });
});

describe('GET /api/chat/admin/guides', () => {
  it('includes hidden ones, and refuses a non-admin', async () => {
    const cookie = await admin();
    const { body } = await post(cookie, GUIDE);
    await request(app).patch(`/api/chat/admin/guides/${body.data.guide._id}`)
      .set('Cookie', cookie).send({ isHidden: true });

    const res = await request(app).get('/api/chat/admin/guides').set('Cookie', cookie);
    expect(res.body.data.guides).toHaveLength(1);
    expect(res.body.data.guides[0].isHidden).toBe(true);

    const user = await createUser();
    const denied = await request(app).get('/api/chat/admin/guides').set('Cookie', authCookie(user._id));
    expect(denied.status).toBe(403);
  });
});
