const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const User   = require('../models/User');
const { effectiveTier } = require('../utils/subscription');
const { grantSubscriptionUnlocks } = require('../utils/subscriptionUnlocks');
const DonationPageVisit = require('../models/DonationPageVisit');

const tierByPrice = () => ({
  [process.env.STRIPE_SILVER_PRICE_ID]: 'silver',
  [process.env.STRIPE_GOLD_PRICE_ID]:   'gold',
});

// Record a completed donation.
//
// Two destinations, and exactly one is written per payment, so the admin total
// can sum both without counting a gift twice.
//
// A signed-in donor is recorded on their account, because the app needs it there
// anyway: `donatedAt` is what stops the post-game ask appearing for someone who
// has already given. Before donations went through our own Checkout session we
// could not observe a payment at all, and the ask relied on the dismissal cap.
//
// Anyone else is recorded on their /donate visit row. Stripe is the system of
// record for money either way, but "we received nothing" and "we received
// something and threw the fact away" are not the same admin stat, and /donate
// does not require an account on purpose — so unnamed donors are the normal
// case, not the edge one. They stay unnamed here: `visitKey` is a counter, and
// nothing about the donor is copied out of Stripe.
//
// `amount_total` off the session rather than the metadata: Stripe is the
// authority on what was actually charged, not what button was pressed.
async function recordDonation(session, userId) {
  const pence = Number.isFinite(session.amount_total)
    ? session.amount_total
    : Number(session.metadata?.amountPence) || 0;

  if (userId) {
    await User.updateOne(
      { _id: userId },
      {
        $set: { 'donationPrompt.donatedAt': new Date() },
        $inc: { 'donationPrompt.donatedTotalPence': pence },
      },
    );
    console.log(`Stripe donation complete: user ${userId}, ${pence}p`);
    return;
  }

  const visitKey = session.metadata?.visitKey;
  if (visitKey) {
    await DonationPageVisit.recordPayment(visitKey, pence);
    console.log(`Stripe donation complete: anonymous, ${pence}p`);
    return;
  }

  // Neither an account nor a visit key. This is a Payment Link: made in the
  // Stripe dashboard and shared by hand, so it carries none of the metadata our
  // own route sets. SkyWatch's first ever donation arrived this way and was
  // dropped on the floor, which is what this branch exists to stop.
  await DonationPageVisit.recordSessionPayment(session.id, pence);
  console.log(`Stripe donation complete: unattributed, ${pence}p`);
}

// Whether this completed session is a donation.
//
// `kind` is set by our own create-donation-session route, and was the only test
// until a Payment Link turned up with `metadata: {}` and fell through to the
// subscription branch — harmless, and completely invisible.
//
// `mode` is the durable signal, because Stripe sets it rather than us: this app
// creates exactly two kinds of session, and subscriptions are 'subscription'.
// Anything one-off is a donation however it was started.
const isDonation = (session) =>
  session.metadata?.kind === 'donation' || session.mode === 'payment';

// Whether the money has actually arrived.
//
// `checkout.session.completed` does NOT mean paid. A card settles inside the
// session and arrives here as 'paid', but a delayed method — a bank debit —
// completes the session with the payment still pending and only confirms later,
// on checkout.session.async_payment_succeeded. Counting the first of those as
// received would put money on the admin tile that may never turn up.
const isPaid = (session) => session.payment_status === 'paid';

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
        if (isDonation(session)) {
          if (isPaid(session)) await recordDonation(session, userId);
          else console.log(`Stripe donation pending: ${session.payment_status}, awaiting async payment`);
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

      // The other half of the delayed-payment case above: the session completed
      // some time ago unpaid, and the money has now cleared. Donations only —
      // subscriptions are card-only and settle inside the session.
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object;
        if (!isDonation(session)) break;
        await recordDonation(session, session.metadata?.userId);
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
