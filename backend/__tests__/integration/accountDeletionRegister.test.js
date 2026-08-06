process.env.JWT_SECRET = 'test_secret';
process.env.ACCOUNT_DELETION_PEPPER = 'test_pepper';

const request = require('supertest');
const mongoose = require('mongoose');

const app = require('../../app');
const db  = require('../helpers/setupDb');
const { createUser, createAdminUser, createSettings, authCookie } = require('../helpers/factories');

const AccountDeletion = require('../../models/AccountDeletion');
const AirstarLog      = require('../../models/AirstarLog');
const SystemLog       = require('../../models/SystemLog');

beforeAll(async () => {
  await db.connect();
  await createSettings();
});
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

describe('erasure register — what gets written', () => {
  it('records a self-service deletion without storing anything identifying', async () => {
    const user = await createUser({ email: 'leaving@test.com', agentNumber: '7654321', displayName: 'Departing' });
    await AirstarLog.create({ userId: user._id, amount: 10, reason: 'test' });

    await request(app).delete('/api/users/me').set('Cookie', authCookie(user._id));

    const rows = await AccountDeletion.find({});
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row.initiatedBy).toBe('self');
    expect(row.adminUserId).toBeNull();
    expect(row.recordsErased).toBeGreaterThan(0);
    expect(row.breakdown.get('AirstarLog')).toBe(1);
    expect(row.breakdown.get('User')).toBe(1);

    // The whole point of the design: nothing in the stored document reveals who
    // this was. Serialise it and look for every identifier the account had.
    const serialised = JSON.stringify(row.toObject());
    expect(serialised).not.toContain('leaving@test.com');
    expect(serialised).not.toContain(String(user._id));
    expect(serialised).not.toContain('7654321');
    expect(serialised).not.toContain('Departing');
  });

  it('stores a recomputable, non-reversible ref for the email', async () => {
    const user = await createUser({ email: 'Mixed.Case@Test.com' });

    await request(app).delete('/api/users/me').set('Cookie', authCookie(user._id));

    const row = await AccountDeletion.findOne({});
    expect(row.userRef).toMatch(/^[a-f0-9]{64}$/);
    // Case/whitespace-insensitive, so an address typed back in later still matches.
    expect(row.userRef).toBe(AccountDeletion.refFor('  mixed.case@test.com '));
    // Keyed, not a bare digest — a different email gives a different ref.
    expect(row.userRef).not.toBe(AccountDeletion.refFor('someone.else@test.com'));
  });

  it('records who deleted the account and why, for admin deletions', async () => {
    const admin  = await createAdminUser();
    const target = await createUser();

    await request(app)
      .delete(`/api/admin/users/${target._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: 'spam account' });

    const row = await AccountDeletion.findOne({});
    expect(row.initiatedBy).toBe('admin');
    expect(row.adminUserId.toString()).toBe(admin._id.toString());
    expect(row.reason).toBe('spam account');
    expect(row.accountAgeDays).toBe(0);
  });

  it('does not mint a row when there was no account to erase', async () => {
    const admin = await createAdminUser();

    await request(app)
      .delete(`/api/admin/users/${new mongoose.Types.ObjectId()}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: 'already gone' });

    expect(await AccountDeletion.countDocuments({})).toBe(0);
  });

  it('completes the erasure even if the register write fails, and logs the gap', async () => {
    const user = await createUser();
    const spy = jest.spyOn(AccountDeletion, 'create').mockRejectedValue(new Error('disk on fire'));

    const res = await request(app).delete('/api/users/me').set('Cookie', authCookie(user._id));
    spy.mockRestore();

    // The erasure is the obligation; a bookkeeping failure must not turn it into
    // an error the caller might retry against an account that's already gone.
    expect(res.status).toBe(200);
    const log = await SystemLog.findOne({ type: 'account_deletion_log_failure' });
    expect(log).not.toBeNull();
    expect(log.failureReason).toBe('disk on fire');
  });
});

describe('GET /api/admin/account-deletions', () => {
  it('lists rows newest-first with per-type counts, and never leaks userRef', async () => {
    const admin = await createAdminUser();
    await AccountDeletion.create([
      { userRef: 'a'.repeat(64), initiatedBy: 'self',  deletedAt: new Date('2026-01-01'), recordsErased: 4 },
      { userRef: 'b'.repeat(64), initiatedBy: 'admin', deletedAt: new Date('2026-02-01'), recordsErased: 9 },
    ]);

    const res = await request(app)
      .get('/api/admin/account-deletions')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(200);
    expect(res.body.data.deletions.map(d => d.recordsErased)).toEqual([9, 4]);
    expect(res.body.data.selfTotal).toBe(1);
    expect(res.body.data.adminTotal).toBe(1);
    expect(JSON.stringify(res.body)).not.toContain('a'.repeat(64));
  });

  it('filters by who initiated the deletion', async () => {
    const admin = await createAdminUser();
    await AccountDeletion.create([
      { userRef: 'a'.repeat(64), initiatedBy: 'self'  },
      { userRef: 'b'.repeat(64), initiatedBy: 'admin' },
      { userRef: 'c'.repeat(64), initiatedBy: 'admin' },
    ]);

    const res = await request(app)
      .get('/api/admin/account-deletions?initiatedBy=admin')
      .set('Cookie', authCookie(admin._id));

    expect(res.body.data.total).toBe(2);
    expect(res.body.data.deletions.every(d => d.initiatedBy === 'admin')).toBe(true);
    // Counts describe the whole register, not the filtered page.
    expect(res.body.data.selfTotal).toBe(1);
  });

  it('is admin-only', async () => {
    const user = await createUser();
    const res = await request(app)
      .get('/api/admin/account-deletions')
      .set('Cookie', authCookie(user._id));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/account-deletions/lookup', () => {
  it('confirms an erasure from the email alone', async () => {
    const admin = await createAdminUser();
    const user  = await createUser({ email: 'gone@test.com' });
    await request(app).delete('/api/users/me').set('Cookie', authCookie(user._id));

    const res = await request(app)
      .post('/api/admin/account-deletions/lookup')
      .set('Cookie', authCookie(admin._id))
      .send({ email: 'GONE@test.com' });

    expect(res.status).toBe(200);
    expect(res.body.data.matches).toHaveLength(1);
    expect(res.body.data.matches[0].initiatedBy).toBe('self');
    expect(res.body.data.stillActive).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain('gone@test.com');
  });

  it('distinguishes a live account from no record at all', async () => {
    const admin = await createAdminUser();
    await createUser({ email: 'here@test.com' });

    const live = await request(app)
      .post('/api/admin/account-deletions/lookup')
      .set('Cookie', authCookie(admin._id))
      .send({ email: 'here@test.com' });
    expect(live.body.data).toEqual({ matches: [], stillActive: true });

    const unknown = await request(app)
      .post('/api/admin/account-deletions/lookup')
      .set('Cookie', authCookie(admin._id))
      .send({ email: 'nobody@test.com' });
    expect(unknown.body.data).toEqual({ matches: [], stillActive: false });
  });

  it('rejects a blank email rather than matching everything', async () => {
    const admin = await createAdminUser();
    const res = await request(app)
      .post('/api/admin/account-deletions/lookup')
      .set('Cookie', authCookie(admin._id))
      .send({ email: '   ' });
    expect(res.status).toBe(400);
  });
});
