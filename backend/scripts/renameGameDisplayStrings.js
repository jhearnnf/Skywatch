/**
 * renameGameDisplayStrings.js
 *
 * One-time DB migration to backfill the "Intel Quiz" → "Intel Recall" and
 * "Flashcard Recall" → "Flashcards" rename in two places that store the old
 * wording as data (not derived from code):
 *
 *   1. tutorials  — seeded once; admin edits survive deploys, so changing
 *                   the seed file alone won't update existing docs.
 *   2. airstarlogs — every historical award row has the human-readable
 *                    label baked into the `label` string field.
 *
 * Strategy: targeted string replacements. We only rewrite strings that exactly
 * match the old seed wording (or have a recognised prefix), so any
 * admin-edited tutorial copy is left alone. Idempotent — re-running on already
 * migrated data is a no-op.
 *
 * Usage:
 *   node backend/scripts/renameGameDisplayStrings.js           # dry-run
 *   node backend/scripts/renameGameDisplayStrings.js --apply   # write changes
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');

// ── Tutorial replacements ────────────────────────────────────────────────
// Each entry is { tutorialId, name?, steps: [{ match, replace }] } where
// `match` matches step.title or step.body and replaces with `replace`.
// Step replacements are applied to whichever field (title|body) equals the old.

const TUTORIAL_REPLACEMENTS = [
  {
    tutorialId: 'home',
    steps: [
      {
        match:   'Reading briefs and completing quizzes earns you Airstars. Collect enough Airstars to level up — the more you learn, the higher your level climbs.',
        replace: 'Reading briefs and completing Intel Recalls earns you Airstars. Collect enough Airstars to level up — the more you learn, the higher your level climbs.',
      },
    ],
  },
  {
    tutorialId: 'briefReader',
    steps: [
      { match: 'Unlock the Quiz', replace: 'Unlock Intel Recall' },
      {
        match:   "Once you've read all sections, a quiz becomes available. Complete it to test your knowledge, earn Airstars, and mark the brief as complete.",
        replace: "Once you've read all sections, Intel Recall becomes available. Complete it to test your knowledge, earn Airstars, and mark the brief as complete.",
      },
    ],
  },
  {
    tutorialId: 'quiz',
    name: { match: 'Intel Quiz', replace: 'Intel Recall' },
    steps: [
      { match: 'Quiz Time!', replace: 'Recall Time!' },
      {
        match:   'Every correct answer earns Airstars. Complete the quiz to lock in your score. You can retake quizzes to improve your understanding!',
        replace: 'Every correct answer earns Airstars. Complete the recall to lock in your score. You can retake any Intel Recall to improve your understanding!',
      },
    ],
  },
  {
    tutorialId: 'play',
    steps: [
      { match: 'Intel Quiz', replace: 'Intel Recall' },
      {
        match:   'This is your training games hub. Four game modes test your aviation knowledge in different ways — from quizzes to aircraft identification and tactical ordering.',
        replace: 'This is your training games hub. Four game modes test your aviation knowledge in different ways — from recall drills to aircraft identification and tactical ordering.',
      },
      {
        match:   'Live now! Arrange aircraft, ranks, and missions in the correct tactical sequence. Read the associated brief and pass its quiz first to unlock each Battle of Order game.',
        replace: 'Live now! Arrange aircraft, ranks, and missions in the correct tactical sequence. Read the associated brief and pass its Intel Recall first to unlock each Battle of Order game.',
      },
      {
        match:   'Tap any of the game type cards to jump straight to that section below. Flashcard Recall is coming soon — the other three are live and ready to play!',
        replace: 'Tap any of the game type cards to jump straight to that section below. All four modes are live and ready to play.',
      },
    ],
  },
  {
    tutorialId: 'profile',
    steps: [
      {
        match:   'This is your personal stats dashboard. Track your level, Airstars, reading streak, and quiz performance all in one place.',
        replace: 'This is your personal stats dashboard. Track your level, Airstars, reading streak, and recall performance all in one place.',
      },
      {
        match:   'The Stats tab shows briefs read, games played, average quiz score, and total Airstars. Tap any stat to see its history.',
        replace: 'The Stats tab shows briefs read, games played, average recall score, and total Airstars. Tap any stat to see its history.',
      },
      {
        match:   'Tap the Settings tab to find quiz difficulty and other preferences.',
        replace: 'Tap the Settings tab to find Recall Difficulty and other preferences.',
      },
      {
        match:   'Tap Advanced under "Quiz Difficulty" for tougher, interview-level questions and bigger Airstars rewards. You can switch back to Standard at any time.',
        replace: 'Tap Advanced under "Recall Difficulty" for tougher, interview-level questions and bigger Airstars rewards. You can switch back to Standard at any time.',
      },
    ],
  },
  {
    tutorialId: 'rankings',
    steps: [
      {
        match:   'Earn Airstars by reading briefs and completing quizzes. Collect enough Airstars and your level increases automatically — the Airstars bar shows your progress to the next level.',
        replace: 'Earn Airstars by reading briefs and completing Intel Recalls. Collect enough Airstars and your level increases automatically — the Airstars bar shows your progress to the next level.',
      },
    ],
  },
];

// ── AirstarLog label prefix replacements ────────────────────────────────
// Persisted award labels were written by backend/routes/games.js with these
// shapes:
//   • `Quiz (standard|advanced): {brief title} — N/M correct`
//   • `Flashcard Recall — N/M[ (perfect)]`
// Only the leading game-name portion changes. We match by anchored regex and
// rewrite via $replaceOne (literal first-match swap) which is enough because
// the prefix only ever appears at the start of these labels.

const LABEL_REWRITES = [
  { regex: /^Quiz \(/,           findLiteral: 'Quiz (',           replaceLiteral: 'Intel Recall (' },
  { regex: /^Flashcard Recall —/, findLiteral: 'Flashcard Recall —', replaceLiteral: 'Flashcards —' },
];

// ───────────────────────────────────────────────────────────────────────
async function migrateTutorials(db, report) {
  const coll = db.collection('tutorials');
  for (const spec of TUTORIAL_REPLACEMENTS) {
    const doc = await coll.findOne({ tutorialId: spec.tutorialId });
    if (!doc) {
      report.push(`[skip] tutorial '${spec.tutorialId}': not found`);
      continue;
    }

    const update = {};
    let changes = 0;

    if (spec.name && doc.name === spec.name.match) {
      update.name = spec.name.replace;
      changes++;
    }

    if (Array.isArray(doc.steps) && spec.steps?.length) {
      const newSteps = doc.steps.map(step => {
        const next = { ...step };
        for (const { match, replace } of spec.steps) {
          if (next.title === match) { next.title = replace; changes++; }
          if (next.body  === match) { next.body  = replace; changes++; }
        }
        return next;
      });
      if (changes && JSON.stringify(newSteps) !== JSON.stringify(doc.steps)) {
        update.steps = newSteps;
      }
    }

    if (changes === 0) {
      report.push(`[noop] tutorial '${spec.tutorialId}': already migrated or admin-edited`);
      continue;
    }
    if (APPLY) {
      await coll.updateOne({ _id: doc._id }, { $set: update });
      report.push(`[apply] tutorial '${spec.tutorialId}': ${changes} field(s) rewritten`);
    } else {
      report.push(`[dry]   tutorial '${spec.tutorialId}': would rewrite ${changes} field(s)`);
    }
  }
}

async function migrateAirstarLogs(db, report) {
  const coll = db.collection('airstarlogs');
  for (const { regex, findLiteral, replaceLiteral } of LABEL_REWRITES) {
    const matched = await coll.countDocuments({ label: { $regex: regex } });
    if (matched === 0) {
      report.push(`[noop] airstarlogs: 0 docs with label starting "${findLiteral}"`);
      continue;
    }
    if (APPLY) {
      // Aggregation pipeline update — $replaceOne swaps the first occurrence of
      // the literal prefix. Requires Mongo 4.4+.
      const res = await coll.updateMany(
        { label: { $regex: regex } },
        [{ $set: { label: { $replaceOne: { input: '$label', find: findLiteral, replacement: replaceLiteral } } } }],
      );
      report.push(`[apply] airstarlogs: ${res.modifiedCount} labels rewritten ("${findLiteral}…" → "${replaceLiteral}…")`);
    } else {
      report.push(`[dry]   airstarlogs: would rewrite ${matched} labels ("${findLiteral}…" → "${replaceLiteral}…")`);
    }
  }
}

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set');
    process.exit(1);
  }

  console.log(APPLY ? '=== APPLY mode — writing changes ===' : '=== DRY-RUN — no writes ===');
  console.log(`Connecting to ${process.env.MONGODB_URI.replace(/\/\/([^:]+):[^@]+@/, '//$1:****@')}`);

  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const report = [];

  await migrateTutorials(db, report);
  await migrateAirstarLogs(db, report);

  console.log('\n' + report.join('\n'));
  await mongoose.disconnect();
  console.log(APPLY ? '\nDone.' : '\nDone (dry-run). Re-run with --apply to write changes.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
