const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User   = require('../models/User');
const { effectiveTier } = require('../utils/subscription');
const { grantSubscriptionUnlocks } = require('../utils/subscriptionUnlocks');

const tierByPrice = () => ({
  [process.env.STRIPE_SILVER_PRICE_ID]: 'silver',
  [process.env.STRIPE_GOLD_PRICE_ID]:   'gold',
});

module.exports = async function stripeWebhook(req, res) {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    const priceToTier = tierByPrice();

    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object;
        const { userId, tier, isTrial } = session.metadata ?? {};
        if (!userId) break;

        const user = await User.findById(userId);
        if (!user) break;

        const oldTier = effectiveTier(user);

        user.stripeCustomerId     = session.customer;
        user.stripeSubscriptionId = session.subscription;

        if (isTrial === 'true') {
          user.subscriptionTier  = 'trial';
          user.trialStartDate    = new Date();
          user.trialDurationDays = 5;
        } else {
          user.subscriptionTier      = tier;
          user.subscriptionStartDate = new Date();
        }

        await user.save();
        await grantSubscriptionUnlocks(user._id, oldTier);
        console.log(`Stripe checkout complete: user ${userId} → ${isTrial === 'true' ? 'trial' : tier}`);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const userId = subscription.metadata?.userId;
        if (!userId) break;

        const user = await User.findById(userId);
        if (!user) break;

        const priceId = subscription.items.data[0]?.price?.id;
        const newTier = priceToTier[priceId];

        if (subscription.status === 'active' && newTier) {
          // Handles: trial → paid conversion, and silver ↔ gold switches
          if (newTier !== user.subscriptionTier) {
            const oldTier = effectiveTier(user);
            user.subscriptionTier      = newTier;
            user.subscriptionStartDate = subscription.current_period_start
              ? new Date(subscription.current_period_start * 1000)
              : new Date();
            await user.save();
            await grantSubscriptionUnlocks(user._id, oldTier);
            console.log(`Stripe subscription updated: user ${userId} → ${newTier}`);
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const userId = subscription.metadata?.userId;
        if (!userId) break;

        const user = await User.findById(userId);
        if (!user) break;

        user.subscriptionTier     = 'free';
        user.stripeSubscriptionId = null;
        await user.save();
        console.log(`Stripe subscription cancelled: user ${userId} → free`);
        break;
      }

      case 'invoice.payment_failed':
        // Stripe handles retries via dunning settings. Log only.
        console.warn('Stripe payment failed for customer:', event.data.object.customer);
        break;

      default:
        break;
    }
  } catch (err) {
    console.error('Stripe webhook handler error:', err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }

  res.json({ received: true });
};
