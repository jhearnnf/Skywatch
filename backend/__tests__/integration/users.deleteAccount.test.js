process.env.JWT_SECRET = 'test_secret';

const fs      = require('fs');
const path    = require('path');
const request = require('supertest');
const mongoose = require('mongoose');

const app = require('../../app');
const db  = require('../helpers/setupDb');
const { createUser, createAdminUser, createSettings, authCookie } = require('../helpers/factories');

const { OWNED_BY_USER, AUTHORSHIP_REFS } = require('../../services/deleteUserData');

const User               = require('../../models/User');
const AirstarLog         = require('../../models/AirstarLog');
const GameSessionCbatTargetResult = require('../../models/GameSessionCbatTargetResult');
const GameSessionCbatTrace2Result = require('../../models/GameSessionCbatTrace2Result');
const IntelligenceBriefRead = require('../../models/IntelligenceBriefRead');
const UserNotification   = require('../../models/UserNotification');
const ChatConversation   = require('../../models/ChatConversation');
const ChatMessage        = require('../../models/ChatMessage');
const UpdateNotification = require('../../models/UpdateNotification');
const SystemLog          = require('../../models/SystemLog');
const AdminAction        = require('../../models/AdminAction');
const EmailLog           = require('../../models/EmailLog');
const SurveyInvite       = require('../../models/SurveyInvite');
const SurveyResponse     = require('../../models/SurveyResponse');
const DonationPageVisit  = require('../../models/DonationPageVisit');
const ClipperScript      = require('../../models/ClipperScript');

beforeAll(async () => {
  await db.connect();
  await createSettings();
});
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

// Seeds one row in each of the collections the cascade has to reach.
async function seedUserData(userId) {
  await AirstarLog.create({ userId, amount: 10, reason: 'test' });
  await GameSessionCbatTargetResult.create({ userId, totalScore: 40, totalTime: 60000 });
  await GameSessionCbatTrace2Result.create({ userId, correctCount: 6 });
  await IntelligenceBriefRead.create({ userId, intelBriefId: new mongoose.Types.ObjectId() });
  await UserNotification.create({ userId, title: 'hi', message: 'there' });

  const convo = await ChatConversation.create({ userId, startedByRole: 'user' });
  await ChatMessage.create({ conversationId: convo._id, senderUserId: userId, senderRole: 'user', body: 'my support question' });

  return { convo };
}

describe('DELETE /api/users/me', () => {
  it('deletes the account and every row keyed to the user', async () => {
    const user = await createUser();
    await seedUserData(user._id);

    const res = await request(app)
      .delete('/api/users/me')
      .set('Cookie', authCookie(user._id));

    expect(res.status).toBe(200);
    expect(await User.findById(user._id)).toBeNull();

    // Nothing owned by the user survives.
    expect(await AirstarLog.countDocuments({ userId: user._id })).toBe(0);
    expect(await GameSessionCbatTargetResult.countDocuments({ userId: user._id })).toBe(0);
    expect(await GameSessionCbatTrace2Result.countDocuments({ userId: user._id })).toBe(0);
    expect(await IntelligenceBriefRead.countDocuments({ userId: user._id })).toBe(0);
    expect(await UserNotification.countDocuments({ userId: user._id })).toBe(0);
    expect(await ChatConversation.countDocuments({ userId: user._id })).toBe(0);
    // Their support messages go with the conversation, not just the ref.
    expect(await ChatMessage.countDocuments({})).toBe(0);
  });

  it('clears the auth cookie so the dead session cannot be reused', async () => {
    const user = await createUser();

    const res = await request(app)
      .delete('/api/users/me')
      .set('Cookie', authCookie(user._id));

    const cookie = String(res.headers['set-cookie'] ?? '');
    expect(cookie).toMatch(/jwt=;/);
  });

  it('rejects an unauthenticated caller', async () => {
    const res = await request(app).delete('/api/users/me');
    expect(res.status).toBe(401);
  });

  it('refuses to self-delete an admin, leaving the account intact', async () => {
    const admin = await createAdminUser();

    const res = await request(app)
      .delete('/api/users/me')
      .set('Cookie', authCookie(admin._id));

    expect(res.status).toBe(403);
    expect(await User.findById(admin._id)).not.toBeNull();
  });

  it('strips the user from another user\'s data not at all', async () => {
    const victim   = await createUser();
    const bystander = await createUser();
    await seedUserData(victim._id);
    await seedUserData(bystander._id);

    await request(app).delete('/api/users/me').set('Cookie', authCookie(victim._id));

    // The bystander is untouched.
    expect(await User.findById(bystander._id)).not.toBeNull();
    expect(await AirstarLog.countDocuments({ userId: bystander._id })).toBe(1);
    expect(await ChatConversation.countDocuments({ userId: bystander._id })).toBe(1);
    expect(await ChatMessage.countDocuments({})).toBe(1);
  });
});

