/**
 * cbat-passers.test.js
 *
 * The "potential CBAT passers" cohort and its bulk send.
 *
 * Coverage:
 *   - Auth guards
 *   - Completions come from RESULT rows, so abandoned starts never qualify
 *   - The ≥N finished-games threshold
 *   - Dormancy banding (ready / warm / still-active)
 *   - Named, bot, admin, banned and opted-out exclusions
 *   - Grouping by the day of the last finished run
 *   - Send: invites created, emails batched, rows stamped
 *   - Send is idempotent — a second send cannot mail the same person twice
 *   - Preview renders without creating an invite
 *   - A deferred "not yet" respondent is held, then returns to the pool
 */

process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const {
  createSettings,
  createAdminUser,
  createUser,
  authCookie,
} = require('../helpers/factories');

const GameSessionCbatTargetResult = require('../../models/GameSessionCbatTargetResult');
const GameSessionCbatStart        = require('../../models/GameSessionCbatStart');
const SurveyInvite                = require('../../models/SurveyInvite');
const User                        = require('../../models/User');

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);

// `count` finished Target runs, all dated `days` ago.
async function finishRuns(userId, count, days) {
  const at = daysAgo(days);
  await GameSessionCbatTargetResult.insertMany(
    Array.from({ length: count }, () => ({
      userId, totalScore: 500, totalTime: 120, createdAt: at,
    })),
  );
}

// Opened-and-quit sessions: a start with no result.
async function abandonRuns(userId, count, days) {
  const at = daysAgo(days);
  await GameSessionCbatStart.insertMany(
    Array.from({ length: count }, () => ({ userId, gameKey: 'target', startedAt: at })),
  );
}

async function candidate({ completions = 12, days = 30, ...overrides } = {}) {
  const u = await createUser(overrides);
  await finishRuns(u._id, completions, days);
  await User.updateOne({ _id: u._id }, { lastSeen: daysAgo(days) });
  return u;
}

let admin, cookie;

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

beforeEach(async () => {
  await createSettings();
  admin  = await createAdminUser();
  cookie = authCookie(admin._id);
});

const getList = (qs = '') =>
  request(app).get(`/api/admin/cbat-passers${qs}`).set('Cookie', cookie);

const namesIn = (body) =>
  body.data.groups.flatMap(g => g.users.map(u => u.email));

describe('GET /api/admin/cbat-passers — auth', () => {
  it('401s without a cookie', async () => {
    const res = await request(app).get('/api/admin/cbat-passers');
    expect(res.status).toBe(401);
  });

  it('403s for a non-admin', async () => {
    const plain = await createUser();
    const res = await getList().set('Cookie', authCookie(plain._id));
    expect(res.status).toBe(403);
  });
});

describe('cohort membership', () => {
  it('includes someone who finished 12 games and went quiet 30 days ago', async () => {
    const u = await candidate();
    const res = await getList();
    expect(res.status).toBe(200);
    expect(namesIn(res.body)).toContain(u.email);
  });

  it('excludes someone who only opened games and abandoned them', async () => {
    const u = await createUser();
    await abandonRuns(u._id, 40, 30);
    await User.updateOne({ _id: u._id }, { lastSeen: daysAgo(30) });

    const res = await getList();
    expect(namesIn(res.body)).not.toContain(u.email);
  });

  it('excludes someone below the finished-games threshold', async () => {
    const u = await candidate({ completions: 9 });
    const res = await getList();
    expect(namesIn(res.body)).not.toContain(u.email);
  });

  it('includes them once the threshold is lowered', async () => {
    const u = await candidate({ completions: 9 });
    const res = await getList('?minCompletions=5');
    expect(namesIn(res.body)).toContain(u.email);
  });

  it('excludes someone still using the site daily', async () => {
    const u = await candidate({ completions: 30, days: 1 });
    const res = await getList();
    expect(namesIn(res.body)).not.toContain(u.email);
  });

  it('counts a recent heartbeat as activity even when the last game is old', async () => {
    const u = await createUser();
    await finishRuns(u._id, 20, 60);
    await User.updateOne({ _id: u._id }, { lastSeen: daysAgo(2) }); // came back yesterday

    const res = await getList();
    expect(namesIn(res.body)).not.toContain(u.email);
  });

  it('bands a 16-day gap as warm rather than ready', async () => {
    const u = await candidate({ days: 16 });
    const res = await getList();
    const row = res.body.data.groups.flatMap(g => g.users).find(x => x.email === u.email);
    expect(row.band).toBe('warm');
    expect(res.body.data.nextBatchIds.map(String)).not.toContain(row._id.toString());
  });

  it('bands a 30-day gap as ready and offers it in the next batch', async () => {
    const u = await candidate({ days: 30 });
    const res = await getList();
    const row = res.body.data.groups.flatMap(g => g.users).find(x => x.email === u.email);
    expect(row.band).toBe('ready');
    expect(res.body.data.nextBatchIds.map(String)).toContain(row._id.toString());
  });
});

