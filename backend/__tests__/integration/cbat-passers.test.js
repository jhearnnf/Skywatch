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
 *   - A threshold typed below the warm band lowers the list floor with it
 *   - Named, bot, admin, banned and opted-out exclusions
 *   - Grouping by the day of the last finished run
 *   - Send: invites created, emails batched, rows stamped
 *   - Send is idempotent — a second send cannot mail the same person twice
 *   - Preview renders without creating an invite
 *   - A send is refused outright when the links would be dead in the inbox
 *   - A delivered-but-broken link puts someone back in the list, at the front
 *   - The apology copy is a separate email, chosen per send
 *   - A deferred "not yet" respondent is held, then returns to the pool
 */

process.env.JWT_SECRET = 'test_secret';
// The sender refuses to build an email whose links point at the machine that
// sent it, so the suite has to look like a real deployment. The guard's own
// tests put a local URL back for the length of one assertion.
process.env.CLIENT_URL = 'https://skywatch.academy';

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
const { SURVEY_CAMPAIGN }         = require('../../constants/survey');
const { SURVEY_DEFAULTS, SURVEY_APOLOGY_DEFAULTS } = require('../../utils/surveyEmail');
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

  // The warm band is a floor on the default view, not a hard minimum. A
  // threshold typed below it has to actually take effect, or every value the
  // input accepts under 14 would silently return nobody.
  it('lists a 3-day gap when the threshold is dropped to 2 days', async () => {
    const u = await candidate({ days: 3 });

    expect(namesIn((await getList()).body)).not.toContain(u.email);

    const res = await getList('?dormantDays=2');
    const row = res.body.data.groups.flatMap(g => g.users).find(x => x.email === u.email);
    expect(row).toBeDefined();
    expect(row.band).toBe('ready'); // past the threshold, so nothing is held back
    expect(res.body.data.thresholds.listedFromDays).toBe(2);
    expect(res.body.data.nextBatchIds.map(String)).toContain(row._id.toString());
  });

  it('still keeps the warm band when the threshold is above it', async () => {
    const u = await candidate({ days: 16 });
    const res = await getList('?dormantDays=21');
    expect(res.body.data.thresholds.listedFromDays).toBe(14);
    expect(namesIn(res.body)).toContain(u.email);
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

// The search box exists because the thresholds are averages: right about a
// population, wrong about individuals. It has to find the people the list
// deliberately never returns, and the send has to accept them.
describe('GET /api/admin/cbat-passers/search', () => {
  const searchFor = (q) =>
    request(app).get(`/api/admin/cbat-passers/search?q=${encodeURIComponent(q)}`).set('Cookie', cookie);

  const hitFor = (body, email) => body.data.users.find(u => u.email === email);

  it('401s without a cookie', async () => {
    const res = await request(app).get('/api/admin/cbat-passers/search?q=someone');
    expect(res.status).toBe(401);
  });

  it('finds a listed candidate by part of their address', async () => {
    const u = await candidate({ email: 'findable.person@test.com' });
    const res = await searchFor('findable');
    expect(res.status).toBe(200);
    const hit = hitFor(res.body, u.email);
    expect(hit).toBeDefined();
    expect(hit.excludedReason).toBeNull();
    expect(hit.mailable).toBe(true);
    expect(hit.completions).toBe(12);
  });

  it('finds someone on the do-not-contact list, and still lets them be mailed', async () => {
    const u = await candidate({ email: 'andreaspaschalis@gmail.com' });

    // Not in the list itself...
    expect(namesIn((await getList()).body)).not.toContain(u.email);

    // ...but findable, with the reason spelled out, and tickable.
    const hit = hitFor((await searchFor('andreaspaschalis')).body, u.email);
    expect(hit).toBeDefined();
    expect(hit.excludedReason).toBe('named');
    expect(hit.mailable).toBe(true);
  });

  it('finds someone under the thresholds and says which one they miss', async () => {
    const quiet  = await candidate({ completions: 3 });
    const active = await candidate({ completions: 20, days: 1 });

    expect(hitFor((await searchFor(quiet.email)).body, quiet.email).excludedReason)
      .toBe('below-min-games');
    expect(hitFor((await searchFor(active.email)).body, active.email).excludedReason)
      .toBe('still-active');
  });

  it('finds by display name and by agent number', async () => {
    const u = await candidate({ displayName: 'Wing Commander Bob' });
    expect(hitFor((await searchFor('wing commander')).body, u.email)).toBeDefined();
    expect(hitFor((await searchFor(u.agentNumber)).body, u.email)).toBeDefined();
  });

  it('will not offer a banned, bot or unsubscribed account', async () => {
    const bot    = await candidate({ email: 'blocked.bot@test.com',    isBot: true });
    const banned = await candidate({ email: 'blocked.banned@test.com', isBanned: true });
    const gone   = await candidate({ email: 'blocked.gone@test.com' });
    await User.updateOne({ _id: gone._id }, { researchEmailOptOut: { at: new Date(), reason: null, campaign: 'x' } });

    const res = await searchFor('blocked.');
    for (const [email, reason] of [
      [bot.email, 'bot'], [banned.email, 'banned'], [gone.email, 'opted-out'],
    ]) {
      const hit = hitFor(res.body, email);
      expect(hit.excludedReason).toBe(reason);
      expect(hit.mailable).toBe(false);
    }
  });

  it('treats punctuation in the query as text, not as a pattern', async () => {
    const u = await candidate({ email: 'dots.and+plus@test.com' });
    const res = await searchFor('dots.and+plus');
    expect(res.status).toBe(200);
    expect(hitFor(res.body, u.email)).toBeDefined();
  });

  it('answers an empty query with nothing rather than everyone', async () => {
    await candidate();
    const res = await request(app).get('/api/admin/cbat-passers/search?q=a').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.users).toEqual([]);
  });
});

describe('POST /api/admin/cbat-passers/send — hand-picked from the search', () => {
  it('mails someone the list would never have offered', async () => {
    const u = await candidate({ email: 'andreaspaschalis@gmail.com' });

    const res = await request(app)
      .post('/api/admin/cbat-passers/send')
      .set('Cookie', cookie)
      .send({ userIds: [u._id.toString()] });

    expect(res.status).toBe(200);
    expect(res.body.data.sent).toContain(u.email);
    expect((await SurveyInvite.findOne({ userId: u._id })).sentAt).toBeTruthy();
  });

  it('mails someone under the games threshold when picked by hand', async () => {
    const u = await candidate({ completions: 2 });
    const res = await request(app)
      .post('/api/admin/cbat-passers/send')
      .set('Cookie', cookie)
      .send({ userIds: [u._id.toString()] });
    expect(res.body.data.sent).toContain(u.email);
  });

  it('still refuses an unsubscribed account, however it was picked', async () => {
    const u = await candidate();
    await User.updateOne({ _id: u._id }, { researchEmailOptOut: { at: new Date(), reason: null, campaign: 'x' } });

    const res = await request(app)
      .post('/api/admin/cbat-passers/send')
      .set('Cookie', cookie)
      .send({ userIds: [u._id.toString()] });

    expect(res.status).toBe(400);
    expect(await SurveyInvite.countDocuments()).toBe(0);
  });

  it('still refuses to mail the same person twice', async () => {
    const u = await candidate({ email: 'karatekiddnb@gmail.com' });
    const body = { userIds: [u._id.toString()] };

    expect((await request(app).post('/api/admin/cbat-passers/send').set('Cookie', cookie).send(body)).status).toBe(200);
    expect((await request(app).post('/api/admin/cbat-passers/send').set('Cookie', cookie).send(body)).status).toBe(400);
    expect(await SurveyInvite.countDocuments()).toBe(1);
  });

  it('ignores an id that is not an id rather than blowing up', async () => {
    const u = await candidate();
    const res = await request(app)
      .post('/api/admin/cbat-passers/send')
      .set('Cookie', cookie)
      .send({ userIds: ['not-an-object-id', u._id.toString()] });

    expect(res.status).toBe(200);
    expect(res.body.data.sentCount).toBe(1);
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

describe('GET /api/admin/cbat-passers/responses — the results page', () => {
  const answer = (token, body) => request(app).patch(`/api/survey/${token}`).send(body);

  const invited = async () => {
    const u = await candidate();
    await request(app).post('/api/admin/cbat-passers/send').set('Cookie', cookie).send({});
    const invite = await SurveyInvite.findOne({ userId: u._id });
    return { user: u, invite };
  };

  it('names who unsubscribed, which the recipient list cannot', async () => {
    const { user, invite } = await invited();
    await request(app).post(`/api/survey/${invite.token}/opt-out`);
    await request(app).patch(`/api/survey/${invite.token}/opt-out`)
      .send({ reason: 'too_many_emails', passedForRole: 'yes' });

    // Gone from the recipient list entirely — that query excludes opt-outs.
    const list = await getList();
    expect(namesIn(list.body)).not.toContain(user.email);

    // …but present, by name and with their reason, in the results.
    const res = await request(app).get('/api/admin/cbat-passers/responses').set('Cookie', cookie);
    expect(res.body.data.optedOut).toHaveLength(1);
    expect(res.body.data.optedOut[0]).toEqual(expect.objectContaining({
      email: user.email,
      reason: 'too_many_emails',
      passedForRole: 'yes',
    }));
  });

  it('records an unsubscribe with no reason as exactly that', async () => {
    const { invite } = await invited();
    await request(app).post(`/api/survey/${invite.token}/opt-out`);

    const res = await request(app).get('/api/admin/cbat-passers/responses').set('Cookie', cookie);
    expect(res.body.data.optedOut[0].reason).toBeNull();
  });

  it('lists who is waiting to sit it, with their date', async () => {
    const { user, invite } = await invited();
    const booked = new Date(Date.now() + 30 * DAY);
    await answer(invite.token, { satTest: false });
    await answer(invite.token, { testBookedFor: booked.toISOString() });

    const res = await request(app).get('/api/admin/cbat-passers/responses').set('Cookie', cookie);
    const row = res.body.data.deferred[0];
    expect(row.email).toBe(user.email);
    expect(new Date(row.testBookedFor).toDateString()).toBe(booked.toDateString());
    expect(row.due).toBe(false);
  });

  it('flags a deferral that has run out as due', async () => {
    const { invite } = await invited();
    await answer(invite.token, { satTest: false });
    await SurveyInvite.updateOne({ _id: invite._id }, { deferredUntil: new Date(Date.now() - DAY) });

    const res = await request(app).get('/api/admin/cbat-passers/responses').set('Cookie', cookie);
    expect(res.body.data.deferred[0].due).toBe(true);
  });

  it('keeps an unsubscriber out of the waiting list even if they were deferred', async () => {
    const { invite } = await invited();
    await answer(invite.token, { satTest: false });
    await request(app).post(`/api/survey/${invite.token}/opt-out`);

    const res = await request(app).get('/api/admin/cbat-passers/responses').set('Cookie', cookie);
    expect(res.body.data.deferred).toHaveLength(0);
    expect(res.body.data.optedOut).toHaveLength(1);
  });

  it('returns a partial run alongside the finished ones', async () => {
    const { invite } = await invited();
    await answer(invite.token, { satTest: true, passedForRole: 'yes' });

    const res = await request(app).get('/api/admin/cbat-passers/responses').set('Cookie', cookie);
    expect(res.body.data.responses).toHaveLength(1);
    expect(res.body.data.responses[0].passedForRole).toBe('yes');
    expect(res.body.data.summary.completed).toBe(0);   // they stopped partway
    expect(res.body.data.summary.started).toBe(1);
  });

  it('counts opens for the funnel', async () => {
    const { invite } = await invited();
    await request(app).get(`/api/survey/${invite.token}`);

    const res = await request(app).get('/api/admin/cbat-passers/responses').set('Cookie', cookie);
    expect(res.body.data.summary.opened).toBe(1);
    expect(res.body.data.summary.invitesSent).toBe(1);
  });

  it('ignores the admin dry run entirely', async () => {
    await request(app).post('/api/admin/cbat-passers/test').set('Cookie', cookie).send({});
    const invite = await SurveyInvite.findOne({ isTest: true });
    await request(app).post(`/api/survey/${invite.token}/opt-out`);

    const res = await request(app).get('/api/admin/cbat-passers/responses').set('Cookie', cookie);
    expect(res.body.data.optedOut).toHaveLength(0);
    expect(res.body.data.summary.invitesSent).toBe(0);
  });
});

describe('comments on the results endpoint', () => {
  it('surfaces them separately from the gaps answers', async () => {
    const u = await candidate();
    await request(app).post('/api/admin/cbat-passers/send').set('Cookie', cookie).send({});
    const invite = await SurveyInvite.findOne({ userId: u._id });

    await request(app).patch(`/api/survey/${invite.token}`).send({
      satTest: true, role: 'pilot', passedForRole: 'yes',
      gaps: 'A test we had not seen.', comment: 'Genuinely helped, thank you.',
    });

    const res = await request(app).get('/api/admin/cbat-passers/responses').set('Cookie', cookie);
    expect(res.body.data.summary.gaps).toHaveLength(1);
    expect(res.body.data.summary.comments).toHaveLength(1);
    expect(res.body.data.summary.comments[0]).toEqual(expect.objectContaining({
      comment: 'Genuinely helped, thank you.',
      role: 'pilot',
      passedForRole: 'yes',
    }));
  });

  it('leaves comments empty when nobody wrote one', async () => {
    const u = await candidate();
    await request(app).post('/api/admin/cbat-passers/send').set('Cookie', cookie).send({});
    const invite = await SurveyInvite.findOne({ userId: u._id });
    await request(app).patch(`/api/survey/${invite.token}`).send({ satTest: true });

    const res = await request(app).get('/api/admin/cbat-passers/responses').set('Cookie', cookie);
    expect(res.body.data.summary.comments).toHaveLength(0);
  });
});

// ── The 2026-09-03 regression ──────────────────────────────────────────────
//
// Fifty-one people were emailed a link to http://localhost:5173, because the
// backend that sent the batch was a development machine. Nothing in the code
// objected: the send succeeded, the invites were stamped as delivered, and the
// rule that stops anyone being mailed twice then made those people permanently
// unreachable for the campaign. Three things had to change, and all three are
// pinned here.
describe('a send whose links would be dead in the inbox', () => {
  const withClientUrl = async (url, fn) => {
    const before = process.env.CLIENT_URL;
    process.env.CLIENT_URL = url;
    try { await fn(); } finally { process.env.CLIENT_URL = before; }
  };

  it('is refused, and mails nobody', async () => {
    await candidate();
    const { __batchMock, __sendMock } = require('resend');
    __batchMock.mockClear();
    __sendMock.mockClear();

    await withClientUrl('http://localhost:5173', async () => {
      const res = await request(app)
        .post('/api/admin/cbat-passers/send').set('Cookie', cookie).send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/points at this machine/i);
    });

    // Not "the wrong email went out" — nothing went out, and no invite row was
    // left behind to block the working one that follows.
    expect(__batchMock).not.toHaveBeenCalled();
    expect(__sendMock).not.toHaveBeenCalled();
    expect(await SurveyInvite.countDocuments({})).toBe(0);
  });

  it('is refused for a plain http host too, not only for localhost', async () => {
    await candidate();
    await withClientUrl('http://skywatch.academy', async () => {
      const res = await request(app)
        .post('/api/admin/cbat-passers/send').set('Cookie', cookie).send({});
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/not https/i);
    });
  });

  it('tells the list itself, so it is visible before the button is pressed', async () => {
    await candidate();
    await withClientUrl('http://localhost:5173', async () => {
      const res = await request(app).get('/api/admin/cbat-passers').set('Cookie', cookie);
      expect(res.body.data.linkProblem).toMatch(/points at this machine/i);
    });

    const ok = await request(app).get('/api/admin/cbat-passers').set('Cookie', cookie);
    expect(ok.body.data.linkProblem).toBeNull();
  });

  it('refuses the admin dry run on the same rule', async () => {
    await withClientUrl('http://localhost:5173', async () => {
      const res = await request(app)
        .post('/api/admin/cbat-passers/test').set('Cookie', cookie).send({});
      expect(res.status).toBe(400);
    });
  });
});

describe('someone who was mailed a link that did not work', () => {
  // The state scripts/flagBrokenSurveyLinks.js leaves behind: a delivered
  // invite, flagged from the delivered message Resend still holds.
  async function owed(overrides = {}) {
    const u = await candidate(overrides);
    await request(app).post('/api/admin/cbat-passers/send').set('Cookie', cookie).send({});
    await SurveyInvite.updateOne(
      { userId: u._id, campaign: SURVEY_CAMPAIGN },
      { $set: { brokenLinkAt: new Date() } },
    );
    return u;
  }

  it('can be mailed again, though an ordinary delivered invite cannot', async () => {
    const u = await owed();

    const res = await request(app).get('/api/admin/cbat-passers').set('Cookie', cookie);
    const row = res.body.data.groups.flatMap(g => g.users).find(r => r._id === u._id.toString());

    expect(row.needsResend).toBe(true);
    expect(row.mailable).toBe(true);
    expect(res.body.data.totals.needsResend).toBe(1);
    expect(res.body.data.nextBatchIds.map(String)).toContain(u._id.toString());
  });

  it('is listed even when the thresholds have moved past them', async () => {
    const u = await owed({ completions: 12, days: 30 });

    // A cut nobody could satisfy. The debt is not conditional on an admin
    // leaving the sliders where they were when the bad send happened.
    const res = await request(app)
      .get('/api/admin/cbat-passers?minCompletions=999&dormantDays=999')
      .set('Cookie', cookie);

    const ids = res.body.data.groups.flatMap(g => g.users).map(r => r._id);
    expect(ids).toContain(u._id.toString());
  });

  it('goes ahead of people who have heard nothing from us at all', async () => {
    // The untouched candidate has been quiet longer, so on last-played order
    // alone they would sort first. Being owed an email wins.
    const owedUser = await owed({ days: 30 });
    await candidate({ days: 60 });

    const res = await request(app).get('/api/admin/cbat-passers').set('Cookie', cookie);
    expect(res.body.data.nextBatchIds[0]).toBe(owedUser._id.toString());
  });

  it('stops being owed once a send actually goes out', async () => {
    const u = await owed();
    await request(app).post('/api/admin/cbat-passers/send').set('Cookie', cookie)
      .send({ userIds: [u._id.toString()], variant: 'apology' });

    const invite = await SurveyInvite.findOne({ userId: u._id, campaign: SURVEY_CAMPAIGN });
    expect(invite.brokenLinkAt).toBeNull();
    expect(invite.sendCount).toBe(2);
  });

  it('keeps the same token, so the link in the first email starts working', async () => {
    const u = await owed();
    const before = await SurveyInvite.findOne({ userId: u._id, campaign: SURVEY_CAMPAIGN });

    await request(app).post('/api/admin/cbat-passers/send').set('Cookie', cookie)
      .send({ userIds: [u._id.toString()], variant: 'apology' });

    const after = await SurveyInvite.findOne({ userId: u._id, campaign: SURVEY_CAMPAIGN });
    expect(after.token).toBe(before.token);
  });

  it('is left alone if they answered or unsubscribed anyway', async () => {
    const u = await owed();
    await SurveyInvite.updateOne({ userId: u._id }, { $set: { completedAt: new Date() } });

    const res = await request(app).get('/api/admin/cbat-passers').set('Cookie', cookie);
    const row = res.body.data.groups.flatMap(g => g.users).find(r => r._id === u._id.toString());
    expect(row.needsResend).toBe(false);
    expect(row.mailable).toBe(false);
  });
});

describe('choosing which email a batch goes out with', () => {
  const lastMessage = () => {
    const { __batchMock } = require('resend');
    return __batchMock.mock.calls.at(-1)[0][0];
  };

  it('sends the normal invitation by default', async () => {
    await candidate();
    const { __batchMock } = require('resend');
    __batchMock.mockClear();

    await request(app).post('/api/admin/cbat-passers/send').set('Cookie', cookie).send({});
    expect(lastMessage().subject).toBe(SURVEY_DEFAULTS.subject);
  });

  it('sends the apology when it is asked for', async () => {
    await candidate();
    const { __batchMock } = require('resend');
    __batchMock.mockClear();

    await request(app).post('/api/admin/cbat-passers/send').set('Cookie', cookie)
      .send({ variant: 'apology' });

    const msg = lastMessage();
    expect(msg.subject).toBe(SURVEY_APOLOGY_DEFAULTS.subject);
    // Both variants must carry a real, reachable link. That is the entire point
    // of the second one existing.
    expect(msg.html).toMatch(/https:\/\/skywatch\.academy\/survey\/[0-9a-f]{64}/);
    expect(msg.html).not.toMatch(/localhost/);
  });

  it('falls back to the normal email rather than erroring on a variant it does not know', async () => {
    await candidate();
    const res = await request(app).post('/api/admin/cbat-passers/send').set('Cookie', cookie)
      .send({ variant: 'nonsense' });
    expect(res.status).toBe(200);
    expect(res.body.data.variant).toBe('standard');
  });

  it('previews whichever one is selected', async () => {
    await candidate();
    const res = await request(app)
      .get('/api/admin/cbat-passers/preview?variant=apology').set('Cookie', cookie);
    expect(res.body.data.subject).toBe(SURVEY_APOLOGY_DEFAULTS.subject);
    expect(res.body.data.variant).toBe('apology');
  });
});
