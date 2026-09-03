/**
 * survey.test.js
 *
 * The public, token-authenticated CBAT outcome questionnaire.
 *
 * Coverage:
 *   - Token gating: unknown/short tokens 404, no session required
 *   - Progressive saving — a half-answered run is stored, not discarded
 *   - "Yes I passed" sets User.cbatPassed automatically, tagged as self-reported
 *   - A pass for a *different* role counts too
 *   - A later "no" never clears a pass already recorded
 *   - Field whitelisting and validation
 *   - Completion stamps the invite
 *   - Opt-out is honoured immediately and unconditionally, before any question
 *   - Opted-out and closed questionnaires refuse further answers
 *   - "Not yet" defers rather than ends: the booking date is recorded, the
 *     invite is held until it passes, and the run is never marked complete
 */

process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createSettings, createUser } = require('../helpers/factories');

const SurveyInvite   = require('../../models/SurveyInvite');
const SurveyResponse = require('../../models/SurveyResponse');
const User           = require('../../models/User');
const AppSettings    = require('../../models/AppSettings');

let user, invite, token;

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

beforeEach(async () => {
  await createSettings();
  user   = await createUser({ displayName: 'Falcon' });
  token  = SurveyInvite.newToken();
  invite = await SurveyInvite.create({ userId: user._id, token, sentAt: new Date(), sentToEmail: user.email });
});

const get   = () => request(app).get(`/api/survey/${token}`);
const patch = (body) => request(app).patch(`/api/survey/${token}`).send(body);

describe('GET /api/survey/:token', () => {
  it('loads with no session at all', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Falcon');
    expect(res.body.data.roleGroups.length).toBeGreaterThan(0);
  });

  it('falls back to the agent number when there is no display name', async () => {
    const u2 = await createUser();
    const t2 = SurveyInvite.newToken();
    await SurveyInvite.create({ userId: u2._id, token: t2 });
    const res = await request(app).get(`/api/survey/${t2}`);
    expect(res.body.data.name).toBe(`Agent ${u2.agentNumber}`);
  });

  it('404s on an unknown token', async () => {
    const res = await request(app).get(`/api/survey/${SurveyInvite.newToken()}`);
    expect(res.status).toBe(404);
  });

  it('404s on a too-short token without touching the database', async () => {
    const res = await request(app).get('/api/survey/abc');
    expect(res.status).toBe(404);
  });

  it('records the first open only', async () => {
    await get();
    const first = (await SurveyInvite.findById(invite._id)).openedAt;
    expect(first).toBeTruthy();
    await get();
    const second = (await SurveyInvite.findById(invite._id)).openedAt;
    expect(second.getTime()).toBe(first.getTime());
  });

  it('returns answers so far so a reopened link resumes', async () => {
    await patch({ satTest: true, role: 'pilot' });
    const res = await get();
    expect(res.body.data.response.role).toBe('pilot');
  });
});

describe('PATCH /api/survey/:token — progressive saving', () => {
  it('stores a partial run', async () => {
    const res = await patch({ satTest: true });
    expect(res.status).toBe(200);
    const row = await SurveyResponse.findOne({ inviteId: invite._id });
    expect(row.satTest).toBe(true);
    expect(row.completedAt).toBeNull();
  });

  it('keeps an answer given before the person quit', async () => {
    await patch({ satTest: true });
    await patch({ role: 'wso' });
    await patch({ passedForRole: 'yes' });
    // …and they close the tab here, never completing.
    const row = await SurveyResponse.findOne({ inviteId: invite._id });
    expect(row.passedForRole).toBe('yes');
    expect(row.completedAt).toBeNull();
    expect((await SurveyInvite.findById(invite._id)).completedAt).toBeNull();
  });

  it('stamps the invite on completion', async () => {
    await patch({ gaps: 'The SLT had a new layout.', complete: true });
    const updated = await SurveyInvite.findById(invite._id);
    expect(updated.completedAt).toBeTruthy();
    expect(updated.responseId).toBeTruthy();
  });

  it('ignores fields that are not part of the questionnaire', async () => {
    await patch({ satTest: true, isAdmin: true, cbatPassed: true, nonsense: 'x' });
    const row = await SurveyResponse.findOne({ inviteId: invite._id }).lean();
    expect(row.nonsense).toBeUndefined();
    expect((await User.findById(user._id)).isAdmin).toBe(false);
  });

  it('rejects out-of-range ratings by storing null', async () => {
    await patch({ realismRating: 9 });
    const row = await SurveyResponse.findOne({ inviteId: invite._id });
    expect(row.realismRating).toBeNull();
  });

  it('rejects an unknown pass answer', async () => {
    await patch({ passedForRole: 'maybe' });
    const row = await SurveyResponse.findOne({ inviteId: invite._id });
    expect(row.passedForRole).toBeNull();
  });

  it('truncates over-long free text rather than failing', async () => {
    await patch({ gaps: 'x'.repeat(5000) });
    const row = await SurveyResponse.findOne({ inviteId: invite._id });
    expect(row.gaps).toHaveLength(2000);
  });
});