describe('exclusions', () => {
  it.each([
    'shepyzommor@gmail.com',
    'andreaspaschalis@gmail.com',
    'karatekiddnb@gmail.com',
    'osmightymanos@hotmail.co.uk',
  ])('excludes the named account %s', async (email) => {
    const u = await candidate({ email });
    const res = await getList();
    expect(namesIn(res.body)).not.toContain(u.email);
  });

  it('excludes the named accounts by display name, case-insensitively', async () => {
    const u = await candidate({ displayName: 'kezza' });
    const res = await getList();
    expect(namesIn(res.body)).not.toContain(u.email);
  });

  it('excludes bots, admins and banned accounts', async () => {
    const bot    = await candidate({ isBot: true });
    const other  = await candidate({ isAdmin: true });
    const banned = await candidate({ isBanned: true });

    const emails = namesIn((await getList()).body);
    expect(emails).not.toContain(bot.email);
    expect(emails).not.toContain(other.email);
    expect(emails).not.toContain(banned.email);
  });

  it('excludes anyone who has opted out of research email', async () => {
    const u = await candidate();
    await User.updateOne({ _id: u._id }, { researchEmailOptOut: { at: new Date(), reason: null, campaign: 'x' } });
    expect(namesIn((await getList()).body)).not.toContain(u.email);
  });

  it('KEEPS testers — several were real CBAT candidates', async () => {
    const u = await candidate({ isTester: true });
    expect(namesIn((await getList()).body)).toContain(u.email);
  });

  it('KEEPS accounts already flagged as having passed', async () => {
    const u = await candidate({ cbatPassed: true });
    expect(namesIn((await getList()).body)).toContain(u.email);
  });
});

describe('grouping', () => {
  it('groups by the day of the last finished run, most recent first', async () => {
    await candidate({ days: 30 });
    await candidate({ days: 40 });
    await candidate({ days: 30 });

    const res = await getList();
    const days = res.body.data.groups.map(g => g.day);
    expect(days).toHaveLength(2);
    expect([...days].sort().reverse()).toEqual(days); // descending
    const biggest = res.body.data.groups.find(g => g.users.length === 2);
    expect(biggest).toBeDefined();
  });
});

describe('POST /api/admin/cbat-passers/send', () => {
  it('creates invites, sends, and stamps the rows', async () => {
    const u = await candidate();
    const { __batchMock } = require('resend');
    __batchMock.mockClear();

    const res = await request(app)
      .post('/api/admin/cbat-passers/send')
      .set('Cookie', cookie)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.sentCount).toBe(1);
    expect(res.body.data.sent).toContain(u.email);

    const invite = await SurveyInvite.findOne({ userId: u._id });
    expect(invite).toBeTruthy();
    expect(invite.sentAt).toBeTruthy();
    expect(invite.token).toHaveLength(64);

    // One batch call carrying one personalised message with that token in it.
    expect(__batchMock).toHaveBeenCalledTimes(1);
    const [messages] = __batchMock.mock.calls[0];
    expect(messages).toHaveLength(1);
    expect(messages[0].to).toBe(u.email);
    expect(messages[0].html).toContain(`/survey/${invite.token}`);
    expect(messages[0].html).toContain(`/survey/${invite.token}/opt-out`);
  });

  it('never mails the same person twice', async () => {
    await candidate();
    const first = await request(app).post('/api/admin/cbat-passers/send').set('Cookie', cookie).send({});
    expect(first.body.data.sentCount).toBe(1);

    const second = await request(app).post('/api/admin/cbat-passers/send').set('Cookie', cookie).send({});
    expect(second.status).toBe(400);
    expect(await SurveyInvite.countDocuments()).toBe(1);
  });

  it('caps a batch at 50', async () => {
    for (let i = 0; i < 55; i++) await candidate({ days: 30 + i });
    const res = await request(app).post('/api/admin/cbat-passers/send').set('Cookie', cookie).send({});
    expect(res.body.data.sentCount).toBe(50);
    expect(await SurveyInvite.countDocuments()).toBe(50);
  });

  it('shows already-emailed people as ticked off, and drops them from the next batch', async () => {
    const a = await candidate({ days: 30 });
    await request(app).post('/api/admin/cbat-passers/send').set('Cookie', cookie).send({});

    const res = await getList();
    const row = res.body.data.groups.flatMap(g => g.users).find(x => x.email === a.email);
    expect(row.invite.sentAt).toBeTruthy();
    expect(res.body.data.nextBatchIds).toHaveLength(0);
    expect(res.body.data.totals.remaining).toBe(0);
    expect(res.body.data.totals.emailed).toBe(1);
  });

  it('records a failed send without stamping sentAt, so it can be retried', async () => {
    await candidate();
    const { __batchMock } = require('resend');
    __batchMock.mockResolvedValueOnce({ data: { data: [{}] }, error: null }); // no id back

    const res = await request(app).post('/api/admin/cbat-passers/send').set('Cookie', cookie).send({});
    expect(res.body.data.failedCount).toBe(1);

    const invite = await SurveyInvite.findOne({});
    expect(invite.sentAt).toBeNull();
    expect(invite.sendError).toBeTruthy();
  });

  it('refuses when nobody is eligible', async () => {
    const res = await request(app).post('/api/admin/cbat-passers/send').set('Cookie', cookie).send({});
    expect(res.status).toBe(400);
  });
});

