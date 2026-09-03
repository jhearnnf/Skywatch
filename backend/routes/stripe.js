const express      = require('express');
const stripe       = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { protect, optionalAuth } = require('../middleware/auth');
const User         = require('../models/User');
const AppSettings  = require('../models/AppSettings');
const DonationPageVisit = require('../models/DonationPageVisit');

const router = express.Router();

const PRICE_IDS = {
  silver: process.env.STRIPE_SILVER_PRICE_ID,
  gold:   process.env.STRIPE_GOLD_PRICE_ID,
};

// POST /api/stripe/create-checkout-session
router.post('/create-checkout-session', protect, async (req, res) => {
  try {
    const { tier, trial = false } = req.body;
    if (!['silver', 'gold'].includes(tier)) {
      return res.status(400).json({ error: 'Invalid tier' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Get or create Stripe customer
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email:    user.email,
        metadata: { userId: user._id.toString() },
      });
      customerId = customer.id;
      user.stripeCustomerId = customerId;
      await user.save();
    }

    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    const settings  = await AppSettings.getSettings();
    const trialDays = user.trialSource === 'app'
      ? (settings.appStripeTrialDays ?? 2)
      : (settings.webStripeTrialDays ?? 5);

    const session = await stripe.checkout.sessions.create({
      customer:             customerId,
      mode:                 'subscription',
      line_items:           [{ price: PRICE_IDS[tier], quantity: 1 }],
      success_url:          `${clientUrl}/subscribe?stripe=success`,
      cancel_url:           `${clientUrl}/subscribe?stripe=cancelled`,
      metadata:             { userId: user._id.toString(), tier, isTrial: trial ? 'true' : 'false' },
      allow_promotion_codes: true,
      subscription_data: {
        metadata:           { userId: user._id.toString(), tier },
        ...(trial ? { trial_period_days: trialDays } : {}),
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Create checkout session error:', err);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// POST /api/stripe/create-portal-session
router.post('/create-portal-session', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user?.stripeCustomerId) {
      return res.status(400).json({ error: 'No active subscription found' });
    }

    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';

    const session = await stripe.billingPortal.sessions.create({
      customer:   user.stripeCustomerId,
      return_url: `${clientUrl}/subscribe`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Create portal session error:', err);
    res.status(500).json({ error: 'Failed to create portal session' });
  }
});

// ── One-off donations ────────────────────────────────────────────────────────
// The donation flow is deliberately NOT a Stripe payment link with one fixed
// amount. A link can only ever offer the amount it was created with, which is
// why the old ask could say "£3" and nothing else; an ad-hoc Checkout session
// with `price_data` lets /donate offer a range without an admin having to
// create a Price in Stripe for every figure someone might pick.
//
// `optionalAuth` rather than `protect`: /donate is a public page and gating a
// donation behind a sign-up is the surest way not to receive one. A signed-in
// donor is still identified, which is what lets us stop asking them again
// (see donationPromptDue) and pre-fills their receipt email.
const DONATION_MIN_PENCE = 100;    // £1
const DONATION_MAX_PENCE = 50000;  // £500

function donationPence(amount) {
  // Pounds in, integer pence out. Rounding rather than truncating because
  // 3.5 * 100 is 350.00000000000006 in binary floating point, and £7.50 must
  // not arrive as 749p.
  const pence = Math.round(Number(amount) * 100);
  if (!Number.isFinite(pence)) return null;
  if (pence < DONATION_MIN_PENCE || pence > DONATION_MAX_PENCE) return null;
  return pence;
}

// POST /api/stripe/create-donation-session
router.post('/create-donation-session', optionalAuth, async (req, res) => {
  try {
    const pence = donationPence(req.body?.amount);
    if (pence == null) {
      return res.status(400).json({ error: 'Please choose an amount between £1 and £500.' });
    }

    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    const userId    = req.user?._id ? req.user._id.toString() : '';

    // Which ask sent them. Only /donate carries a `visitKey`, and stamping the
    // press-through here rather than in the click handler means the funnel can
    // only ever count a conversion the server genuinely started. The other two
    // asks record their own click against the account they were shown to, so
    // there is nothing to do for them.
    //
    // Best effort, and deliberately before the Stripe call rather than after:
    // this must not be able to fail a donation, and it must not wait on one.
    // Presence of the key is what identifies the page, not the signed-in state:
    // a signed-in donor is keyed by account, but only /donate sends a key at all.
    const clientKey = typeof req.body?.visitKey === 'string' ? req.body.visitKey : null;
    const visitKey  = clientKey ? DonationPageVisit.keyFor(req.user?._id, clientKey) : null;
    if (visitKey) {
      await DonationPageVisit.recordCheckout(visitKey, req.user?._id ?? null)
        .catch(err => console.error('Donation checkout record error:', err.message));
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      // Stripe relabels the pay button "Donate" and drops the subscription
      // framing from the summary. It costs nothing and it stops the page
      // reading as a purchase of something.
      submit_type: 'donate',
      line_items: [{
        quantity: 1,
        price_data: {
          currency:    'gbp',
          unit_amount: pence,
          product_data: {
            name:        'SkyWatch donation',
            description: 'A one-off contribution towards running costs. Not a subscription, and it does not unlock any features.',
          },
        },
      }],
      // Saves a signed-in donor retyping an address we already hold. Guests
      // still get the field; Stripe asks for it either way, for the receipt.
      ...(req.user?.email ? { customer_email: req.user.email } : {}),
      success_url: `${clientUrl}/donate?donation=success`,
      cancel_url:  `${clientUrl}/donate?donation=cancelled`,
      // `kind` is load-bearing, not documentation: the webhook shares one
      // checkout.session.completed handler with subscriptions and reads this
      // to tell the two apart. See routes/stripeWebhook.js.
      //
      // `visitKey` is how an anonymous payment finds its way home. The webhook
      // has no account to write one against, and without this it could only log
      // the money and forget it.
      metadata: { kind: 'donation', amountPence: String(pence), userId, visitKey: visitKey ?? '' },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Create donation session error:', err);
    res.status(500).json({ error: 'Failed to start the donation. Please try again.' });
  }
});

module.exports = router;
