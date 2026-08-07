'use strict';

/**
 * Put the CBAT Community Guide in the Community rail's Guides section.
 *
 * Seeded rather than left for an admin to add because the document it points at
 * ships in the same deploy — the link cannot be dead.
 *
 * Runs once, ever. The flag on AppSettings is what makes that true: an admin who
 * removes the guide, or edits its title, is not overruled on the next boot. The
 * same reasoning as the Medals channel in seedChatBot.js, which can lean on an
 * archived row surviving; a deleted guide leaves nothing behind to check.
 */

const AppSettings = require('../models/AppSettings');
const ChatGuide   = require('../models/ChatGuide');

// The guide is a standalone document served straight from the frontend's
// public/ folder — its own typography, not the app's — so this is a file path
// and not an app route. The rail links it with a plain anchor for that reason.
const GUIDE_PATH = '/cbat-guide.html';

// The row first shipped pointing at "/cbat-guide" — an app route, not the
// document — which slim mode bounced to /cbat. Repaired on every boot rather
// than inside the one-shot guard below, because a database that already took
// the bad URL would never be corrected otherwise. A no-op once done.
const LEGACY_PATHS = ['/cbat-guide'];

async function seedChatGuides() {
  await ChatGuide.updateMany(
    { url: { $in: LEGACY_PATHS } },
    { $set: { url: GUIDE_PATH } },
  );

  const settings = await AppSettings.getSettings();
  if (settings.communityGuidesSeeded) return { created: false };

  // Belt and braces: an admin who added it by hand before this shipped should
  // not end up with two rows.
  const exists = await ChatGuide.exists({ url: GUIDE_PATH });
  if (!exists) {
    await ChatGuide.create({
      title:       'CBAT Community Guide',
      url:         GUIDE_PATH,
      description: 'What candidates reported after sitting the test',
      emoji:       '📖',
      order:       0,
    });
  }

  settings.communityGuidesSeeded = true;
  await settings.save();
  return { created: !exists };
}

module.exports = seedChatGuides;
module.exports.GUIDE_PATH = GUIDE_PATH;
