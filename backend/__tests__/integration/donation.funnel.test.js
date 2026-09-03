/**
 * donation.funnel.test.js
 *
 * The donation funnel now has three asks, not one, and the admin stat has to
 * account for all of them:
 *
 *   - the post-game note        → User.donationPrompt (impressions/clicks)
 *   - the questionnaire's close → SurveyResponse.completedAt / donationClicked
 *   - the public /donate page   → DonationPageVisit
 *
 * Coverage:
 *   - /api/donation/visit records an arrival, once per visitor however many times
 *     they report it, and keys a signed-in visitor by account
 *   - a malformed or missing key is dropped quietly rather than failing the page
 *   - a Checkout session started from /donate marks that visit as converted, and
 *     one started from the questionnaire does not invent a page visit
 *   - the stats endpoint unions the two account-based asks into one count of
 *     PEOPLE, and reports the page separately so its visits are not double
 *     counted against the note that sent them there
 *   - the drill-down names questionnaire respondents, not just note viewers
 */

process.env.JWT_SECRET        = 'test_secret';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';

jest.mock('stripe', () => {
  const mockSessionsCreate = jest.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/test' });
  const mockStripe = jest.fn(() => ({
    webhooks:      { constructEvent: jest.fn() },
    customers:     { create: jest.fn() },
    checkout:      { sessions: { create: mockSessionsCreate } },
    billingPortal: { sessions: { create: jest.fn() } },
  }));
  mockStripe._mockSessionsCreate = mockSessionsCreate;
  return mockStripe;
});

const request = require('supertest');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser, createAdminUser, createSettings, authCookie } = require('../helpers/factories');

const User              = require('../../models/User');
const SurveyInvite      = require('../../models/SurveyInvite');
const SurveyResponse    = require('../../models/SurveyResponse');
const DonationPageVisit = require('../../models/DonationPageVisit');
const { SURVEY_CAMPAIGN, SURVEY_TEST_CAMPAIGN } = require('../../constants/survey');

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearDatabase(); jest.clearAllMocks(); });
afterAll(async () => { await db.closeDatabase(); });

const visit = (body, cookie) => {
  const req = request(app).post('/api/donation/visit');
  if (cookie) req.set('Cookie', cookie);
  return req.send(body);
};

const donate = (body, cookie) => {
  const req = request(app).post('/api/stripe/create-donation-session');
  if (cookie) req.set('Cookie', cookie);
  return req.send(body);
};

// A completed questionnaire: reaching `completedAt` IS reaching the ask, since
// the same request that advances to the closing screen stamps it.
//
// The campaign comes from the constant rather than a literal. It used to be
// spelled with hyphens here, which matched nothing and went unnoticed for as
// long as nothing filtered on it.
async function finishSurvey(user, { donationClicked = false, campaign = SURVEY_CAMPAIGN } = {}) {
  const invite = await SurveyInvite.create({
    userId: user._id, token: SurveyInvite.newToken(), sentAt: new Date(),
    sentToEmail: user.email, campaign,
  });
  return SurveyResponse.create({
    inviteId: invite._id, userId: user._id, campaign,
    completedAt: new Date(), donationClicked,
  });
}

const KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

// ── Recording an arrival ─────────────────────────────────────────────────────
describe('POST /api/donation/visit', () => {
  it('records an arrival from someone with no account', async () => {
    const res = await visit({ visitKey: KEY });

    expect(res.status).toBe(200);
    const rows = await DonationPageVisit.find().lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBeNull();
    expect(rows[0].checkoutStartedAt).toBeNull();
  });

  // Counted in people, not page views: a reload, or a bounce back from a
  // cancelled Checkout, is the same person being asked once.
  it('counts one visitor once however many times they report it', async () => {
    await visit({ visitKey: KEY });
    await visit({ visitKey: KEY });
    await visit({ visitKey: KEY });

    expect(await DonationPageVisit.countDocuments()).toBe(1);
  });

  // The account is the better key when we have one: it folds every visit they
  // ever make, on any device, into the one person.
  it('keys a signed-in visitor by account, whatever key the browser sent', async () => {
    const user = await createUser();
    await visit({ visitKey: KEY }, authCookie(user._id));
    await visit({ visitKey: 'b'.repeat(32) }, authCookie(user._id));

    const rows = await DonationPageVisit.find().lean();
    expect(rows).toHaveLength(1);
    expect(String(rows[0].userId)).toBe(String(user._id));
  });

  // The visitor came to give money, not to be counted. A key we cannot use
  // loses the row and nothing else.
  it.each([
    ['a missing key', {}],
    ['a too-short key', { visitKey: 'abc' }],
    ['a key that is not a string', { visitKey: { nope: true } }],
  ])('accepts %s without recording anything', async (_label, body) => {
    const res = await visit(body);

    expect(res.status).toBe(200);
    expect(await DonationPageVisit.countDocuments()).toBe(0);
  });
});

