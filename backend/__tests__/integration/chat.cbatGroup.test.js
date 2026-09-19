process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app = require('../../app');
const db = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const ChatConversation = require('../../models/ChatConversation');

beforeAll(async () => { await db.connect(); await ChatConversation.syncIndexes(); });
beforeEach(async () => { await createSettings(); });
afterEach(async () => { await db.clearDatabase(); });
afterAll(async () => { await db.closeDatabase(); });

const choose = (user, date = '2099-10-14') => request(app).post('/api/chat/cbat-group')
  .set('Cookie', authCookie(user._id)).send({ date });

describe('CBAT cohort groups', () => {
  it('locks matching users into the same private group', async () => {
    const a = await createUser({ displayName: 'Falcon', firstSeenCountry: 'GB' });
    const b = await createUser({ displayName: 'Viper', firstSeenCountry: 'GB' });
    const [one, two] = await Promise.all([choose(a), choose(b)]);
    expect(one.status).toBe(201);
    expect(one.body.data.conversationId).toBe(two.body.data.conversationId);
    expect((await choose(a, '2099-10-15')).status).toBe(409);
  });

  it('keeps another region out and off its Community rail', async () => {
    const gb = await createUser({ displayName: 'Falcon', firstSeenCountry: 'GB' });
    const us = await createUser({ displayName: 'Viper', firstSeenCountry: 'US' });
    const made = await choose(gb);
    await choose(us);
    const id = made.body.data.conversationId;
    const thread = await request(app).get(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', authCookie(us._id));
    const overview = await request(app).get('/api/chat/overview').set('Cookie', authCookie(us._id));
    expect(thread.status).toBe(403);
    expect(overview.body.data.channels.map(c => String(c._id))).not.toContain(String(id));
  });

  it('returns the assigned members when an admin opens a group', async () => {
    const admin = await createUser({ displayName: 'Control', isAdmin: true });
    const a = await createUser({ displayName: 'Falcon', firstSeenCountry: 'GB' });
    const b = await createUser({ displayName: 'Viper', firstSeenCountry: 'GB', cbatPassed: true,
      cbatDate: new Date('2099-10-14T00:00:00.000Z') });
    const made = await choose(a);
    await request(app).get('/api/chat/cbat-group').set('Cookie', authCookie(b._id));
    const detail = await request(app).get(`/api/chat/cbat-groups/${made.body.data.conversationId}`)
      .set('Cookie', authCookie(admin._id));
    expect(detail.status).toBe(200);
    expect(detail.body.data.members.map(m => m.displayName).sort()).toEqual(['Falcon', 'Viper']);
    expect(detail.body.data.members.find(m => m.displayName === 'Viper').cbatPassed).toBe(true);
  });

  it('includes participant totals in the admin all-groups list', async () => {
    const admin = await createUser({ displayName: 'Control', isAdmin: true });
    const a = await createUser({ displayName: 'Falcon', firstSeenCountry: 'GB' });
    const b = await createUser({ displayName: 'Viper', firstSeenCountry: 'GB' });
    await Promise.all([choose(a), choose(b)]);

    const list = await request(app).get('/api/chat/cbat-groups')
      .set('Cookie', authCookie(admin._id));

    expect(list.status).toBe(200);
    expect(list.body.data.groups).toHaveLength(1);
    expect(list.body.data.groups[0].participantCount).toBe(2);
  });
});