describe('deleteUserAndData — anonymisation', () => {
  it('keeps audit and ops rows but drops the identifying ref', async () => {
    const user = await createUser({ email: 'erase-me@test.com' });

    await SystemLog.create({ type: 'quiz_finish_failure', userId: user._id });
    await AdminAction.create({
      userId: (await createAdminUser())._id,
      actionType: 'ban_user',
      reason: 'testing',
      targetUserId: user._id,
    });
    await EmailLog.create({
      type: 'welcome', recipientEmail: 'erase-me@test.com',
      recipientUserId: user._id, status: 'sent',
    });

    await request(app).delete('/api/users/me').set('Cookie', authCookie(user._id));

    const log = await SystemLog.findOne({ type: 'quiz_finish_failure' });
    expect(log).not.toBeNull();
    expect(log.userId).toBeNull();

    const action = await AdminAction.findOne({ actionType: 'ban_user' });
    expect(action).not.toBeNull();
    expect(action.targetUserId).toBeNull();

    const email = await EmailLog.findOne({ type: 'welcome' });
    expect(email).not.toBeNull();
    expect(email.recipientUserId).toBeNull();
    expect(email.recipientEmail).toBe('deleted-user@removed.invalid');
  });

  it('pulls the user out of an announcement without deleting the announcement', async () => {
    const user  = await createUser();
    const other = await createUser();

    const notif = await UpdateNotification.create({
      title: 'Update', body: 'Body',
      viewedBy: [
        { userId: user._id,  response: 'my private free-text answer' },
        { userId: other._id, response: 'someone else' },
      ],
    });

    await request(app).delete('/api/users/me').set('Cookie', authCookie(user._id));

    const after = await UpdateNotification.findById(notif._id);
    expect(after).not.toBeNull();
    expect(after.viewedBy).toHaveLength(1);
    expect(after.viewedBy[0].userId.toString()).toBe(other._id.toString());
    // The deleted user's free-text answer is gone with their entry.
    expect(JSON.stringify(after.viewedBy)).not.toContain('my private free-text answer');
  });

  it('pulls the user out of a notification aimed at several people, leaving the rest', async () => {
    const user  = await createUser();
    const other = await createUser();

    const notif = await UpdateNotification.create({
      title: 'Update', body: 'Body', targetUsers: [user._id, other._id],
    });

    await request(app).delete('/api/users/me').set('Cookie', authCookie(user._id));

    const after = await UpdateNotification.findById(notif._id);
    expect(after.targetUsers.map(String)).toEqual([String(other._id)]);
    // Still aimed at someone, so it stays live.
    expect(after.enabled).toBe(true);
  });

  it('disables a notification aimed only at the deleted user rather than broadcasting it', async () => {
    const user = await createUser();

    const notif = await UpdateNotification.create({
      title: 'Just for you', body: 'Body', targetUsers: [user._id],
    });

    await request(app).delete('/api/users/me').set('Cookie', authCookie(user._id));

    const after = await UpdateNotification.findById(notif._id);
    expect(after.targetUsers).toEqual([]);
    // An empty targetUsers means "everyone" — this must not quietly become a
    // site-wide announcement because its only recipient closed their account.
    expect(after.enabled).toBe(false);
  });

  it('leaves an untargeted notification alone', async () => {
    const user = await createUser();
    const notif = await UpdateNotification.create({ title: 'For all', body: 'Body' });

    await request(app).delete('/api/users/me').set('Cookie', authCookie(user._id));

    const after = await UpdateNotification.findById(notif._id);
    expect(after.enabled).toBe(true);
    expect(after.targetUsers).toEqual([]);
  });
});