describe('the pass flag', () => {
  it('sets cbatPassed when they say they passed for their role', async () => {
    const res = await patch({ passedForRole: 'yes' });
    expect(res.body.data.badgeAwarded).toBe(true);

    const updated = await User.findById(user._id);
    expect(updated.cbatPassed).toBe(true);
    expect(updated.cbatPassedAt).toBeTruthy();
    expect(updated.cbatPassedSource).toBe('questionnaire');
  });

  it('sets it when they passed for a different role instead', async () => {
    await patch({ passedForRole: 'no' });
    expect((await User.findById(user._id)).cbatPassed).toBe(false);

    await patch({ passedAnyRole: 'yes' });
    expect((await User.findById(user._id)).cbatPassed).toBe(true);
  });

  it('does not set it for a "still waiting" answer', async () => {
    await patch({ passedForRole: 'waiting' });
    expect((await User.findById(user._id)).cbatPassed).toBe(false);
  });

  it('never clears a pass an admin already recorded', async () => {
    await User.updateOne({ _id: user._id }, { cbatPassed: true, cbatPassedSource: 'admin' });
    await patch({ passedForRole: 'no', passedAnyRole: 'no' });

    const updated = await User.findById(user._id);
    expect(updated.cbatPassed).toBe(true);
    expect(updated.cbatPassedSource).toBe('admin'); // untouched
  });
});

describe('the questionnaire being closed', () => {
  it('reports closed when the admin has turned it off', async () => {
    await AppSettings.updateOne({}, { cbatSurveyEnabled: false });
    const res = await get();
    expect(res.body.data.closed).toBe(true);
  });

  it('refuses answers once closed', async () => {
    await AppSettings.updateOne({}, { cbatSurveyEnabled: false });
    const res = await patch({ satTest: true });
    expect(res.status).toBe(410);
  });
});

