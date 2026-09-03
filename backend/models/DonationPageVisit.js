const mongoose = require('mongoose');

// One row per person who reached /donate.
//
// The other two donation asks are recorded on documents we already have. The
// post-game note writes to User.donationPrompt and the questionnaire's closing
// ask writes to SurveyResponse.donationClicked, because both of those only ever
// appear to someone we already know by name. /donate is different: it is public
// on purpose — putting a sign-up in front of a gift is the surest way not to
// receive one — so most of the people it is shown to have no account for the
// count to live on, and it needs a store of its own.
//
// COUNTED IN PEOPLE, not page views, to match the rest of the donation funnel:
// one enthusiast opening the page five times is one person who was asked, not
// five. `visitKey` is what makes that true. Signed in it is the account id, so
// every visit they ever make folds into the one row. Signed out it is a random
// id the page keeps in sessionStorage, which dedupes a reload or a bounce back
// from a cancelled Checkout without leaving a durable identifier on the device.
//
// It is a counter, not an identity. Nothing reads it back to the visitor and
// nothing else in the app keys off it.
const donationPageVisitSchema = new mongoose.Schema({
  visitKey:  { type: String, required: true, unique: true },
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  arrivedAt: { type: Date, default: Date.now },

  // The most recent press-through to Stripe from this page — the same stage of
  // the funnel as a click on either of the other two asks, and set from the
  // Checkout session endpoint rather than the click handler so it cannot claim
  // a conversion the server never actually started.
  //
  // NOT proof of a payment. That is `paidAt` below.
  checkoutStartedAt: { type: Date,   default: null },
  checkoutCount:     { type: Number, default: 0 },

  // Proof of a payment, written by Stripe's webhook and nothing else.
  //
  // A signed-in donor's money is recorded on User.donationPrompt instead, because
  // the app needs it there anyway to stop asking them again. This pair is for
  // everyone else, and until it existed an anonymous donation was logged to the
  // console and stored nowhere at all — which, on a page that deliberately does
  // not require an account, is most of them. Exactly one of the two places is
  // written per payment, so the admin total can sum both without double counting.
  paidAt:    { type: Date,   default: null },
  paidPence: { type: Number, default: 0 },
}, { timestamps: true });

// A signed-in visitor is keyed by account so their visits collapse into one
// person; everyone else brings their own random key.
donationPageVisitSchema.statics.keyFor = function keyFor(userId, clientKey) {
  if (userId) return `u:${userId}`;
  if (typeof clientKey !== 'string') return null;
  const trimmed = clientKey.trim();
  // Long enough not to collide, short enough not to be a payload. The page
  // generates 32 hex characters; anything outside that shape is a client we
  // did not write, and a bad key is worth dropping rather than storing.
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(trimmed)) return null;
  return `g:${trimmed}`;
};

// Record that someone reached the page. Idempotent: the first arrival inserts,
// every later one matches the existing row and writes nothing new. Best effort
// at every call site — a stat must never cost someone their donation.
donationPageVisitSchema.statics.record = function record(visitKey, userId = null, when = new Date()) {
  return this.updateOne(
    { visitKey },
    { $setOnInsert: { visitKey, userId: userId ?? null, arrivedAt: when } },
    { upsert: true },
  );
};

// Record that this visit pressed through to Stripe. Upserts too, because a
// Checkout session can legitimately be the first thing we hear about a visit
// (an arrival report can be blocked, dropped or simply beaten to the server).
donationPageVisitSchema.statics.recordCheckout = function recordCheckout(visitKey, userId = null, when = new Date()) {
  return this.updateOne(
    { visitKey },
    {
      $set:        { checkoutStartedAt: when },
      $inc:        { checkoutCount: 1 },
      $setOnInsert: { visitKey, userId: userId ?? null, arrivedAt: when },
    },
    { upsert: true },
  );
};

// Record that this visit actually paid. Only ever called for a donor we cannot
// name; a signed-in one is recorded against their account.
//
// `paidPence` accumulates rather than overwrites for the same reason
// User.donationPrompt.donatedTotalPence does: a visitKey outlives one payment
// (signed out it survives for the session, and a second gift from the same tab
// reuses the row), and a repeat donor must raise the total, not replace it.
donationPageVisitSchema.statics.recordPayment = function recordPayment(visitKey, pence, when = new Date()) {
  return this.updateOne(
    { visitKey },
    {
      $set:         { paidAt: when },
      $inc:         { paidPence: Math.max(0, Number(pence) || 0) },
      $setOnInsert: { visitKey, userId: null, arrivedAt: when },
    },
    { upsert: true },
  );
};

// Record a donation that arrived with no account and no visit key — a Stripe
// Payment Link, which carries none of our metadata because we never built the
// session. Keyed by the Checkout session id, which is unique per payment.
//
// `$set` rather than `$inc`, unlike the two above: one session is one payment,
// so a redelivery of the same event must land on the same total rather than
// adding to it. Stripe retries a non-2xx and can occasionally redeliver a
// success, and this is the one path where that is cheap to make safe.
donationPageVisitSchema.statics.recordSessionPayment = function recordSessionPayment(sessionId, pence, when = new Date()) {
  const visitKey = `stripe:${sessionId}`;
  return this.updateOne(
    { visitKey },
    {
      $set:         { paidAt: when, paidPence: Math.max(0, Number(pence) || 0) },
      $setOnInsert: { visitKey, userId: null, arrivedAt: when },
    },
    { upsert: true },
  );
};

module.exports = mongoose.model('DonationPageVisit', donationPageVisitSchema);