// ── Pressing through to Stripe ───────────────────────────────────────────────
describe('the press-through from /donate', () => {
  it('marks the visit as having reached Checkout', async () => {
    await visit({ visitKey: KEY });
    const res = await donate({ amount: 5, visitKey: KEY });

    expect(res.status).toBe(200);
    const row = await DonationPageVisit.findOne().lean();
    expect(row.checkoutStartedAt).not.toBeNull();
    expect(row.checkoutCount).toBe(1);
  });

  // Recorded server-side, at the point a session is actually created, so the
  // funnel can never report a conversion that did not happen.
  it('records nothing when the amount is rejected', async () => {
    await donate({ amount: 9999, visitKey: KEY });
    expect(await DonationPageVisit.countDocuments()).toBe(0);
  });

  // The questionnaire's ask opens Checkout directly and records its own click on
  // the response. Counting it here as well would put one click in two places.
  it('does not invent a page visit for a donation started elsewhere', async () => {
    const user = await createUser();
    await donate({ amount: 3 }, authCookie(user._id));

    expect(await DonationPageVisit.countDocuments()).toBe(0);
  });
});

// ── The stat itself ──────────────────────────────────────────────────────────
describe('GET /api/admin/stats — donation', () => {
  const stats = async (admin) =>
    (await request(app).get('/api/admin/stats').set('Cookie', authCookie(admin._id))).body.data.users.donation;

  beforeEach(async () => { await createSettings(); });

  it('counts the questionnaire ask alongside the post-game note', async () => {
    const admin = await createAdminUser();
    await createUser({ donationPrompt: { impressionCount: 2, clickCount: 1 } });
    const respondent = await createUser();
    await finishSurvey(respondent, { donationClicked: true });

    const donation = await stats(admin);

    expect(donation.card).toEqual({ seen: 1, clicked: 1 });
    expect(donation.survey).toEqual({ seen: 1, clicked: 1 });
    expect(donation.seen).toBe(2);
    expect(donation.clicked).toBe(2);
  });

  // The two asks overlap by design — a questionnaire goes to someone who has
  // usually met the post-game note already — so the totals are over people.
  it('counts someone who met both asks once', async () => {
    const admin = await createAdminUser();
    const both  = await createUser({ donationPrompt: { impressionCount: 4, clickCount: 2 } });
    await finishSurvey(both, { donationClicked: true });

    const donation = await stats(admin);

    expect(donation.card.seen).toBe(1);
    expect(donation.survey.seen).toBe(1);
    expect(donation.seen).toBe(1);
    expect(donation.clicked).toBe(1);
  });

  // A dry run lives under its own campaign key so that it stays out of every
  // number. The funnel was the one read of this collection that forgot to filter,
  // so an admin testing the questionnaire on themselves turned up here as a real
  // respondent who had clicked a real donation ask.
  it('ignores a questionnaire sent under the test campaign', async () => {
    const admin  = await createAdminUser();
    const tester = await createUser();
    await finishSurvey(tester, { donationClicked: true, campaign: SURVEY_TEST_CAMPAIGN });

    const donation = await stats(admin);

    expect(donation.survey).toEqual({ seen: 0, clicked: 0 });
    expect(donation.seen).toBe(0);
    expect(donation.clicked).toBe(0);
  });

  // A half-answered run is the normal case and is not an ask: the closing screen
  // is the only place the questionnaire mentions money.
  it('ignores a questionnaire nobody finished', async () => {
    const admin = await createAdminUser();
    const user  = await createUser();
    const invite = await SurveyInvite.create({ userId: user._id, token: SurveyInvite.newToken() });
    await SurveyResponse.create({
      inviteId: invite._id, userId: user._id, campaign: SURVEY_CAMPAIGN, satTest: true,
    });

    const donation = await stats(admin);

    expect(donation.survey).toEqual({ seen: 0, clicked: 0 });
    expect(donation.seen).toBe(0);
  });

  // The page is where the post-game note's link LANDS, so its visits are
  // reported beside the asks rather than added into them — otherwise the same
  // click would count once as a click and again as an impression.
  it('reports the donate page separately from the asks', async () => {
    const admin = await createAdminUser();
    await visit({ visitKey: KEY });
    await donate({ amount: 3, visitKey: KEY });
    await visit({ visitKey: 'c'.repeat(32) });

    const donation = await stats(admin);

    expect(donation.page).toEqual({ visits: 2, checkouts: 1 });
    expect(donation.seen).toBe(0);
  });

  // The headline tile. Every other count in the block stops at a click, and a
  // started Checkout session is not a payment — only Stripe's webhook knows one
  // landed, and it writes `donatedAt` / `donatedTotalPence`.
  it('totals what was actually received, in people and pence', async () => {
    const admin = await createAdminUser();
    await createUser({ donationPrompt: { donatedAt: new Date(), donatedTotalPence: 500 } });
    await createUser({ donationPrompt: { donatedAt: new Date(), donatedTotalPence: 1250 } });

    expect((await stats(admin)).received).toEqual({ donors: 2, totalPence: 1750 });
  });

  // Donors are people, not payments: a second gift raises the total without
  // inventing a second supporter.
  it('counts a repeat donor once', async () => {
    const admin = await createAdminUser();
    await createUser({ donationPrompt: { donatedAt: new Date(), donatedTotalPence: 3000 } });

    expect((await stats(admin)).received).toEqual({ donors: 1, totalPence: 3000 });
  });

  it('reports zero when nobody has donated', async () => {
    const admin = await createAdminUser();
    await createUser({ donationPrompt: { impressionCount: 5, clickCount: 2 } });

    expect((await stats(admin)).received).toEqual({ donors: 0, totalPence: 0 });
  });

  // /donate does not require an account, so a donor with no name is the normal
  // case rather than the edge one. Leaving them out read as "we received
  // nothing" on a tile that is meant to say how much came in.
  it('counts a donation from someone with no account', async () => {
    const admin = await createAdminUser();
    await DonationPageVisit.recordPayment('g:' + 'd'.repeat(32), 300);

    expect((await stats(admin)).received).toEqual({ donors: 1, totalPence: 300 });
  });

  it('adds named and unnamed donors into one total', async () => {
    const admin = await createAdminUser();
    await createUser({ donationPrompt: { donatedAt: new Date(), donatedTotalPence: 1000 } });
    await DonationPageVisit.recordPayment('g:' + 'e'.repeat(32), 300);

    expect((await stats(admin)).received).toEqual({ donors: 2, totalPence: 1300 });
  });

  // Reaching Stripe is intent; paying is not. The two must not be confused, or
  // the tile reports money that was never charged.
  it('does not count a checkout that was started but never paid', async () => {
    const admin = await createAdminUser();
    await visit({ visitKey: KEY });
    await donate({ amount: 3, visitKey: KEY });

    const donation = await stats(admin);

    expect(donation.page.checkouts).toBe(1);
    expect(donation.received).toEqual({ donors: 0, totalPence: 0 });
  });
});

