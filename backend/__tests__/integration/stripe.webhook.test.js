/**
 * Stripe webhook integration tests.
 *
 * Mocks stripe.webhooks.constructEvent so no real Stripe credentials are
 * needed, but exercises the real webhook handler + real MongoDB.
 */

process.env.JWT_SECRET              = 'test_secret';
process.env.STRIPE_SECRET_KEY       = 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET   = 'whsec_dummy';
process.env.STRIPE_SILVER_PRICE_ID  = 'price_silver_test';
process.env.STRIPE_GOLD_PRICE_ID    = 'price_gold_test';

// Mock stripe before any requires
jest.mock('stripe', () => {
  const mockConstructEvent = jest.fn();
  const mockStripe = jest.fn(() => ({
    webhooks: { constructEvent: mockConstructEvent },
    customers: { create: jest.fn().mockResolvedValue({ id: 'cus_test123' }) },
    checkout: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/test' }) } },
    billingPortal: { sessions: { create: jest.fn().mockResolvedValue({ url: 'https://billing.stripe.com/test' }) } },
  }));
  mockStripe._mockConstructEvent = mockConstructEvent;
  return mockStripe;
});

const request = require('supertest');
const stripe  = require('stripe');
const app     = require('../../app');
const db      = require('../helpers/setupDb');
const { createUser } = require('../helpers/factories');

const mockConstructEvent = stripe._mockConstructEvent;

beforeAll(async () => { await db.connect(); });
afterEach(async () => { await db.clearDatabase(); jest.clearAllMocks(); });
afterAll(async () => { await db.closeDatabase(); });

// Helper: fire a fake Stripe webhook event
async function sendWebhookEvent(event) {
  mockConstructEvent.mockReturnValue(event);
  return request(app)
    .post('/api/stripe/webhook')
    .set('stripe-signature', 'dummy-sig')
    .set('Content-Type', 'application/json')
    .send(Buffer.from(JSON.stringify(event)));
}

// ── checkout.session.completed ────────────────────────────────────────────
describe('checkout.session.completed', () => {
  it('activates silver subscription for non-trial checkout', async () => {
    const user = await createUser({ subscriptionTier: 'free' });

    const res = await sendWebhookEvent({
      type: 'checkout.session.completed',
      data: {
        object: {
          customer:     'cus_abc123',
          subscription: 'sub_abc123',
          metadata:     { userId: user._id.toString(), tier: 'silver', isTrial: 'false' },
        },
      },
    });

    expect(res.status).toBe(200);
    const updated = await require('../../models/User').findById(user._id);
    expect(updated.subscriptionTier).toBe('silver');
    expect(updated.stripeCustomerId).toBe('cus_abc123');
    expect(updated.stripeSubscriptionId).toBe('sub_abc123');
    expect(updated.subscriptionStartDate).toBeTruthy();
  });

  it('sets trial tier for trial checkout', async () => {
    const user = await createUser({ subscriptionTier: 'free' });

    const res = await sendWebhookEvent({
      type: 'checkout.session.completed',
      data: {
        object: {
          customer:     'cus_trial',
          subscription: 'sub_trial',
          metadata:     { userId: user._id.toString(), tier: 'silver', isTrial: 'true' },
        },
      },
    });

    expect(res.status).toBe(200);
    const updated = await require('../../models/User').findById(user._id);
    expect(updated.subscriptionTier).toBe('trial');
    expect(updated.trialStartDate).toBeTruthy();
    expect(updated.trialDurationDays).toBe(5);
  });

  it('activates gold subscription', async () => {
    const user = await createUser({ subscriptionTier: 'free' });

    await sendWebhookEvent({
      type: 'checkout.session.completed',
      data: {
        object: {
          customer:     'cus_gold',
          subscription: 'sub_gold',
          metadata:     { userId: user._id.toString(), tier: 'gold', isTrial: 'false' },
        },
      },
    });

    const updated = await require('../../models/User').findById(user._id);
    expect(updated.subscriptionTier).toBe('gold');
  });

  it('does nothing for unknown userId', async () => {
    const fakeId = '64a0000000000000000000ab';
    const res = await sendWebhookEvent({
      type: 'checkout.session.completed',
      data: {
        object: {
          customer:     'cus_x',
          subscription: 'sub_x',
          metadata:     { userId: fakeId, tier: 'silver', isTrial: 'false' },
        },
      },
    });
    expect(res.status).toBe(200); // handler still returns 200 — it just skips
  });
});

// ── customer.subscription.updated ────────────────────────────────────────
describe('customer.subscription.updated', () => {
  it('converts trial to silver when subscription becomes active', async () => {
    const user = await createUser({
      subscriptionTier:    'trial',
      stripeCustomerId:    'cus_trial',
      stripeSubscriptionId: 'sub_trial',
      trialStartDate:      new Date(),
    });

    await sendWebhookEvent({
      type: 'customer.subscription.updated',
      data: {
        object: {
          status:                'active',
          current_period_start:  Math.floor(Date.now() / 1000),
          metadata:              { userId: user._id.toString(), tier: 'silver' },
          items:                 { data: [{ price: { id: 'price_silver_test' } }] },
        },
      },
    });

    const updated = await require('../../models/User').findById(user._id);
    expect(updated.subscriptionTier).toBe('silver');
    expect(updated.subscriptionStartDate).toBeTruthy();
  });

  it('upgrades silver to gold when plan switches', async () => {
    const user = await createUser({
      subscriptionTier:    'silver',
      stripeCustomerId:    'cus_sil',
      stripeSubscriptionId: 'sub_sil',
    });

    await sendWebhookEvent({
      type: 'customer.subscription.updated',
      data: {
        object: {
          status:               'active',
          current_period_start: Math.floor(Date.now() / 1000),
          metadata:             { userId: user._id.toString(), tier: 'gold' },
          items:                { data: [{ price: { id: 'price_gold_test' } }] },
        },
      },
    });

    const updated = await require('../../models/User').findById(user._id);
    expect(updated.subscriptionTier).toBe('gold');
  });
});

// ── customer.subscription.deleted ────────────────────────────────────────
describe('customer.subscription.deleted', () => {
  it('downgrades user to free and clears stripeSubscriptionId', async () => {
    const user = await createUser({
      subscriptionTier:    'silver',
      stripeCustomerId:    'cus_del',
      stripeSubscriptionId: 'sub_del',
    });

    await sendWebhookEvent({
      type: 'customer.subscription.deleted',
      data: {
        object: {
          metadata: { userId: user._id.toString() },
        },
      },
    });

    const updated = await require('../../models/User').findById(user._id);
    expect(updated.subscriptionTier).toBe('free');
    expect(updated.stripeSubscriptionId).toBeNull();
  });
});

// ── Signature verification ────────────────────────────────────────────────
describe('webhook signature', () => {
  it('returns 400 when signature verification fails', async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error('Invalid signature');
    });

    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('stripe-signature', 'bad-sig')
      .set('Content-Type', 'application/json')
      .send(Buffer.from('{}'));

    expect(res.status).toBe(400);
  });
});
