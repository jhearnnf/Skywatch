/**
 * attributeUnlinkedDonations.js
 *
 * Before the questionnaire sent its token with a donation, a respondent who
 * gave while signed out (the usual case: the survey is opened from an emailed
 * link) arrived at the webhook with no account and no visit key. The payment was
 * kept, as a `stripe:<sessionId>` DonationPageVisit row, but nobody was credited
 * and nobody got the Supporter badge. Payment Links shared by hand land in the
 * same place.
 *
 * Those rows carry the Checkout session id, so this asks Stripe for the receipt
 * email on each one and looks for an account with that email. A match is a
 * strong guess, not proof (someone can pay with a different address to the one
 * they signed up with), so the dry run prints every row for a human to check.
 *
 * --apply moves each matched gift onto the account, as the webhook would have
 * written it, and deletes the visit row in the same step: the admin total sums
 * accounts AND visit rows, so leaving the row would count the money twice.
 * Re-running is safe, because a moved row no longer exists to be moved again.
 *
 * Unmatched rows are left exactly as they are.
 *
 * Usage:
 *   node backend/scripts/attributeUnlinkedDonations.js
 *   node backend/scripts/attributeUnlinkedDonations.js --apply
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const stripe   = require('stripe')(process.env.STRIPE_SECRET_KEY);

const User              = require('../models/User');
const DonationPageVisit = require('../models/DonationPageVisit');

const apply = process.argv.includes('--apply');

const gbp = (pence) => `£${(pence / 100).toFixed(2)}`;
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const rows = await DonationPageVisit.find({ paidAt: { $ne: null }, visitKey: /^stripe:/ })
    .sort({ paidAt: 1 })
    .lean();

  if (!rows.length) {
    console.log('No unlinked donations. Nothing to do.');
    await mongoose.disconnect();
    return;
  }

  console.log(`${rows.length} unlinked donation(s):\n`);
  const matches = [];

  for (const row of rows) {
    const sessionId = row.visitKey.slice('stripe:'.length);
    let email = null;
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      email = session.customer_details?.email || session.customer_email || null;
    } catch (err) {
      console.log(`  ${gbp(row.paidPence)}  ${row.paidAt.toISOString()}  ${sessionId}`);
      console.log(`    could not read the session from Stripe: ${err.message}\n`);
      continue;
    }

    const user = email
      ? await User.findOne({ email: new RegExp(`^${escapeRegex(email)}$`, 'i') })
          .select('displayName email agentNumber donationPrompt')
          .lean()
      : null;

    console.log(`  ${gbp(row.paidPence)}  ${row.paidAt.toISOString()}  ${sessionId}`);
    console.log(`    receipt email: ${email ?? '(none)'}`);
    console.log(user
      ? `    MATCH: ${user.displayName ?? '—'} #${user.agentNumber ?? '—'} <${user.email}>`
        + (user.donationPrompt?.donatedAt ? ` (already a donor, ${gbp(user.donationPrompt.donatedTotalPence ?? 0)})` : '')
      : '    no account with that email, left as it is');
    console.log('');

    if (user) matches.push({ row, user });
  }

  if (!matches.length) {
    console.log('No matches. Nothing to write.');
    await mongoose.disconnect();
    return;
  }

  if (!apply) {
    console.log(`DRY RUN. Would credit ${matches.length} donation(s) to the matched accounts above.`);
    console.log('Check each match, then re-run with --apply to write them.');
    await mongoose.disconnect();
    return;
  }

  for (const { row, user } of matches) {
    // `donatedAt` is the most recent gift, so an older backfilled payment must
    // not pull a later one backwards.
    const prev = user.donationPrompt?.donatedAt ? new Date(user.donationPrompt.donatedAt) : null;
    const donatedAt = prev && prev > row.paidAt ? prev : row.paidAt;

    const session = await mongoose.startSession().catch(() => null);
    const write = async (opts) => {
      await User.updateOne(
        { _id: user._id },
        {
          $set: { 'donationPrompt.donatedAt': donatedAt },
          $inc: { 'donationPrompt.donatedTotalPence': row.paidPence ?? 0 },
        },
        opts,
      );
      await DonationPageVisit.deleteOne({ _id: row._id }, opts);
    };

    // A transaction where the deployment supports one (Atlas does), so the
    // money can never be on both the account and the visit row at once.
    if (session) {
      try {
        await session.withTransaction(() => write({ session }));
      } finally {
        await session.endSession();
      }
    } else {
      await write({});
    }
    console.log(`Credited ${gbp(row.paidPence)} to ${user.displayName ?? user.email}.`);
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exitCode = 1;
});
