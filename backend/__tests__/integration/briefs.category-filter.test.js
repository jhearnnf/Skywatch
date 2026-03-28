process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createBrief, createSettings } = require('../helpers/factories');

beforeAll(async () => {
  await db.connect();
  await createSettings();
});
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// ── subcategory filtering ──────────────────────────────────────────────────
describe('GET /api/briefs — subcategory filter', () => {
  it('returns only briefs matching the given subcategory', async () => {
    await createBrief({ category: 'Aircrafts', subcategory: 'Fast Jet',     title: 'Typhoon' });
    await createBrief({ category: 'Aircrafts', subcategory: 'Fast Jet',     title: 'Tornado' });
    await createBrief({ category: 'Aircrafts', subcategory: 'Rotary Wing',  title: 'Chinook' });

    const res = await request(app).get('/api/briefs?category=Aircrafts&subcategory=Fast+Jet');

    expect(res.status).toBe(200);
    expect(res.body.data.briefs.length).toBe(2);
    expect(res.body.data.briefs.every(b => b.subcategory === 'Fast Jet')).toBe(true);
  });

  it('returns empty array and total=0 when subcategory has no matches', async () => {
    await createBrief({ category: 'Aircrafts', subcategory: 'Fast Jet', title: 'Typhoon' });

    const res = await request(app).get('/api/briefs?category=Aircrafts&subcategory=Rotary+Wing');

    expect(res.status).toBe(200);
    expect(res.body.data.briefs.length).toBe(0);
    expect(res.body.data.total).toBe(0);
  });

  it('returns all subcategories when subcategory param is omitted', async () => {
    await createBrief({ category: 'Aircrafts', subcategory: 'Fast Jet' });
    await createBrief({ category: 'Aircrafts', subcategory: 'Rotary Wing' });

    const res = await request(app).get('/api/briefs?category=Aircrafts');

    expect(res.status).toBe(200);
    expect(res.body.data.briefs.length).toBe(2);
  });
});

// ── combined search + subcategory ─────────────────────────────────────────
describe('GET /api/briefs — combined search and subcategory', () => {
  it('returns the intersection of search and subcategory filters', async () => {
    await createBrief({ title: 'Typhoon Brief',   category: 'Aircrafts', subcategory: 'Fast Jet' });
    await createBrief({ title: 'Hawk Brief',      category: 'Aircrafts', subcategory: 'Training Aircraft' });
    await createBrief({ title: 'Typhoon History', category: 'Aircrafts', subcategory: 'Training Aircraft' });
    await createBrief({ title: 'Unrelated',       category: 'Aircrafts', subcategory: 'Fast Jet' });

    const res = await request(app).get('/api/briefs?category=Aircrafts&search=Typhoon&subcategory=Fast+Jet');

    expect(res.status).toBe(200);
    expect(res.body.data.briefs.length).toBe(1);
    expect(res.body.data.briefs[0].title).toBe('Typhoon Brief');
  });
});

