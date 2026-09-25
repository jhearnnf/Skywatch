'use strict';

/**
 * Case Files navbar tab — GET /api/case-files/nav
 *
 * Shown only with the feature and the nav toggle on, to players who have
 * finished MORE than caseFilesNavCbatThreshold CBAT games (default 10).
 */

process.env.JWT_SECRET     = 'test_secret';
process.env.OPENROUTER_KEY = 'test_key';

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createAdminUser, createSettings, authCookie } = require('../helpers/factories');

const AppSettings                  = require('../../models/AppSettings');
const GameSessionCbatTargetResult  = require('../../models/GameSessionCbatTargetResult');
const GameSessionCbatSymbolsResult = require('../../models/GameSessionCbatSymbolsResult');

const URL = '/api/case-files/nav';

// Spread across two games: the count is the total over every CBAT game.
async function finishGames(userId, n) {
  const target  = Math.ceil(n / 2);
  const symbols = n - target;
  for (let i = 0; i < target; i++)  await GameSessionCbatTargetResult.create({ userId, totalScore: 10, totalTime: 60 });
  for (let i = 0; i < symbols; i++) await GameSessionCbatSymbolsResult.create({ userId, correctCount: 5, totalTime: 60 });
}

async function setSettings(patch) {
  await AppSettings.updateOne({}, { $set: patch });
}

let user, cookie;

beforeAll(async () => { await db.connect(); });
beforeEach(async () => {
  await createSettings();
  await setSettings({ caseFilesEnabled: true, caseFilesNavEnabled: true, caseFilesNavCbatThreshold: 10 });
  user   = await createUser();
  cookie = authCookie(user._id);
});
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

describe('GET /api/case-files/nav', () => {
  it('needs a signed-in player', async () => {
    expect((await request(app).get(URL)).status).toBe(401);
  });

  it('stays hidden at exactly 10 finished games', async () => {
    await finishGames(user._id, 10);
    const res = await request(app).get(URL).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.visible).toBe(false);
  });

  it('appears once a player has finished more than 10', async () => {
    await finishGames(user._id, 11);
    expect((await request(app).get(URL).set('Cookie', cookie)).body.visible).toBe(true);
  });

  it('follows the admin threshold', async () => {
    await setSettings({ caseFilesNavCbatThreshold: 2 });
    await finishGames(user._id, 3);
    expect((await request(app).get(URL).set('Cookie', cookie)).body.visible).toBe(true);
  });

  it('hides for everyone when the nav toggle is off', async () => {
    await setSettings({ caseFilesNavEnabled: false });
    await finishGames(user._id, 11);
    expect((await request(app).get(URL).set('Cookie', cookie)).body.visible).toBe(false);
  });

  it('hides when Case Files itself is off, admins included', async () => {
    await setSettings({ caseFilesEnabled: false });
    const admin = await createAdminUser();
    await finishGames(admin._id, 11);
    expect((await request(app).get(URL).set('Cookie', authCookie(admin._id))).body.visible).toBe(false);
  });

  it('counts only the player\'s own games', async () => {
    const other = await createUser();
    await finishGames(other._id, 20);
    expect((await request(app).get(URL).set('Cookie', cookie)).body.visible).toBe(false);
  });
});
