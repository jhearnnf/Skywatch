process.env.JWT_SECRET = 'test_secret';

const request = require('supertest');
const app = require('../../app');
const db = require('../helpers/setupDb');
const { createUser, createSettings, authCookie } = require('../helpers/factories');
const ChatConversation = require('../../models/ChatConversation');
const ChatMessage = require('../../models/ChatMessage');

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

  it('shows a late joiner everything said before they arrived', async () => {
    const a = await createUser({ displayName: 'Falcon', firstSeenCountry: 'GB' });
    const made = await choose(a);
    const id = made.body.data.conversationId;
    await request(app).post(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', authCookie(a._id)).send({ body: 'anyone else on this date?' });

    const late = await createUser({ displayName: 'Viper', firstSeenCountry: 'GB' });
    await choose(late);
    const thread = await request(app).get(`/api/chat/conversations/${id}/messages`)
      .set('Cookie', authCookie(late._id));

    expect(thread.status).toBe(200);
    expect(thread.body.data.messages.map(m => m.body)).toEqual(['anyone else on this date?']);
  });

  it('sends the welcome hint with the room, never as a stored message', async () => {
    const admin = await createUser({ displayName: 'Control', isAdmin: true });
    const a = await createUser({ displayName: 'Falcon', firstSeenCountry: 'GB' });
    const made = await choose(a);
    const id = made.body.data.conversationId;
    const cookie = authCookie(a._id);

    const [mine, thread, detail, overview] = await Promise.all([
      request(app).get('/api/chat/cbat-group').set('Cookie', cookie),
      request(app).get(`/api/chat/conversations/${id}/messages`).set('Cookie', cookie),
      request(app).get(`/api/chat/cbat-groups/${id}`).set('Cookie', authCookie(admin._id)),
      request(app).get('/api/chat/overview').set('Cookie', cookie),
    ]);

    const expected = expect.stringMatching(/^Welcome to your SkyWatch group\. Everyone in here is sitting the CBAT on 14 Oct 2099,/);
    expect(mine.body.data.welcome).toEqual(expected);
    expect(thread.body.data.conversation.welcome).toEqual(expected);
    expect(detail.body.data.welcome).toEqual(expected);
    // Nothing was written: the room is empty, unread for nobody, and the
    // welcome is not a row anyone could reply to or react on.
    expect(thread.body.data.messages).toEqual([]);
    expect(await ChatMessage.countDocuments({ conversationId: id })).toBe(0);
    expect(mine.body.data.unreadCount).toBe(0);
    expect(overview.body.data.groups.find(g => String(g._id) === String(id)).unread).toBe(false);
    // Public channels carry no welcome.
    const lounge = overview.body.data.channels[0];
    if (lounge) {
      const pub = await request(app).get(`/api/chat/conversations/${lounge._id}/messages`).set('Cookie', cookie);
      expect(pub.body.data.conversation).not.toHaveProperty('welcome');
    }
  });

  it('names the CFAST for Canada, the MACTS for Australia, and stays generic elsewhere', async () => {
    const ca = await createUser({ displayName: 'Falcon', firstSeenCountry: 'CA' });
    const au = await createUser({ displayName: 'Viper', firstSeenCountry: 'AU' });
    const nz = await createUser({ displayName: 'Kiwi', firstSeenCountry: 'NZ' });
    const [caRoom, auRoom, nzRoom] = await Promise.all([choose(ca), choose(au), choose(nz)]);
    expect(caRoom.body.data.welcome).toContain('sitting the CFAST on');
    expect(caRoom.body.data.testName).toBe('CFAST');
    expect(caRoom.body.data.title).toBe('✈️ CFAST · 14 Oct 2099');
    expect(auRoom.body.data.welcome).toContain('sitting the MACTS on');
    expect(auRoom.body.data.testName).toBe('MACTS');
    expect(nzRoom.body.data.welcome).toContain('sitting your aptitude test on');
    expect(nzRoom.body.data.testName).toBeNull();
    expect(nzRoom.body.data.title).toBe('✈️ Test day · 14 Oct 2099');
  });

  it('tells the client which test to name before a date is chosen', async () => {
    const ca = await createUser({ displayName: 'Falcon', firstSeenCountry: 'CA' });
    const gb = await createUser({ displayName: 'Viper', firstSeenCountry: 'GB' });
    const [caState, gbState, overview] = await Promise.all([
      request(app).get('/api/chat/cbat-group').set('Cookie', authCookie(ca._id)),
      request(app).get('/api/chat/cbat-group').set('Cookie', authCookie(gb._id)),
      request(app).get('/api/chat/overview').set('Cookie', authCookie(ca._id)),
    ]);
    expect(caState.body.data).toMatchObject({ configured: false, region: 'CA', testName: 'CFAST' });
    expect(gbState.body.data).toMatchObject({ configured: false, region: 'GB', testName: 'CBAT' });
    const setup = overview.body.data.groups.find(g => g.setupRequired);
    expect(setup).toMatchObject({ title: 'My CFAST Group', testName: 'CFAST' });
  });

  it('tells a member how many people share their group', async () => {
    const a = await createUser({ displayName: 'Falcon', firstSeenCountry: 'GB' });
    const b = await createUser({ displayName: 'Viper', firstSeenCountry: 'GB' });
    const other = await createUser({ displayName: 'Hawk', firstSeenCountry: 'GB' });
    const made = await choose(a);
    await choose(b);
    await choose(other, '2099-11-02'); // a different date: not counted
    const id = made.body.data.conversationId;
    const cookie = authCookie(a._id);

    const [mine, overview, thread] = await Promise.all([
      request(app).get('/api/chat/cbat-group').set('Cookie', cookie),
      request(app).get('/api/chat/overview').set('Cookie', cookie),
      request(app).get(`/api/chat/conversations/${id}/messages`).set('Cookie', cookie),
    ]);

    expect(mine.body.data.memberCount).toBe(2);
    const row = overview.body.data.groups.find(g => String(g._id) === String(id));
    expect(row.memberCount).toBe(2);
    expect(thread.body.data.conversation.memberCount).toBe(2);
    // Public channels carry no count at all.
    const lounge = overview.body.data.channels[0];
    if (lounge) {
      const pub = await request(app).get(`/api/chat/conversations/${lounge._id}/messages`).set('Cookie', cookie);
      expect(pub.body.data.conversation).not.toHaveProperty('memberCount');
    }
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

  // A date typed in to see what the feature does leaves a room behind when it
  // is cleared again. Nobody is in it and nothing was ever said in it, so it
  // is debris rather than a group, and the admin list is where it gets swept.
  it('deletes a group once its last member and its messages are gone', async () => {
    const admin = await createUser({ displayName: 'Control', isAdmin: true });
    const a = await createUser({ displayName: 'Falcon', firstSeenCountry: 'GB' });
    await choose(a);
    await request(app).delete(`/api/admin/users/${a._id}/upcoming-cbat-date`)
      .set('Cookie', authCookie(admin._id));

    const list = await request(app).get('/api/chat/cbat-groups')
      .set('Cookie', authCookie(admin._id));

    expect(list.status).toBe(200);
    expect(list.body.data.groups).toEqual([]);
    expect(await ChatConversation.countDocuments({ 'channel.audience': 'cbat-cohort' })).toBe(0);
  });

  // ...but a room that was talked in is a transcript, so emptying it of members
  // leaves it on the list to be dealt with by hand.
  it('keeps an empty group that was talked in', async () => {
    const admin = await createUser({ displayName: 'Control', isAdmin: true });
    const a = await createUser({ displayName: 'Falcon', firstSeenCountry: 'GB' });
    const made = await choose(a);
    await request(app).post(`/api/chat/conversations/${made.body.data.conversationId}/messages`)
      .set('Cookie', authCookie(a._id)).send({ body: 'anyone else on this date?' });
    await request(app).delete(`/api/admin/users/${a._id}/upcoming-cbat-date`)
      .set('Cookie', authCookie(admin._id));

    const list = await request(app).get('/api/chat/cbat-groups')
      .set('Cookie', authCookie(admin._id));

    expect(list.body.data.groups).toHaveLength(1);
    expect(list.body.data.groups[0].participantCount).toBe(0);
    expect(list.body.data.groups[0].messageCount).toBe(1);
  });

  // The room is rebuilt from the date, so sweeping it is never a one-way door.
  it('rebuilds a swept group for the next person on that date', async () => {
    const admin = await createUser({ displayName: 'Control', isAdmin: true });
    const a = await createUser({ displayName: 'Falcon', firstSeenCountry: 'GB' });
    await choose(a);
    await request(app).delete(`/api/admin/users/${a._id}/upcoming-cbat-date`)
      .set('Cookie', authCookie(admin._id));
    await request(app).get('/api/chat/cbat-groups').set('Cookie', authCookie(admin._id));

    const b = await createUser({ displayName: 'Viper', firstSeenCountry: 'GB' });
    const rejoined = await choose(b);

    expect(rejoined.status).toBe(201);
    expect(rejoined.body.data.memberCount).toBe(1);
    const list = await request(app).get('/api/chat/cbat-groups')
      .set('Cookie', authCookie(admin._id));
    expect(list.body.data.groups).toHaveLength(1);
    expect(list.body.data.groups[0].conversationId).toBe(rejoined.body.data.conversationId);
  });
});
