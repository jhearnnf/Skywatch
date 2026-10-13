jest.mock('../../utils/cbatScoreSheetExtract', () => {
  const actual = jest.requireActual('../../utils/cbatScoreSheetExtract');
  return { ...actual, extractScoreSheet: jest.fn() };
});

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createAdminUser, authCookie } = require('../helpers/factories');
const User = require('../../models/User');
const CbatScoreSheet = require('../../models/CbatScoreSheet');
const { extractScoreSheet } = require('../../utils/cbatScoreSheetExtract');

let admin, adminCookie, player, imageId;

const READ = {
  isScoreSheet: true, testDate: new Date('2026-09-30T00:00:00Z'), board: 'RAF', model: 'test-model',
  batteries: [{ label: 'RAF Pilot 2026', batteryKey: 'pilot', sideBar: 1, verdict: 'pass', cutoff: 112, score: 123, domains: [] }],
};

beforeAll(async () => { await db.connect(); });
beforeEach(async () => {
  admin = await createAdminUser({ agentNumber: '3000001', email: 'sheetadmin@test.com' });
  adminCookie = authCookie(admin._id);
  player = await createUser({ agentNumber: '3000002', email: 'sheetplayer@test.com' });
  player.cbatResultImages.push({ url: 'https://example.test/sheet.jpg', source: 'questionnaire', consentAt: new Date() });
  await player.save();
  imageId = String(player.cbatResultImages[0]._id);
  extractScoreSheet.mockReset();
  extractScoreSheet.mockResolvedValue(READ);
});
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

const extract = (body) => request(app).post('/api/admin/score-sheets/extract').set('Cookie', adminCookie).send(body);

describe('admin score sheets', () => {
  it('reads an image into a draft sheet, then lists it once confirmed', async () => {
    const res = await extract({ userId: String(player._id), imageId });
    expect(res.status).toBe(200);
    expect(extractScoreSheet).toHaveBeenCalledWith('https://example.test/sheet.jpg');
    const { sheet } = res.body.data;
    expect(sheet).toMatchObject({ status: 'extracted', board: 'RAF', imageId });
    expect(sheet.batteries[0]).toMatchObject({ label: 'RAF Pilot 2026', batteryKey: 'pilot', verdict: 'pass' });

    expect((await request(app).get('/api/admin/score-sheets').set('Cookie', adminCookie)).body.data.sheets).toHaveLength(0);
    const ok = await request(app).patch(`/api/admin/score-sheets/${sheet._id}`).set('Cookie', adminCookie).send({ status: 'confirmed' });
    expect(ok.body.data.sheet).toMatchObject({ status: 'confirmed', confirmedBy: String(admin._id) });
    expect((await request(app).get('/api/admin/score-sheets').set('Cookie', adminCookie)).body.data.sheets).toHaveLength(1);
  });

  it('cleans an admin correction the same way as a read', async () => {
    const { sheet } = (await extract({ userId: String(player._id), imageId })).body.data;
    const res = await request(app).patch(`/api/admin/score-sheets/${sheet._id}`).set('Cookie', adminCookie).send({
      testDate: '2026-10-01',
      batteries: [{ label: 'Air Traffic & Weapons Controller (ATC)', verdict: 'FAIL', cutoff: 80, score: 79, domains: [{ key: 'CIP', stanine: 99 }] }],
    });
    expect(res.body.data.sheet.batteries[0]).toMatchObject({ batteryKey: 'nco-control-atc', verdict: 'fail', score: 79 });
    expect(res.body.data.sheet.batteries[0].domains[0].stanine).toBeNull();
    expect(res.body.data.sheet.testDate.slice(0, 10)).toBe('2026-10-01');
  });

  it('will not overwrite a confirmed sheet without force', async () => {
    const { sheet } = (await extract({ userId: String(player._id), imageId })).body.data;
    await request(app).patch(`/api/admin/score-sheets/${sheet._id}`).set('Cookie', adminCookie).send({ status: 'confirmed' });
    expect((await extract({ userId: String(player._id), imageId })).status).toBe(409);
    const forced = await extract({ userId: String(player._id), imageId, force: true });
    expect(forced.body.data.sheet.status).toBe('extracted');
    expect(await CbatScoreSheet.countDocuments()).toBe(1);
  });

  it('files a photo that is not a score sheet as rejected', async () => {
    extractScoreSheet.mockResolvedValue({ isScoreSheet: false, testDate: null, board: null, batteries: [], model: 'test-model' });
    const res = await extract({ userId: String(player._id), imageId });
    expect(res.body.data.sheet.status).toBe('rejected');
  });

  it('removes the sheet when its image is deleted', async () => {
    await extract({ userId: String(player._id), imageId });
    await request(app).delete(`/api/admin/users/${player._id}/cbat-results/${imageId}`).set('Cookie', adminCookie).expect(200);
    expect(await CbatScoreSheet.countDocuments()).toBe(0);
    expect((await User.findById(player._id)).cbatResultImages).toHaveLength(0);
  });

  it('is admin only', async () => {
    const res = await request(app).post('/api/admin/score-sheets/extract').set('Cookie', authCookie(player._id)).send({ userId: String(player._id), imageId });
    expect(res.status).toBe(403);
    expect(extractScoreSheet).not.toHaveBeenCalled();
  });
});
