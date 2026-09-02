/**
 * One-off donations: the public Checkout session, and the webhook branch that
 * handles the payment coming back.
 *
 * Mocks the Stripe SDK so no credentials are needed, but exercises the real
 * routes, the real webhook handler and real MongoDB.
 */

process.env.JWT_SECRET            = 'test_secret';
process.env.STRIPE_SECRET_KEY     = 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_dummy';
process.env.CLIENT_URL            = 'https://skywatch.academy';

jest.mock('stripe', () => {
  const mockConstructEvent   = jest.fn();
  const mockSessionsCreate   = jest.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/test' });
  const mockStripe = jest.fn(() => ({
    webhooks:  { constructEvent: mockConstructEvent },
    customers: { create: jest.fn().mockResolvedValue({ id: 'cus_test123' }) },
    checkout:  { sessions: { create: mockSessionsCreate } },
    billingPortal: { sessions: { create: jest.fn() } },
  }));
  mockStripe._mockConstructEvent = mockConstructEvent;
  mockStripe._mockSessionsCreate = mockSessionsCreate;
  return mockStripe;
});

const request = require('supertest');
const stripe  = require('stripe');
const app     = require('../../app');
const User    = require('../../models/User');
const db      = require('../helpers/setupDb');
const { createUser, authCookie } = require('../helpers/factories');

const mockConstructEvent = stripe._mockConstructEvent;
const mockSessionsCreate = stripe._mockSessionsCreate;

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearDatabase(); jest.clearAllMocks(); });
afterAll(async () => { await db.closeDatabase(); });

const donate = (body, cookie) => {
  const req = request(app).post('/api/stripe/create-donation-session');
  if (cookie) req.set('Cookie', cookie);
  return req.send(body);
};

const lastSessionArgs = () => mockSessionsCreate.mock.calls.at(-1)[0];

// ── Creating the session ─────────────────────────────────────────────────────
describe('POST /api/stripe/create-donation-session', () => {
  // The whole point of the page. Someone who has been using the CBAT games for
  // weeks without an account is exactly the person likeliest to give, and a
  // sign-up wall in front of a gift is how you don't receive it.
  it('works with no account at all', async () => {
    const res = await donate({ amount: 3 });

    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://checkout.stripe.com/c/pay/test');
  });

  // An ad-hoc price rather than a Price ID, which is what lets /donate offer a
  // range without an admin creating a Price in Stripe per figure.
  it('builds a one-off GBP charge for the amount asked for', async () => {
    await donate({ amount: 10 });

    const args = lastSessionArgs();
    expect(args.mode).toBe('payment');
    expect(args.submit_type).toBe('donate');
    expect(args.line_items[0].price_data).toMatchObject({
      currency:    'gbp',
      unit_amount: 1000,
    });
  });

  // Binary floating point: 7.5 * 100 is 750.0000000000001, and truncating it
  // would charge £7.49.
  it('converts pounds to whole pence without losing a penny', async () => {
    await donate({ amount: 7.5 });
    expect(lastSessionArgs().line_items[0].price_data.unit_amount).toBe(750);
  });

  it.each([
    ['nothing',        undefined],
    ['zero',           0],
    ['under the floor', 0.5],
    ['over the ceiling', 501],
    ['negative',       -5],
    ['not a number',   'lots'],
  ])('rejects %s without calling Stripe', async (_label, amount) => {
    const res = await donate({ amount });

    expect(res.status).toBe(400);
    expect(mockSessionsCreate).not.toHaveBeenCalled();
  });

  it('accepts the exact boundaries', async () => {
    expect((await donate({ amount: 1 })).status).toBe(200);
    expect((await donate({ amount: 500 })).status).toBe(200);
  });

  // Signing in is never required, but it is not ignored either: it is what
  // lets the webhook stop asking this person again.
  it('carries a signed-in donor through so the payment can be attributed', async () => {
    const user = await createUser({ email: 'donor@example.com' });
    const res  = await donate({ amount: 5 }, authCookie(user._id));

    expect(res.status).toBe(200);
    const args = lastSessionArgs();
    expect(args.metadata.userId).toBe(user._id.toString());
    expect(args.customer_email).toBe('donor@example.com');
  });

  it('leaves an anonymous donation anonymous', async () => {
    await donate({ amount: 5 });

    const args = lastSessionArgs();
    expect(args.metadata.userId).toBe('');
    expect(args.customer_email).toBeUndefined();
  });

  // The marker the webhook branches on. Without it a donation falls into the
  // subscription branch and writes an undefined tier onto the donor.
  it('marks the session as a donation', async () => {
    await donate({ amount: 3 });
    expect(lastSessionArgs().metadata.kind).toBe('donation');
  });
});

// ── The payment coming back ──────────────────────────────────────────────────
describe('checkout.session.completed for a donation', () => {
  const sendWebhookEvent = async (event) => {
    mockConstructEvent.mockReturnValue(event);
    return request(app)
      .post('/api/stripe/webhook')
      .set('stripe-signature', 'dummy-sig')
      .set('Content-Type', 'application/json')
      .send(Buffer.from(JSON.stringify(event)));
  };

  const donationEvent = (metadata, amountTotal = 500) => ({
    type: 'checkout.session.completed',
    data: { object: { customer: 'cus_x', amount_total: amountTotal, metadata } },
  });

  // The regression this exists for: donations and subscription checkouts share
  // one event type, and the subscription branch would read an undefined `tier`
  // straight onto subscriptionTier — repaying a donor by breaking their account.
  it('never touches the donor\'s subscription', async () => {
    const user = await createUser({ subscriptionTier: 'free' });

    const res = await sendWebhookEvent(donationEvent({ kind: 'donation', userId: user._id.toString() }));

    expect(res.status).toBe(200);
    const updated = await User.findById(user._id);
    expect(updated.subscriptionTier).toBe('free');
    expect(updated.stripeSubscriptionId).toBeFalsy();
  });

  it('records the donation against a signed-in donor', async () => {
    const user = await createUser();

    await sendWebhookEvent(donationEvent({ kind: 'donation', userId: user._id.toString() }, 1000));

    const updated = await User.findById(user._id);
    expect(updated.donationPrompt.donatedAt).toBeTruthy();
    expect(updated.donationPrompt.donatedTotalPence).toBe(1000);
  });

  it('accumulates a second donation rather than overwriting the first', async () => {
    const user = await createUser();
    const meta = { kind: 'donation', userId: user._id.toString() };

    await sendWebhookEvent(donationEvent(meta, 300));
    await sendWebhookEvent(donationEvent(meta, 2000));

    const updated = await User.findById(user._id);
    expect(updated.donationPrompt.donatedTotalPence).toBe(2300);
  });

  // Anonymous is the normal case and must not be an error — Stripe retries a
  // non-2xx, so a throw here would replay the event forever.
  it('accepts an anonymous donation with nothing to write', async () => {
    const res = await sendWebhookEvent(donationEvent({ kind: 'donation', userId: '' }));
    expect(res.status).toBe(200);
  });
});
