/**
 * addRosterUpdateNotification.js
 *
 * Adds the in-app announcement for the roster-completion release: the six new
 * practice games, the Aptitude Report, the Community tab, and an invitation for
 * readers to say what they want built next.
 *
 * Written as a script rather than typed into the admin editor so the copy is in
 * version control and can be re-run against a fresh database.
 *
 * CREATED DISABLED ON PURPOSE. `enabled: false` means nobody sees it until it is
 * switched on from Admin > Update Notifications, which is what lets the copy be
 * read over first. Nothing here publishes anything.
 *
 * Idempotent: matches on the exact title and updates that doc instead of adding
 * a second one, so re-running after a copy edit does not litter the collection.
 * `enabled` is never touched on an update, so re-running cannot silently
 * un-publish (or publish) a notification an admin has already decided about.
 *
 * Usage:
 *   node backend/scripts/addRosterUpdateNotification.js            # dry run
 *   node backend/scripts/addRosterUpdateNotification.js --apply    # writes
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const UpdateNotification = require('../models/UpdateNotification');

const APPLY = process.argv.includes('--apply');

const TITLE = 'Six new games, the Aptitude Report, and Community';

// Plain text, not rich HTML: `body` is what every client can render, and the
// linkifier turns [label](url) into a real link on all of them.
//
// House rules this copy follows, all of them things that have been corrected
// before: no em dashes anywhere, UK spelling, "practise" as the verb, SkyWatch
// with a capital W, and never a suggestion that SkyWatch holds the real test
// material. The claim made below is about OUR coverage, which is why it says
// "practice game built for it" rather than anything about the real subtests.
const BODY = `Hello SkyWatch Users,

James here, the developer of SkyWatch. Here is what has been added over the last few weeks.

SIX NEW PRACTICE GAMES

Spatial Integration, System Logic, Verbal Logic, Table Reading, Vigilance and the Sensory Motor Apparatus test are all live. That means every test in the CBAT now has a SkyWatch practice game built for it, so you can prepare for the whole battery in one place instead of hunting around for the parts nobody covers. As always, all of it is free.

THE APTITUDE REPORT

There is a new dashboard at [Aptitude Report](https://SkyWatch.Academy/cbat/report). Play the games and it works out roughly where your scores would sit against the pass mark for whichever role you pick, then shows you which skill areas are carrying you and which ones need the work. Every role has a different pass mark, so the same set of scores can clear one and miss another.

It is an estimate built from published score sheets. It is not an official result, and it is not a prediction. Treat it as a guide to where your practice time is best spent.

COMMUNITY

There is now a Community tab in the menu. It is a place to ask questions, compare notes, and speak to other people working through the same material. Bring your questions, and if you have been through any of this already, your answers are worth even more.

WHAT WOULD YOU LIKE TO SEE NEXT?

This is the part I would most like your help with. If there is a game, a feature, or a piece of learning material you want on SkyWatch, tell me in the box below. I read every reply, and a good number of the things now on the site started life as a suggestion in one of these boxes.

Kind regards,
James
SkyWatch Developer`;

const DOC = {
  title: TITLE,
  body: BODY,
  richBody: '',
  imageMode: 'none',
  imageUrl: '',
  // Reviewed and switched on by hand from the admin editor.
  enabled: false,
  validFrom: null,
  expiresAt: null,
  // The whole point of this one: readers are asked what to build next, so they
  // need somewhere to answer.
  responsesEnabled: true,
  // Empty => shows on the first authenticated page load, wherever that is.
  targetPath: '',
  // "Here is what has been added" only makes sense to someone who was already
  // here. Anyone joining after this goes live just finds the features present.
  applyToExistingOnly: true,
  targetOs: [],
  targetUsers: [],
};

(async () => {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI missing from backend/.env');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI);

  const existing = await UpdateNotification.findOne({ title: TITLE });

  console.log(APPLY ? 'APPLY mode' : 'DRY RUN (pass --apply to write)');
  console.log(existing ? `Found existing notification ${existing._id}` : 'No existing notification with this title');
  console.log('----------------------------------------');
  console.log(`title:            ${DOC.title}`);
  console.log(`enabled:          ${DOC.enabled}   <-- stays off until switched on in Admin`);
  console.log(`responsesEnabled: ${DOC.responsesEnabled}`);
  console.log(`applyToExistingOnly: ${DOC.applyToExistingOnly}`);
  console.log('----------------------------------------');
  console.log(DOC.body);
  console.log('----------------------------------------');

  if (!APPLY) {
    await mongoose.disconnect();
    return;
  }

  if (existing) {
    // `enabled` is deliberately excluded: once an admin has published or
    // unpublished this, re-running to fix a typo must not flip that back.
    const { enabled, ...updatable } = DOC;
    void enabled;
    await UpdateNotification.updateOne({ _id: existing._id }, { $set: updatable });
    console.log(`Updated ${existing._id} (enabled left as ${existing.enabled})`);
  } else {
    const created = await UpdateNotification.create(DOC);
    console.log(`Created ${created._id} with enabled=false`);
  }

  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
