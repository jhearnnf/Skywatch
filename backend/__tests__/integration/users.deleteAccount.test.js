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
      'User', 'ChatConversation', 'ChatMessage', 'UpdateNotification',
      'SystemLog', 'AdminAction', 'EmailLog',
    ]);

    const unhandled = referencing.filter((m) => !handled.has(m));
    expect(unhandled).toEqual([]);
  });
});