// ── pagination with filters ────────────────────────────────────────────────
describe('GET /api/briefs — pagination with filters', () => {
  it('total reflects the filtered count, not the whole collection', async () => {
    await createBrief({ category: 'Aircrafts', subcategory: 'Fast Jet' });
    await createBrief({ category: 'Aircrafts', subcategory: 'Fast Jet' });
    await createBrief({ category: 'Aircrafts', subcategory: 'Rotary Wing' });
    await createBrief({ category: 'Aircrafts', subcategory: 'Rotary Wing' });
    await createBrief({ category: 'Aircrafts', subcategory: 'Rotary Wing' });

    const res = await request(app).get('/api/briefs?category=Aircrafts&subcategory=Fast+Jet&limit=10');

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.briefs.length).toBe(2);
  });

  it('page 2 with an active filter returns the correct slice', async () => {
    for (let i = 1; i <= 5; i++) {
      await createBrief({ category: 'Aircrafts', subcategory: 'Fast Jet', title: `Brief ${i}` });
    }

    const p1 = await request(app).get('/api/briefs?category=Aircrafts&subcategory=Fast+Jet&limit=3&page=1');
    const p2 = await request(app).get('/api/briefs?category=Aircrafts&subcategory=Fast+Jet&limit=3&page=2');

    expect(p1.status).toBe(200);
    expect(p1.body.data.briefs.length).toBe(3);
    expect(p1.body.data.total).toBe(5);

    expect(p2.status).toBe(200);
    expect(p2.body.data.briefs.length).toBe(2);
    expect(p2.body.data.total).toBe(5);
  });

  it('totalPages is correct for the filtered result set', async () => {
    for (let i = 0; i < 7; i++) {
      await createBrief({ category: 'Aircrafts', subcategory: 'Fast Jet' });
    }

    const res = await request(app).get('/api/briefs?category=Aircrafts&subcategory=Fast+Jet&limit=3&page=1');

    expect(res.status).toBe(200);
    expect(res.body.data.totalPages).toBe(3); // ceil(7/3)
  });

  it('page beyond the result set returns empty briefs array with correct total', async () => {
    await createBrief({ category: 'Aircrafts', subcategory: 'Fast Jet' });
    await createBrief({ category: 'Aircrafts', subcategory: 'Fast Jet' });

    const res = await request(app).get('/api/briefs?category=Aircrafts&subcategory=Fast+Jet&limit=10&page=5');

    expect(res.status).toBe(200);
    expect(res.body.data.briefs.length).toBe(0);
    expect(res.body.data.total).toBe(2);
  });

  it('page=0 is clamped to page 1 and returns a valid response', async () => {
    await createBrief({ category: 'News' });
    await createBrief({ category: 'News' });
    await createBrief({ category: 'News' });

    const res = await request(app).get('/api/briefs?category=News&page=0');

    expect(res.status).toBe(200);
    expect(res.body.data.briefs.length).toBe(3);
    expect(res.body.data.page).toBe(1);
  });

  it('negative page is clamped to page 1', async () => {
    await createBrief({ category: 'News' });

    const res = await request(app).get('/api/briefs?category=News&page=-5');

    expect(res.status).toBe(200);
    expect(res.body.data.page).toBe(1);
    expect(res.body.data.briefs.length).toBe(1);
  });
});

// ── search applies across all data, not just first page ───────────────────
describe('GET /api/briefs — search across full dataset', () => {
  it('finds a brief that would fall outside the first page if unfiltered', async () => {
    // Create 35 briefs that sort before the needle (titles starting with 'A')
    for (let i = 0; i < 35; i++) {
      await createBrief({ category: 'News', title: `AAA Brief ${String(i).padStart(3, '0')}` });
    }
    // The needle brief will sort after all the 'AAA' briefs by dateAdded
    await createBrief({ category: 'News', title: 'Unique Needle Brief' });

    // Without search, page 1 (limit 30) won't include the needle
    const unfiltered = await request(app).get('/api/briefs?category=News&limit=30&page=1');
    const unfilteredTitles = unfiltered.body.data.briefs.map(b => b.title);
    // The needle may or may not appear (depends on sort order), but search should always find it
    const searchRes = await request(app).get('/api/briefs?category=News&search=Unique+Needle&limit=30&page=1');

    expect(searchRes.status).toBe(200);
    expect(searchRes.body.data.briefs.length).toBe(1);
    expect(searchRes.body.data.briefs[0].title).toBe('Unique Needle Brief');
    expect(searchRes.body.data.total).toBe(1);
  });
});

// ── search matches subtitle ────────────────────────────────────────────────
describe('GET /api/briefs — search matches subtitle', () => {
  it('returns a brief that matches the search term in its subtitle', async () => {
    await createBrief({ title: 'RAF Brief',   subtitle: 'Contains searchable term', category: 'News' });
    await createBrief({ title: 'Other Brief', subtitle: 'Something else',           category: 'News' });

    const res = await request(app).get('/api/briefs?search=searchable+term');

    expect(res.status).toBe(200);
    expect(res.body.data.briefs.length).toBe(1);
    expect(res.body.data.briefs[0].title).toBe('RAF Brief');
  });
});

// ── response shape regressions ────────────────────────────────────────────
describe('GET /api/briefs — response shape', () => {
  it('includes total, page, and totalPages in every response', async () => {
    await createBrief({ category: 'News' });
    await createBrief({ category: 'News' });
    await createBrief({ category: 'News' });

    const res = await request(app).get('/api/briefs?category=News&limit=2&page=1');

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(3);
    expect(res.body.data.page).toBe(1);
    expect(res.body.data.totalPages).toBe(2);
  });

  it('returns total=0 and empty briefs for a search with no matches', async () => {
    await createBrief({ title: 'Something Real', category: 'News' });

    const res = await request(app).get('/api/briefs?search=xyzzynonexistent');

    expect(res.status).toBe(200);
    expect(res.body.data.briefs.length).toBe(0);
    expect(res.body.data.total).toBe(0);
  });
});