// ── The drill-down ───────────────────────────────────────────────────────────
describe('GET /api/admin/stats/donation-funnel — all three asks', () => {
  it('names someone the questionnaire asked, even if they never saw the note', async () => {
    const admin = await createAdminUser();
    const respondent = await createUser({ displayName: 'Viper' });
    await finishSurvey(respondent, { donationClicked: true });

    const res = await request(app)
      .get('/api/admin/stats/donation-funnel')
      .set('Cookie', authCookie(admin._id));

    const row = res.body.data.users.find(u => u.displayName === 'Viper');
    expect(row).toMatchObject({ surveyAsked: true, surveyClicked: true, impressionCount: 0 });
  });

  it('merges every ask that reached one person into a single row', async () => {
    const admin = await createAdminUser();
    const user  = await createUser({ displayName: 'Ghost', donationPrompt: { impressionCount: 2, clickCount: 1 } });
    await finishSurvey(user);
    await visit({ visitKey: KEY }, authCookie(user._id));

    const res = await request(app)
      .get('/api/admin/stats/donation-funnel')
      .set('Cookie', authCookie(admin._id));

    const rows = res.body.data.users.filter(u => u.displayName === 'Ghost');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      impressionCount: 2, clickCount: 1, surveyAsked: true, pageVisited: true, pageCheckout: false,
    });
  });

  // An anonymous visitor has no name to list, so the drill-down must not try to
  // invent one — they are counted in the page tile and nowhere else.
  it('leaves anonymous page visitors out of the named list', async () => {
    const admin = await createAdminUser();
    await visit({ visitKey: KEY });

    const res = await request(app)
      .get('/api/admin/stats/donation-funnel')
      .set('Cookie', authCookie(admin._id));

    expect(res.body.data.users).toHaveLength(0);
  });
});