describe('DELETE /api/admin/users/:id', () => {
  it('cascades identically to self-deletion', async () => {
    const admin  = await createAdminUser();
    const target = await createUser();
    await seedUserData(target._id);

    const res = await request(app)
      .delete(`/api/admin/users/${target._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: 'user requested removal' });

    expect(res.status).toBe(200);
    expect(await User.findById(target._id)).toBeNull();
    // The bug this refactor fixed: CBAT results used to outlive the account.
    expect(await GameSessionCbatTargetResult.countDocuments({ userId: target._id })).toBe(0);
    expect(await GameSessionCbatTrace2Result.countDocuments({ userId: target._id })).toBe(0);
    expect(await ChatConversation.countDocuments({ userId: target._id })).toBe(0);
  });

  it('records the audit row with its target ref intact', async () => {
    const admin  = await createAdminUser();
    const target = await createUser();

    await request(app)
      .delete(`/api/admin/users/${target._id}`)
      .set('Cookie', authCookie(admin._id))
      .send({ reason: 'spam' });

    const action = await AdminAction.findOne({ actionType: 'delete_user' });
    expect(action).not.toBeNull();
    // Written after the cascade, so the cascade's own null-out doesn't blank it.
    expect(action.targetUserId?.toString()).toBe(target._id.toString());
  });
});

describe('the dispositions the guard rail cannot check', () => {
  // The questionnaire is deleted, not kept for the research. The invite holds
  // the address we mailed and the response is free text about someone's own
  // application, neither of which survives de-identification by dropping a
  // column.
  it('takes the outcome questionnaire with the account', async () => {
    const user = await createUser();
    const invite = await SurveyInvite.create({
      userId: user._id,
      token: SurveyInvite.newToken(),
      sentToEmail: user.email,
    });
    await SurveyResponse.create({
      inviteId: invite._id,
      userId: user._id,
      campaign: 'cbat_outcome_2026',
      gaps: 'The SLT was nothing like the practice one.',
    });

    await request(app).delete('/api/users/me').set('Cookie', authCookie(user._id));

    expect(await SurveyInvite.countDocuments({ userId: user._id })).toBe(0);
    expect(await SurveyResponse.countDocuments({ userId: user._id })).toBe(0);
  });

  // Someone who was asked for a donation was still asked after they leave, so
  // the row stays and the person goes. Both columns have to be rewritten: for a
  // signed-in visit the unique key is the account id itself.
  it('keeps a donation visit but unlinks it, key included', async () => {
    const user = await createUser();
    await DonationPageVisit.create({ visitKey: String(user._id), userId: user._id });

    await request(app).delete('/api/users/me').set('Cookie', authCookie(user._id));

    expect(await DonationPageVisit.countDocuments({})).toBe(1);
    const row = await DonationPageVisit.findOne({});
    expect(row.userId).toBeNull();
    expect(row.visitKey).not.toBe(String(user._id));
    expect(row.visitKey).not.toContain(String(user._id));
  });

  // Two accounts erased in turn must not collide on the unique key.
  it('gives each erased visit its own key', async () => {
    const a = await createUser();
    const b = await createUser();
    await DonationPageVisit.create({ visitKey: String(a._id), userId: a._id });
    await DonationPageVisit.create({ visitKey: String(b._id), userId: b._id });

    await request(app).delete('/api/users/me').set('Cookie', authCookie(a._id));
    await request(app).delete('/api/users/me').set('Cookie', authCookie(b._id));

    const keys = (await DonationPageVisit.find({}).lean()).map(r => r.visitKey);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });

  // Clipper is admin tooling: the script is app content that outlives whoever
  // queued it, so only the byline goes.
  // Removed by another admin, not by themselves: an admin cannot self-delete,
  // deliberately, or the app could be left with no way back in.
  it('keeps an admin Clipper script and drops its byline', async () => {
    const remover = await createAdminUser();
    const leaving = await createAdminUser();
    const script  = await ClipperScript.create({ createdBy: leaving._id });

    const res = await request(app)
      .delete(`/api/admin/users/${leaving._id}`)
      .set('Cookie', authCookie(remover._id))
      .send({ reason: 'left the team' });
    expect(res.status).toBe(200);

    const after = await ClipperScript.findById(script._id);
    expect(after).not.toBeNull();
    expect(after.createdBy).toBeNull();
  });
});

// Guard rail: a new model with a `userId` ref to User is invisible to the
// cascade unless it's listed. This fails the moment someone adds one without
// deciding whether it should be deleted or anonymised.
describe('cascade coverage', () => {
  it('accounts for every model that references User', () => {
    const modelsDir = path.join(__dirname, '..', '..', 'models');
    const referencing = fs.readdirSync(modelsDir)
      .filter((f) => f.endsWith('.js'))
      .filter((f) => fs.readFileSync(path.join(modelsDir, f), 'utf8').includes("ref: 'User'"))
      .map((f) => f.replace(/\.js$/, ''));

    const handled = new Set([
      ...OWNED_BY_USER,
      ...AUTHORSHIP_REFS.map(([name]) => name),
      // Handled explicitly in the service, not via the tables above.
      'User', 'ChatConversation', 'ChatMessage', 'ChatRead', 'UpdateNotification',
      'SystemLog', 'AdminAction', 'EmailLog',
      // Anonymised in place rather than deleted or null-ed: for a signed-in
      // visit the unique `visitKey` IS the account id, so the row needs both
      // columns rewritten and cannot be expressed as an authorship ref.
      'DonationPageVisit',
    ]);

    const unhandled = referencing.filter((m) => !handled.has(m));
    expect(unhandled).toEqual([]);
  });
});
