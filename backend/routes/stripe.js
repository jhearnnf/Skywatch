const express = require('express');
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { protect } = require('../middleware/auth');
const User    = require('../models/User');

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
        ...(trial ? { trial_period_days: 2 } : {}),
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

module.exports = router;
