/**
 * Admin briefs list — sort order
 *
 * Default sort is `publishedAt` desc: briefs appear in the order they were
 * marked published (newest first). Stubs have no publishedAt and fall to the
 * bottom. Published briefs predating the field fall back to `updatedAt`.
 */
process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createAdminUser, createBrief, createSettings, createGameType, authCookie } = require('../helpers/factories');
const IntelligenceBrief = require('../../models/IntelligenceBrief');

beforeAll(async () => { await db.connect(); });
beforeEach(async () => { await createSettings(); await createGameType(); });
afterEach(async ()  => db.clearDatabase());
afterAll(async ()   => db.closeDatabase());

describe('GET /api/admin/briefs — default sort by publishedAt desc', () => {
  it('orders published briefs by publishedAt desc (newest first)', async () => {
    const admin = await createAdminUser();

    const oldest = await createBrief({ title: 'Oldest published' });
    await IntelligenceBrief.findByIdAndUpdate(
      oldest._id,
      { publishedAt: new Date('2025-01-01') },
      { timestamps: false },
    );
    const middle = await createBrief({ title: 'Middle published' });
    await IntelligenceBrief.findByIdAndUpdate(
      middle._id,
      { publishedAt: new Date('2025-06-01') },
      { timestamps: false },
    );
    const newest = await createBrief({ title: 'Newest published' });
    await IntelligenceBrief.findByIdAndUpdate(
      newest._id,
      { publishedAt: new Date('2025-12-01') },
      { timestamps: false },
    );

    const res = await request(app)
      .get('/api/admin/briefs')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    const titles = res.body.data.briefs.map(b => b.title);
    expect(titles).toEqual(['Newest published', 'Middle published', 'Oldest published']);
  });

  it('places stubs last regardless of when they were created', async () => {
    const admin = await createAdminUser();

    const stub = await createBrief({ title: 'Stub brief' });
    await IntelligenceBrief.findByIdAndUpdate(stub._id, { status: 'stub', publishedAt: null });

    const published = await createBrief({ title: 'Published brief' });
    await IntelligenceBrief.findByIdAndUpdate(
      published._id,
      { publishedAt: new Date('2025-06-01') },
      { timestamps: false },
    );

    const res = await request(app)
      .get('/api/admin/briefs')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    const titles = res.body.data.briefs.map(b => b.title);
    expect(titles[0]).toBe('Published brief');
    expect(titles[titles.length - 1]).toBe('Stub brief');
  });

  it('falls back to updatedAt for published briefs missing publishedAt', async () => {
    const admin = await createAdminUser();

    const legacyOld = await createBrief({ title: 'Legacy old' });
    await IntelligenceBrief.findByIdAndUpdate(
      legacyOld._id,
      { publishedAt: null, updatedAt: new Date('2024-01-01') },
      { timestamps: false },
    );
    const legacyNew = await createBrief({ title: 'Legacy new' });
    await IntelligenceBrief.findByIdAndUpdate(
      legacyNew._id,
      { publishedAt: null, updatedAt: new Date('2024-12-01') },
      { timestamps: false },
    );

    const res = await request(app)
      .get('/api/admin/briefs')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    const titles = res.body.data.briefs.map(b => b.title);
    expect(titles.indexOf('Legacy new')).toBeLessThan(titles.indexOf('Legacy old'));
  });

  it('sort=newest orders by updatedAt desc, ignoring publishedAt', async () => {
    const admin = await createAdminUser();

    const oldest = await createBrief({ title: 'Oldest brief' });
    await IntelligenceBrief.findByIdAndUpdate(
      oldest._id,
      { updatedAt: new Date('2025-01-01') },
      { timestamps: false },
    );
    const middle = await createBrief({ title: 'Middle brief' });
    await IntelligenceBrief.findByIdAndUpdate(
      middle._id,
      { updatedAt: new Date('2025-06-01') },
      { timestamps: false },
    );
    const newest = await createBrief({ title: 'Newest brief' });
    await IntelligenceBrief.findByIdAndUpdate(
      newest._id,
      { updatedAt: new Date('2025-12-01') },
      { timestamps: false },
    );

    const res = await request(app)
      .get('/api/admin/briefs?sort=newest')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    const titles = res.body.data.briefs.map(b => b.title);
    expect(titles).toEqual(['Newest brief', 'Middle brief', 'Oldest brief']);
  });

  it('sort=oldest orders by updatedAt asc', async () => {
    const admin = await createAdminUser();

    const oldest = await createBrief({ title: 'Oldest brief' });
    await IntelligenceBrief.findByIdAndUpdate(
      oldest._id,
      { updatedAt: new Date('2025-01-01') },
      { timestamps: false },
    );
    const middle = await createBrief({ title: 'Middle brief' });
    await IntelligenceBrief.findByIdAndUpdate(
      middle._id,
      { updatedAt: new Date('2025-06-01') },
      { timestamps: false },
    );
    const newest = await createBrief({ title: 'Newest brief' });
    await IntelligenceBrief.findByIdAndUpdate(
      newest._id,
      { updatedAt: new Date('2025-12-01') },
      { timestamps: false },
    );

    const res = await request(app)
      .get('/api/admin/briefs?sort=oldest')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    const titles = res.body.data.briefs.map(b => b.title);
    expect(titles).toEqual(['Oldest brief', 'Middle brief', 'Newest brief']);
  });

  it('sort=no-priority places briefs without priorityNumber first', async () => {
    const admin = await createAdminUser();

    const withPriority = await createBrief({ title: 'Has priority', category: 'Aircrafts', priorityNumber: 5 });
    const noPriority1 = await createBrief({ title: 'No priority A', category: 'Aircrafts', priorityNumber: null });
    const noPriority2 = await createBrief({ title: 'No priority B', category: 'Aircrafts', priorityNumber: null });
    await IntelligenceBrief.findByIdAndUpdate(withPriority._id, { updatedAt: new Date('2025-12-01') }, { timestamps: false });
    await IntelligenceBrief.findByIdAndUpdate(noPriority1._id,  { updatedAt: new Date('2025-06-01') }, { timestamps: false });
    await IntelligenceBrief.findByIdAndUpdate(noPriority2._id,  { updatedAt: new Date('2025-11-01') }, { timestamps: false });

    const res = await request(app)
      .get('/api/admin/briefs?sort=no-priority')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    const titles = res.body.data.briefs.map(b => b.title);
    expect(titles.slice(0, 2).sort()).toEqual(['No priority A', 'No priority B']);
    expect(titles[titles.length - 1]).toBe('Has priority');
  });

  it('sort=no-priority places News-category briefs after all non-News briefs', async () => {
    const admin = await createAdminUser();

    const newsNoPri  = await createBrief({ title: 'News no pri',  category: 'News',      priorityNumber: null });
    const newsPri    = await createBrief({ title: 'News with pri',category: 'News',      priorityNumber: 3 });
    const acNoPri    = await createBrief({ title: 'AC no pri',    category: 'Aircrafts', priorityNumber: null });
    const acPri      = await createBrief({ title: 'AC with pri',  category: 'Aircrafts', priorityNumber: 7 });

    const res = await request(app)
      .get('/api/admin/briefs?sort=no-priority')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    const titles = res.body.data.briefs.map(b => b.title);

    // Non-News first (no-priority before with-priority), News last
    expect(titles).toEqual(['AC no pri', 'AC with pri', 'News no pri', 'News with pri']);
  });

  it('hideStubs=true excludes stub briefs from results', async () => {
    const admin = await createAdminUser();

    const stub = await createBrief({ title: 'Stub brief' });
    await IntelligenceBrief.findByIdAndUpdate(stub._id, { status: 'stub' });
    const published = await createBrief({ title: 'Published brief' });
    await IntelligenceBrief.findByIdAndUpdate(published._id, { status: 'published' });

    const all = await request(app)
      .get('/api/admin/briefs')
      .set('Cookie', authCookie(admin._id));
    expect(all.body.data.briefs.map(b => b.title).sort()).toEqual(['Published brief', 'Stub brief']);

    const filtered = await request(app)
      .get('/api/admin/briefs?hideStubs=true')
      .set('Cookie', authCookie(admin._id));
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.briefs.map(b => b.title)).toEqual(['Published brief']);
    expect(filtered.body.data.total).toBe(1);
  });
});