describe('POST /api/survey/:token/opt-out', () => {
  it('opts out immediately, with no question answered first', async () => {
    const res = await request(app).post(`/api/survey/${token}/opt-out`);
    expect(res.status).toBe(200);

    const updated = await User.findById(user._id);
    expect(updated.researchEmailOptOut.at).toBeTruthy();
    expect(updated.researchEmailOptOut.reason).toBeNull(); // nothing was required
    expect((await SurveyInvite.findById(invite._id)).optedOutAt).toBeTruthy();
  });

  it('is idempotent', async () => {
    await request(app).post(`/api/survey/${token}/opt-out`);
    const at = (await User.findById(user._id)).researchEmailOptOut.at;
    await request(app).post(`/api/survey/${token}/opt-out`);
    expect((await User.findById(user._id)).researchEmailOptOut.at.getTime()).toBe(at.getTime());
  });

  it('blocks further answers afterwards', async () => {
    await request(app).post(`/api/survey/${token}/opt-out`);
    const res = await patch({ satTest: true });
    expect(res.status).toBe(410);
  });

  it('reports the opt-out on load', async () => {
    await request(app).post(`/api/survey/${token}/opt-out`);
    const res = await get();
    expect(res.body.data.optedOut).toBe(true);
  });

  it('404s on an unknown token', async () => {
    const res = await request(app).post(`/api/survey/${SurveyInvite.newToken()}/opt-out`);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/survey/:token/opt-out — the optional questions after leaving', () => {
  it('records a reason and a pass answer', async () => {
    await request(app).post(`/api/survey/${token}/opt-out`);
    const res = await request(app)
      .patch(`/api/survey/${token}/opt-out`)
      .send({ reason: 'too_many_emails', passedForRole: 'yes', satTest: true });

    expect(res.status).toBe(200);
    const updated = await User.findById(user._id);
    expect(updated.researchEmailOptOut.reason).toBe('too_many_emails');
    // The one answer worth having is captured even from someone leaving.
    expect(updated.cbatPassed).toBe(true);

    const row = await SurveyResponse.findOne({ inviteId: invite._id });
    expect(row.passedForRole).toBe('yes');
    expect(row.optOutReason).toBe('too_many_emails');
  });

  it('refuses before an opt-out has actually happened', async () => {
    const res = await request(app)
      .patch(`/api/survey/${token}/opt-out`)
      .send({ reason: 'not_relevant' });
    expect(res.status).toBe(400);
  });

  it('ignores an unknown reason', async () => {
    await request(app).post(`/api/survey/${token}/opt-out`);
    await request(app).patch(`/api/survey/${token}/opt-out`).send({ reason: 'because' });
    expect((await User.findById(user._id)).researchEmailOptOut.reason).toBeNull();
  });
});

describe('the "not yet" branch — deferral rather than a dead end', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('records the booked date and holds the invite until a week after it', async () => {
    const booked = new Date(Date.now() + 30 * DAY);
    await patch({ satTest: false });
    await patch({ testBookedFor: booked.toISOString(), testBookedUnknown: false });

    const row = await SurveyResponse.findOne({ inviteId: invite._id });
    expect(row.testBookedFor).toBeTruthy();

    const updated = await SurveyInvite.findById(invite._id);
    const expected = booked.getTime() + 7 * DAY;
    expect(Math.abs(updated.deferredUntil.getTime() - expected)).toBeLessThan(60 * 1000);
  });

  it('falls back to a default wait when they have not booked it yet', async () => {
    await patch({ satTest: false });
    await patch({ testBookedUnknown: true });

    const updated = await SurveyInvite.findById(invite._id);
    const expected = Date.now() + 60 * DAY;
    expect(Math.abs(updated.deferredUntil.getTime() - expected)).toBeLessThan(5 * 60 * 1000);
    expect((await SurveyResponse.findOne({ inviteId: invite._id })).testBookedUnknown).toBe(true);
  });

  it('still defers when they decline to give a date', async () => {
    await patch({ satTest: false });
    const updated = await SurveyInvite.findById(invite._id);
    expect(updated.deferredUntil).toBeTruthy();
  });

  it('ignores a date in the past and defers on the default instead', async () => {
    await patch({ satTest: false });
    await patch({ testBookedFor: new Date(Date.now() - 30 * DAY).toISOString() });

    expect((await SurveyResponse.findOne({ inviteId: invite._id })).testBookedFor).toBeNull();
    const updated = await SurveyInvite.findById(invite._id);
    expect(Math.abs(updated.deferredUntil.getTime() - (Date.now() + 60 * DAY))).toBeLessThan(5 * 60 * 1000);
  });

  it('ignores an absurdly distant date', async () => {
    await patch({ satTest: false });
    await patch({ testBookedFor: new Date(Date.now() + 4000 * DAY).toISOString() });
    expect((await SurveyResponse.findOne({ inviteId: invite._id })).testBookedFor).toBeNull();
  });

  it('never marks a "not yet" run complete — that would strike them off for good', async () => {
    await patch({ satTest: false });
    await patch({ testBookedUnknown: true, complete: true });

    const updated = await SurveyInvite.findById(invite._id);
    expect(updated.completedAt).toBeNull();
    expect(updated.deferredUntil).toBeTruthy();
  });

  it('still completes normally for someone who HAS sat it', async () => {
    await patch({ satTest: true });
    await patch({ passedForRole: 'yes', complete: true });

    const updated = await SurveyInvite.findById(invite._id);
    expect(updated.completedAt).toBeTruthy();
    expect(updated.deferredUntil).toBeNull();
  });

  it('reports the deferral date back so the page can promise the same one', async () => {
    const res = await patch({ satTest: false });
    expect(res.body.data.deferredUntil).toBeTruthy();
  });
});

describe('the closing comment', () => {
  it('is stored after the questionnaire is already finished', async () => {
    await patch({ satTest: true, passedForRole: 'yes', complete: true });
    const res = await patch({ comment: 'The DPT drills were the thing that carried me.' });

    expect(res.status).toBe(200);
    const row = await SurveyResponse.findOne({ inviteId: invite._id });
    expect(row.comment).toBe('The DPT drills were the thing that carried me.');
    // Finishing already happened; a late comment must not undo it.
    expect(row.completedAt).toBeTruthy();
  });

  it('is separate from the "what did we miss" answer', async () => {
    await patch({ gaps: 'The SLT format had changed.', comment: 'Thanks for building this.' });
    const row = await SurveyResponse.findOne({ inviteId: invite._id });
    expect(row.gaps).toBe('The SLT format had changed.');
    expect(row.comment).toBe('Thanks for building this.');
  });

  it('is truncated rather than rejected when over-long', async () => {
    await patch({ comment: 'x'.repeat(5000) });
    expect((await SurveyResponse.findOne({ inviteId: invite._id })).comment).toHaveLength(2000);
  });
});
