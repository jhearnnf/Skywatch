/**
 * cbat-passers-auto-send.test.js
 *
 * The opt-in auto-send for the CBAT outcome questionnaire (utils/surveyAutoSend.js).
 *
 * Coverage:
 *   - Off by default: nothing is sent
 *   - On: sends the same batch the button would, and records the result
 *   - At most once per interval, and never twice for one run (the claim)
 *   - Never mails the same person twice across runs
 *   - Refuses on a local CLIENT_URL even with ALLOW_LOCAL_EMAIL_LINKS on
 *   - Paused while the questionnaire is closed
 *   - The admin list reports the switch, last run and next run
 */

process.env.JWT_SECRET = 'test_secret';
process.env.CLIENT_URL = 'https://skywatch.academy';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createSettings, createAdminUser, createUser, authCookie } = require('../helpers/factories');

const GameSessionCbatTargetResult = require('../../models/GameSessionCbatTargetResult');
const SurveyInvite = require('../../models/SurveyInvite');
const AppSettings  = require('../../models/AppSettings');
const User         = require('../../models/User');
const { runSurveyAutoSend } = require('../../utils/surveyAutoSend');

const DAY  = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);

async function candidate({ completions = 20, days = 30 } = {}) {
  const u = await createUser();
  await GameSessionCbatTargetResult.insertMany(
    Array.from({ length: completions }, () => ({ userId: u._id, totalScore: 500, totalTime: 120, createdAt: daysAgo(days) })),
  );
  await User.updateOne({ _id: u._id }, { lastSeen: daysAgo(days) });
  return u;
}

const switchOn = () => AppSettings.updateOne({}, { cbatSurveyAutoSendEnabled: true });
const batchMock = () => require('resend').__batchMock;

beforeAll(async () => { await db.connect(); });
afterEach(async () => {
  await db.clearDatabase();
  process.env.CLIENT_URL = 'https://skywatch.academy';
  delete process.env.ALLOW_LOCAL_EMAIL_LINKS;
});
afterAll(async () => { await db.closeDatabase(); });
beforeEach(async () => {
  await createSettings();
  batchMock().mockClear();
});

describe('surveyAutoSend', () => {
  it('sends nothing while switched off (the default)', async () => {
    await candidate();
    expect(await runSurveyAutoSend()).toEqual({ skipped: 'off' });
    expect(await SurveyInvite.countDocuments()).toBe(0);
    expect(batchMock()).not.toHaveBeenCalled();
  });

  it('when on, sends the next batch and records what it did', async () => {
    const u = await candidate();
    await switchOn();

    const out = await runSurveyAutoSend();
    expect(out.sentCount).toBe(1);
    expect(out.sent).toEqual([u.email]);

    const invite = await SurveyInvite.findOne({ userId: u._id });
    expect(invite.sentAt).toBeTruthy();

    const s = await AppSettings.findOne();
    expect(s.cbatSurveyAutoSendLastAt).toBeTruthy();
    expect(s.cbatSurveyAutoSendLastResult.sentCount).toBe(1);
  });

  it('runs at most once per interval, however often it is checked', async () => {
    await candidate();
    await switchOn();
    const t0 = new Date();

    await runSurveyAutoSend({ now: t0 });
    await candidate({ days: 31 });
    expect(await runSurveyAutoSend({ now: new Date(t0.getTime() + 47 * HOUR) })).toEqual({ skipped: 'not-due' });

    const later = await runSurveyAutoSend({ now: new Date(t0.getTime() + 48 * HOUR) });
    expect(later.sentCount).toBe(1);
  });

  it('two checks racing claim the run once', async () => {
    await candidate();
    await switchOn();
    const now = new Date();
    const results = await Promise.all([runSurveyAutoSend({ now }), runSurveyAutoSend({ now })]);
    expect(results.filter(r => r.skipped === 'not-due')).toHaveLength(1);
    expect(batchMock()).toHaveBeenCalledTimes(1);
  });

  it('never mails the same person twice across runs', async () => {
    await candidate();
    await switchOn();
    const t0 = new Date();
    await runSurveyAutoSend({ now: t0 });
    const second = await runSurveyAutoSend({ now: new Date(t0.getTime() + 49 * HOUR) });
    expect(second.sentCount).toBe(0);
    expect(await SurveyInvite.countDocuments()).toBe(1);
    expect(batchMock()).toHaveBeenCalledTimes(1);
  });

  it('refuses a local CLIENT_URL even with the local-links override on', async () => {
    await candidate();
    await switchOn();
    process.env.CLIENT_URL = 'http://localhost:5173';
    process.env.ALLOW_LOCAL_EMAIL_LINKS = 'true';

    expect(await runSurveyAutoSend()).toEqual({ skipped: 'link' });
    expect(await SurveyInvite.countDocuments()).toBe(0);
    // Not claimed either, so the live server still sends on time.
    expect((await AppSettings.findOne()).cbatSurveyAutoSendLastAt).toBeNull();
  });

  it('pauses while the questionnaire is closed', async () => {
    await candidate();
    await AppSettings.updateOne({}, { cbatSurveyAutoSendEnabled: true, cbatSurveyEnabled: false });
    expect(await runSurveyAutoSend()).toEqual({ skipped: 'closed' });
    expect(await SurveyInvite.countDocuments()).toBe(0);
  });

  it('is reported on the admin list', async () => {
    const admin = await createAdminUser();
    await switchOn();
    await runSurveyAutoSend();

    const res = await request(app).get('/api/admin/cbat-passers').set('Cookie', authCookie(admin._id));
    expect(res.status).toBe(200);
    expect(res.body.data.autoSend).toMatchObject({ enabled: true, intervalHours: 48 });
    expect(res.body.data.autoSend.lastAt).toBeTruthy();
    expect(res.body.data.autoSend.nextAt).toBeTruthy();
  });
});
