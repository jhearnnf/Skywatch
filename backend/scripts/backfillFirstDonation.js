/**
 * backfillFirstDonation.js
 *
 * SkyWatch's first donation: £3 from waddobean, received before any of this was
 * instrumented. Stripe has the payment; the app has no record of it, so the
 * admin "Donations Received" tile reads £0 despite the money having arrived.
 *
 * Writes what the webhook would have written had it existed at the time:
 * `donationPrompt.donatedAt` and `donatedTotalPence` on their account. Setting
 * `donatedAt` also stops the post-game donation note appearing for them, which
 * is correct — they have already given.
 *
 * Idempotent by refusing to run twice rather than by overwriting: `donatedAt` is
 * a hard stop and `donatedTotalPence` accumulates, so a second run would silently
 * double the total. If the account already shows a donation, this reports it and
 * changes nothing.
 *
 * Dry-run by default. Pass --apply to write.
 *
 * Usage:
 *   node backend/scripts/backfillFirstDonation.js
 *   node backend/scripts/backfillFirstDonation.js --apply
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

const User = require('../models/User');

const DISPLAY_NAME = 'waddobean';
const PENCE        = 300;

// The donation predates the instrumentation, so there is no Stripe timestamp to
// read back into the app. Dated to the day it is being recorded rather than
// invented: the tile totals money, and nothing reads this as a payment date.
const DONATED_AT = new Date();

const apply = process.argv.includes('--apply');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  // Matched on displayNameLower, which is the field the uniqueness index and
  // @mentions both use, so it is the one that reliably holds a single account.
  const user = await User.findOne({ displayNameLower: DISPLAY_NAME.toLowerCase() })
    .select('displayName email agentNumber donationPrompt');

  if (!user) {
    console.error(`No account with the display name "${DISPLAY_NAME}".`);
    await mongoose.disconnect();
    process.exitCode = 1;
    return;
  }

  const already = user.donationPrompt?.donatedAt;
  console.log(`Found: ${user.displayName} #${user.agentNumber ?? '—'} <${user.email}>`);
  console.log(`  donatedAt:         ${already ?? 'null'}`);
  console.log(`  donatedTotalPence: ${user.donationPrompt?.donatedTotalPence ?? 0}`);

  if (already) {
    console.log('\nThis account already has a donation recorded. Nothing to do.');
    await mongoose.disconnect();
    return;
  }

  if (!apply) {
    console.log(`\nDRY RUN. Would set donatedAt=${DONATED_AT.toISOString()} and add ${PENCE}p.`);
    console.log('Re-run with --apply to write it.');
    await mongoose.disconnect();
    return;
  }

  await User.updateOne(
    { _id: user._id },
    {
      $set: { 'donationPrompt.donatedAt': DONATED_AT },
      $inc: { 'donationPrompt.donatedTotalPence': PENCE },
    },
  );

  const after = await User.findById(user._id).select('donationPrompt');
  console.log(`\nWritten. donatedAt=${after.donationPrompt.donatedAt.toISOString()}, `
            + `donatedTotalPence=${after.donationPrompt.donatedTotalPence}`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exitCode = 1;
});
