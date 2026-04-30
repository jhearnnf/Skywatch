/**
 * admin.tutorials.test.js
 *
 * Tutorial CRUD via /api/admin/tutorials and the public /api/tutorials read.
 * Also covers Tutorial.seedDefaults() idempotency.
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

const Tutorial    = require('../../models/Tutorial');
const AdminAction = require('../../models/AdminAction');

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

describe('Tutorial.seedDefaults()', () => {
  it('inserts every default tutorial when the collection is empty', async () => {
    const defaults = require('../../seeds/tutorialDefaults');
    expect(await Tutorial.countDocuments()).toBe(0);
    await Tutorial.seedDefaults();
    expect(await Tutorial.countDocuments()).toBe(defaults.length);
  });

  it('is idempotent — re-running does not duplicate or overwrite admin edits', async () => {
    await Tutorial.seedDefaults();
    const before = await Tutorial.countDocuments();
    // Simulate an admin edit
    await Tutorial.findOneAndUpdate(
      { tutorialId: 'home' },
      { steps: [{ emoji: '🛸', title: 'Edited', body: 'edited body', advanceOnTargetClick: true }] }
    );

    await Tutorial.seedDefaults();
    expect(await Tutorial.countDocuments()).toBe(before);

    const home = await Tutorial.findOne({ tutorialId: 'home' });
    expect(home.steps).toHaveLength(1);
    expect(home.steps[0].title).toBe('Edited');
  });
});

describe('GET /api/tutorials (public)', () => {
  it('returns the seeded list', async () => {
    await Tutorial.seedDefaults();
    const res = await request(app).get('/api/tutorials');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(Array.isArray(res.body.data.tutorials)).toBe(true);
    expect(res.body.data.tutorials.length).toBeGreaterThan(0);
    const home = res.body.data.tutorials.find(t => t.tutorialId === 'home');
    expect(home).toBeTruthy();
    expect(home.steps.length).toBeGreaterThan(0);
  });
});

describe('GET /api/admin/tutorials', () => {
  it('rejects non-admin users with 403', async () => {
    await createRank();
    await createSettings();
    const user = await createUser();
    const res  = await request(app)
      .get('/api/admin/tutorials')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(403);
  });

  it('returns the list to admins', async () => {
    await createRank();
    await createSettings();
    await Tutorial.seedDefaults();
    const admin = await createAdminUser();
    const res   = await request(app)
      .get('/api/admin/tutorials')
      .set('Cookie', authCookie(admin._id));
    expect(res.status).toBe(200);
    expect(res.body.data.tutorials.length).toBeGreaterThan(0);
  });
});

describe('PUT /api/admin/tutorials/:tutorialId', () => {
  beforeEach(async () => {
    await createRank();
    await createSettings();
    await Tutorial.seedDefaults();
  });

  it('rejects non-admin users with 403', async () => {
    const user = await createUser();
    const res  = await request(app)
      .put('/api/admin/tutorials/home')
      .set('Cookie', authCookie(user._id))
      .send({ steps: [], reason: 'try' });
    expect(res.status).toBe(403);
  });

  it('rejects requests without a reason', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .put('/api/admin/tutorials/home')
      .set('Cookie', authCookie(admin._id))
      .send({ steps: [] });
    expect(res.status).toBe(400);
  });

  it('replaces the steps array and logs an AdminAction', async () => {
    const admin = await createAdminUser();
    const newSteps = [
      { emoji: '👋', title: 'Hi',  body: 'first',  advanceOnTargetClick: true },
      { emoji: '🎯', title: 'Tap', body: 'second',
        highlightSelector: '[data-tutorial-target="x"]',
        highlightPage: '/play',
        advanceOnTargetClick: false },
    ];
    const res = await request(app)
      .put('/api/admin/tutorials/home')
      .set('Cookie', authCookie(admin._id))
      .send({ steps: newSteps, reason: 'shorten home tutorial' });

    expect(res.status).toBe(200);
    expect(res.body.data.tutorial.steps).toHaveLength(2);
    expect(res.body.data.tutorial.steps[1].highlightSelector).toBe('[data-tutorial-target="x"]');
    expect(res.body.data.tutorial.steps[1].advanceOnTargetClick).toBe(false);

    const saved = await Tutorial.findOne({ tutorialId: 'home' });
    expect(saved.steps).toHaveLength(2);

    const action = await AdminAction.findOne({ actionType: 'edit_tutorial_content' });
    expect(action).toBeTruthy();
    expect(action.reason).toBe('shorten home tutorial');
  });

  it('rejects when steps is not an array', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .put('/api/admin/tutorials/home')
      .set('Cookie', authCookie(admin._id))
      .send({ steps: 'oops', reason: 'bad shape' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown tutorialId', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .put('/api/admin/tutorials/does-not-exist')
      .set('Cookie', authCookie(admin._id))
      .send({ steps: [], reason: 'meh' });
    expect(res.status).toBe(404);
  });

  it('coerces missing string fields to empty strings and defaults advanceOnTargetClick to true', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .put('/api/admin/tutorials/home')
      .set('Cookie', authCookie(admin._id))
      .send({ steps: [{ title: 'Just a title' }], reason: 'minimal' });
    expect(res.status).toBe(200);
    const step = res.body.data.tutorial.steps[0];
    expect(step.emoji).toBe('');
    expect(step.body).toBe('');
    expect(step.advanceOnTargetClick).toBe(true);
    // showToGuests defaults to true when omitted
    expect(step.showToGuests).toBe(true);
  });

  it('persists tutorial-level showToGuests when admin toggles it off', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .put('/api/admin/tutorials/home')
      .set('Cookie', authCookie(admin._id))
      .send({ steps: [{ title: 'A' }], showToGuests: false, reason: 'logged-in only' });
    expect(res.status).toBe(200);
    expect(res.body.data.tutorial.showToGuests).toBe(false);
    const saved = await Tutorial.findOne({ tutorialId: 'home' });
    expect(saved.showToGuests).toBe(false);
  });

  it('persists step-level showToGuests independently', async () => {
    const admin = await createAdminUser();
    const res   = await request(app)
      .put('/api/admin/tutorials/profile')
      .set('Cookie', authCookie(admin._id))
      .send({ steps: [
        { title: 'Public',  showToGuests: true  },
        { title: 'Members', showToGuests: false },
      ], reason: 'split visibility' });
    expect(res.status).toBe(200);
    expect(res.body.data.tutorial.steps[0].showToGuests).toBe(true);
    expect(res.body.data.tutorial.steps[1].showToGuests).toBe(false);
    // Tutorial-level default stays true (admin didn't pass it)
    expect(res.body.data.tutorial.showToGuests).toBe(true);
  });
});