describe('POST /api/admin/briefs — publishedAt stamp', () => {
  it('stamps publishedAt when a new published brief is created', async () => {
    const admin = await createAdminUser();

    const before = Date.now();
    const res = await request(app)
      .post('/api/admin/briefs')
      .set('Cookie', authCookie(admin._id))
      .send({ title: 'Fresh brief', category: 'Aircrafts', reason: 'test' });

    expect(res.status).toBe(200);
    const saved = await IntelligenceBrief.findById(res.body.data.brief._id).lean();
    expect(saved.publishedAt).toBeTruthy();
    expect(new Date(saved.publishedAt).getTime()).toBeGreaterThanOrEqual(before);
  });

  it('stamps publishedAt when promoting an existing stub to published', async () => {
    const admin = await createAdminUser();

    const stub = await createBrief({ title: 'Stub to promote', category: 'Aircrafts', status: 'stub' });
    await IntelligenceBrief.findByIdAndUpdate(stub._id, { publishedAt: null });

    const before = Date.now();
    const res = await request(app)
      .post('/api/admin/briefs')
      .set('Cookie', authCookie(admin._id))
      .send({ title: 'Stub to promote', category: 'Aircrafts', reason: 'test' });

    expect(res.status).toBe(200);
    const saved = await IntelligenceBrief.findById(stub._id).lean();
    expect(saved.status).toBe('published');
    expect(saved.publishedAt).toBeTruthy();
    expect(new Date(saved.publishedAt).getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe('PATCH /api/admin/briefs/:id — publishedAt stamp', () => {
  it('stamps publishedAt when status is updated to published for the first time', async () => {
    const admin = await createAdminUser();

    const stub = await createBrief({ title: 'Stub via patch', status: 'stub' });
    await IntelligenceBrief.findByIdAndUpdate(stub._id, { publishedAt: null });

    const before = Date.now();
    const res = await request(app)
      .patch(`/api/admin/briefs/${stub._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ status: 'published', reason: 'test' });

    expect(res.status).toBe(200);
    const saved = await IntelligenceBrief.findById(stub._id).lean();
    expect(saved.publishedAt).toBeTruthy();
    expect(new Date(saved.publishedAt).getTime()).toBeGreaterThanOrEqual(before);
  });

  it('does not overwrite an existing publishedAt on subsequent patches', async () => {
    const admin = await createAdminUser();

    const original = new Date('2025-03-01');
    const brief = await createBrief({ title: 'Already published', status: 'published' });
    await IntelligenceBrief.findByIdAndUpdate(brief._id, { publishedAt: original });

    const res = await request(app)
      .patch(`/api/admin/briefs/${brief._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ status: 'published', subtitle: 'edited', reason: 'test' });

    expect(res.status).toBe(200);
    const saved = await IntelligenceBrief.findById(brief._id).lean();
    expect(new Date(saved.publishedAt).toISOString()).toBe(original.toISOString());
  });
});
