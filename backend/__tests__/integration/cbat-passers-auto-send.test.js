/**
 * cbat-passers-auto-send.test.js
 *
 * The opt-in auto-send for the CBAT outcome questionnaire (utils/surveyAutoSend.js).
 *
 * Coverage:
 *   - Off by default: nothing is sent
 *   - On: sends the same batch the button would, and records the result
 *   - At most once per interval, and never twice for one run (the claim)
 *   - Fixed UK hours that rotate 09 -> 13 -> 18 -> 22, BST-aware, never late
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
const { runSurveyAutoSend, nextAutoSendSlot, ukWallClockToDate } = require('../../utils/surveyAutoSend');

const DAY  = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);
// 09:00 UK on a GMT day: the first slot's hour, so a fresh switch-on is due.
const NINE_AM = new Date('2026-11-17T09:00:00Z');
const at = (iso) => new Date(iso);

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

    const out = await runSurveyAutoSend({ now: NINE_AM });
    expect(out.sentCount).toBe(1);
    expect(out.slotHour).toBe(9);
    expect(out.sent).toEqual([u.email]);

    const invite = await SurveyInvite.findOne({ userId: u._id });
    expect(invite.sentAt).toBeTruthy();

    const s = await AppSettings.findOne();
    expect(s.cbatSurveyAutoSendLastAt).toBeTruthy();
    expect(s.cbatSurveyAutoSendLastResult.sentCount).toBe(1);
    expect(s.cbatSurveyAutoSendSlot).toBe(0);
  });

  it('runs at most once per interval, however often it is checked', async () => {
    await candidate();
    await switchOn();
    await runSurveyAutoSend({ now: NINE_AM });
    await candidate({ days: 31 });

    // Two UK days on, the next slot is 13:00: not before.
    expect(await runSurveyAutoSend({ now: at('2026-11-19T09:00:00Z') })).toEqual({ skipped: 'not-due' });
    expect(await runSurveyAutoSend({ now: at('2026-11-19T12:59:00Z') })).toEqual({ skipped: 'not-due' });

    const later = await runSurveyAutoSend({ now: at('2026-11-19T13:04:00Z') });
    expect(later.sentCount).toBe(1);
    expect(later.slotHour).toBe(13);
  });

  it('two checks racing claim the run once', async () => {
    await candidate();
    await switchOn();
    const now = NINE_AM;
    const results = await Promise.all([runSurveyAutoSend({ now }), runSurveyAutoSend({ now })]);
    expect(results.filter(r => r.skipped === 'not-due')).toHaveLength(1);
    expect(batchMock()).toHaveBeenCalledTimes(1);
  });

  it('never mails the same person twice across runs', async () => {
    await candidate();
    await switchOn();
    await runSurveyAutoSend({ now: NINE_AM });
    const second = await runSurveyAutoSend({ now: at('2026-11-19T13:00:00Z') });
    expect(second.sentCount).toBe(0);
    expect(await SurveyInvite.countDocuments()).toBe(1);
    expect(batchMock()).toHaveBeenCalledTimes(1);
  });

  it('refuses a local CLIENT_URL even with the local-links override on', async () => {
    await candidate();
    await switchOn();
    process.env.CLIENT_URL = 'http://localhost:5173';
    process.env.ALLOW_LOCAL_EMAIL_LINKS = 'true';

    expect(await runSurveyAutoSend({ now: NINE_AM })).toEqual({ skipped: 'link' });
    expect(await SurveyInvite.countDocuments()).toBe(0);
    // Not claimed either, so the live server still sends on time.
    expect((await AppSettings.findOne()).cbatSurveyAutoSendLastAt).toBeNull();
  });

  it('pauses while the questionnaire is closed', async () => {
    await candidate();
    await AppSettings.updateOne({}, { cbatSurveyAutoSendEnabled: true, cbatSurveyEnabled: false });
    expect(await runSurveyAutoSend({ now: NINE_AM })).toEqual({ skipped: 'closed' });
    expect(await SurveyInvite.countDocuments()).toBe(0);
  });

  it('is reported on the admin list', async () => {
    const admin = await createAdminUser();
    await switchOn();
    await runSurveyAutoSend({ now: NINE_AM });

    const res = await request(app).get('/api/admin/cbat-passers').set('Cookie', authCookie(admin._id));
    expect(res.status).toBe(200);
    expect(res.body.data.autoSend).toMatchObject({ enabled: true, intervalHours: 48, hoursUk: [9, 13, 18, 22] });
    expect(res.body.data.autoSend.lastAt).toBeTruthy();
    expect(res.body.data.autoSend.nextAt).toBeTruthy();
  });

  it('steps through every slot in turn, then wraps', async () => {
    await switchOn();
    const hours = [];
    let day = 17;
    for (const h of [9, 13, 18, 22, 9]) {
      const now = at(`2026-11-${day}T${String(h).padStart(2, '0')}:00:00Z`);
      // eslint-disable-next-line no-await-in-loop
      const out = await runSurveyAutoSend({ now });
      hours.push(out.slotHour);
      day += 2;
    }
    expect(hours).toEqual([9, 13, 18, 22, 9]);
  });

  it('does not fire before the slot hour when first switched on', async () => {
    await candidate();
    await switchOn();
    expect(await runSurveyAutoSend({ now: at('2026-11-17T08:30:00Z') })).toEqual({ skipped: 'not-due' });
    expect(await SurveyInvite.countDocuments()).toBe(0);
  });

  it('a missed slot moves to the same hour the next day instead of firing late', async () => {
    await candidate();
    await switchOn();
    // 09:00 slot today, but the server only checks at 15:00: past the grace window.
    expect(await runSurveyAutoSend({ now: at('2026-11-17T15:00:00Z') })).toEqual({ skipped: 'not-due' });
    const next = await runSurveyAutoSend({ now: at('2026-11-18T09:01:00Z') });
    expect(next.sentCount).toBe(1);
    expect(next.slotHour).toBe(9);
  });

  it('a check inside the grace window still sends', async () => {
    await candidate();
    await switchOn();
    const out = await runSurveyAutoSend({ now: at('2026-11-17T10:30:00Z') });
    expect(out.sentCount).toBe(1);
  });
});

describe('send-time slots', () => {
  it('reads the hour as UK time across BST', () => {
    // Summer: 13:00 BST is 12:00 UTC. Winter: 13:00 GMT is 13:00 UTC.
    expect(ukWallClockToDate('2026-07-01', 13).toISOString()).toBe('2026-07-01T12:00:00.000Z');
    expect(ukWallClockToDate('2026-12-01', 13).toISOString()).toBe('2026-12-01T13:00:00.000Z');
    // Clock-change days.
    expect(ukWallClockToDate('2026-03-29', 9).toISOString()).toBe('2026-03-29T08:00:00.000Z');
    expect(ukWallClockToDate('2026-10-25', 9).toISOString()).toBe('2026-10-25T09:00:00.000Z');
  });

  it('schedules two UK days after the last run, at the next hour in the rotation', () => {
    const settings = {
      cbatSurveyAutoSendLastAt: at('2026-11-15T22:48:00Z'),
      cbatSurveyAutoSendSlot: 3, // 22:00 was the last slot, so the rotation wraps to 09:00
    };
    const next = nextAutoSendSlot(settings, at('2026-11-16T12:00:00Z'));
    expect(next).toMatchObject({ slot: 0, hour: 9 });
    expect(next.at.toISOString()).toBe('2026-11-17T09:00:00.000Z');
  });

  it('starts at the first slot when it has never run', () => {
    // Settings saved before the rotation existed: a lastAt but no slot.
    const next = nextAutoSendSlot({ cbatSurveyAutoSendLastAt: at('2026-11-15T22:48:00Z') }, at('2026-11-17T08:00:00Z'));
    expect(next).toMatchObject({ slot: 0, hour: 9 });
    expect(next.at.toISOString()).toBe('2026-11-17T09:00:00.000Z');
  });
});