describe('GET /api/admin/cbat-passers/preview', () => {
  it('renders the email without creating an invite', async () => {
    await candidate();
    const res = await request(app).get('/api/admin/cbat-passers/preview').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.subject).toBeTruthy();
    expect(res.body.data.html).toContain('Classified Transmission');
    expect(await SurveyInvite.countDocuments()).toBe(0);
  });

  it('still renders with an empty cohort, flagged as a placeholder', async () => {
    const res = await request(app).get('/api/admin/cbat-passers/preview').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.isPlaceholder).toBe(true);
  });
});

describe('deferred candidates', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('is held out of the list while the deferral stands', async () => {
    const u = await candidate();
    await request(app).post('/api/admin/cbat-passers/send').set('Cookie', cookie).send({});
    await SurveyInvite.updateOne({ userId: u._id }, { deferredUntil: new Date(Date.now() + 30 * DAY) });

    const res = await getList();
    const row = res.body.data.groups.flatMap(g => g.users).find(x => x.email === u.email);
    expect(row.mailable).toBe(false);
    expect(res.body.data.nextBatchIds).toHaveLength(0);
    expect(res.body.data.totals.deferred).toBe(1);
  });

  it('returns to the pool once the date has passed', async () => {
    const u = await candidate();
    await request(app).post('/api/admin/cbat-passers/send').set('Cookie', cookie).send({});
    await SurveyInvite.updateOne({ userId: u._id }, { deferredUntil: new Date(Date.now() - DAY) });

    const res = await getList();
    const row = res.body.data.groups.flatMap(g => g.users).find(x => x.email === u.email);
    expect(row.mailable).toBe(true);
    expect(res.body.data.nextBatchIds.map(String)).toContain(row._id.toString());
  });

  it('reuses the same invite and token on the follow-up, keeping their answers', async () => {
    const u = await candidate();
    await request(app).post('/api/admin/cbat-passers/send').set('Cookie', cookie).send({});
    const before = await SurveyInvite.findOne({ userId: u._id });

    // They said "not yet"; the date has now come round.
    await SurveyInvite.updateOne({ _id: before._id }, { deferredUntil: new Date(Date.now() - DAY) });

    const res = await request(app).post('/api/admin/cbat-passers/send').set('Cookie', cookie).send({});
    expect(res.body.data.sentCount).toBe(1);

    const after = await SurveyInvite.findOne({ userId: u._id });
    expect(await SurveyInvite.countDocuments()).toBe(1); // reused, not duplicated
    expect(after.token).toBe(before.token);              // their old link still works
    expect(after.sendCount).toBe(2);
    expect(after.deferredUntil).toBeNull();              // the wait has been served
  });

  it('does not resend to someone who simply ignored the first email', async () => {
    const u = await candidate();
    await request(app).post('/api/admin/cbat-passers/send').set('Cookie', cookie).send({});

    const res = await getList();
    const row = res.body.data.groups.flatMap(g => g.users).find(x => x.email === u.email);
    expect(row.mailable).toBe(false);
  });

  it('does not resend to someone who opted out, even past their deferral', async () => {
    const u = await candidate();
    await request(app).post('/api/admin/cbat-passers/send').set('Cookie', cookie).send({});
    await SurveyInvite.updateOne(
      { userId: u._id },
      { deferredUntil: new Date(Date.now() - DAY), optedOutAt: new Date() },
    );

    const res = await getList();
    const row = res.body.data.groups.flatMap(g => g.users).find(x => x.email === u.email);
    expect(row.mailable).toBe(false);
  });

  it('retries a failed send without creating a second invite', async () => {
    await candidate();
    const { __batchMock } = require('resend');
    __batchMock.mockResolvedValueOnce({ data: { data: [{}] }, error: null });
    await request(app).post('/api/admin/cbat-passers/send').set('Cookie', cookie).send({});

    const retry = await request(app).post('/api/admin/cbat-passers/send').set('Cookie', cookie).send({});
    expect(retry.body.data.sentCount).toBe(1);
    expect(await SurveyInvite.countDocuments()).toBe(1);
  });
});

