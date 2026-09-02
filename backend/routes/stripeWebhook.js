const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User   = require('../models/User');
const { effectiveTier } = require('../utils/subscription');
const { grantSubscriptionUnlocks } = require('../utils/subscriptionUnlocks');

const tierByPrice = () => ({
  [process.env.STRIPE_SILVER_PRICE_ID]: 'silver',
  [process.env.STRIPE_GOLD_PRICE_ID]:   'gold',
});

// Record a completed donation against the donor, when we know who they are.
//
// Anonymous donations are the normal case (/donate does not require an
// account) and there is nothing to write for those — the payment itself lives
// in Stripe, which is the system of record for money. What this is for is the
// one thing the app needs to know: that this person has already given, so the
// post-game ask stops appearing for them. Before donations went through our own
// Checkout session we could not observe a payment at all, and the ask had to
// rely on the dismissal cap alone.
//
// `amount_total` off the session rather than the metadata: Stripe is the
// authority on what was actually charged.
async function recordDonation(session, userId) {
  const pence = Number.isFinite(session.amount_total)
    ? session.amount_total
    : Number(session.metadata?.amountPence) || 0;

  if (!userId) {
    console.log(`Stripe donation complete: anonymous, ${pence}p`);
    return;
  }

  await User.updateOne(
    { _id: userId },
    {
      $set: { 'donationPrompt.donatedAt': new Date() },
      $inc: { 'donationPrompt.donatedTotalPence': pence },
    },
  );
  console.log(`Stripe donation complete: user ${userId}, ${pence}p`);
}

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
        const { userId, tier, isTrial, kind } = session.metadata ?? {};

        // One-off donations arrive on this same event. They must be handled
        // and returned BEFORE the subscription branch below, which would
        // otherwise read an undefined `tier` off the metadata and write it
        // straight onto subscriptionTier — repaying a donor by breaking their
        // account. The `kind` marker is set in routes/stripe.js.
        if (kind === 'donation') {
          await recordDonation(session, userId);
          break;
        }

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