describe('POST /api/admin/cbat-passers/test — the dry run', () => {
  it('mails the admin the real email', async () => {
    const { __batchMock } = require('resend');
    __batchMock.mockClear();

    const res = await request(app).post('/api/admin/cbat-passers/test').set('Cookie', cookie).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.sentTo).toBe(admin.email);

    const [messages] = __batchMock.mock.calls[0];
    const invite = await SurveyInvite.findOne({ isTest: true });
    expect(messages[0].to).toBe(admin.email);
    expect(messages[0].html).toContain(`/survey/${invite.token}`);
  });

  it('is invisible to the real campaign', async () => {
    await candidate();
    await request(app).post('/api/admin/cbat-passers/test').set('Cookie', cookie).send({});

    const res = await getList();
    // The dry run neither adds a candidate nor marks anyone as emailed.
    expect(res.body.data.totals.emailed).toBe(0);
    expect(res.body.data.totals.remaining).toBe(1);

    const answers = await request(app).get('/api/admin/cbat-passers/responses').set('Cookie', cookie);
    expect(answers.body.data.summary.invitesSent).toBe(0);
  });

  it('can be run again and again, replacing the last one', async () => {
    await request(app).post('/api/admin/cbat-passers/test').set('Cookie', cookie).send({});
    const first = await SurveyInvite.findOne({ isTest: true });

    await request(app).post('/api/admin/cbat-passers/test').set('Cookie', cookie).send({});
    const all = await SurveyInvite.find({ isTest: true });

    expect(all).toHaveLength(1);
    expect(all[0].token).not.toBe(first.token); // a fresh, unwalked run
  });

  it('never writes to the account behind it', async () => {
    await request(app).post('/api/admin/cbat-passers/test').set('Cookie', cookie).send({});
    const invite = await SurveyInvite.findOne({ isTest: true });

    // Walk the flow the way an admin checking it would.
    await request(app).patch(`/api/survey/${invite.token}`).send({ satTest: true });
    const res = await request(app).patch(`/api/survey/${invite.token}`).send({ passedForRole: 'yes' });

    // The screen still congratulates them, so the closing card can be reviewed…
    expect(res.body.data.badgeAwarded).toBe(true);
    // …but the badge is not actually awarded.
    expect((await User.findById(admin._id)).cbatPassed).toBe(false);
  });

  it('does not unsubscribe the admin who tests the opt-out link', async () => {
    await request(app).post('/api/admin/cbat-passers/test').set('Cookie', cookie).send({});
    const invite = await SurveyInvite.findOne({ isTest: true });

    await request(app).post(`/api/survey/${invite.token}/opt-out`);

    expect((await User.findById(admin._id)).researchEmailOptOut?.at ?? null).toBeNull();
    // The page still shows the confirmation, so it can be checked.
    expect((await SurveyInvite.findById(invite._id)).optedOutAt).toBeTruthy();
  });

  it('403s for a non-admin', async () => {
    const plain = await createUser();
    const res = await request(app).post('/api/admin/cbat-passers/test')
      .set('Cookie', authCookie(plain._id)).send({});
    expect(res.status).toBe(403);
  });
});
