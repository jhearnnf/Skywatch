const mongoose = require('mongoose');

// One step in a tutorial. Optional highlight fields tie the step to a specific
// element on a page — when set, the runtime spotlights that element while the
// step is active and (if advanceOnTargetClick) advances to the next step on click.
// showToGuests: when false, the runtime hides this step from logged-out users
// (useful for steps that target settings/account UI guests can't reach).
const tutorialStepSchema = new mongoose.Schema({
  emoji:                String,
  title:                String,
  body:                 String,
  guestBody:            String,
  highlightSelector:    String,           // CSS selector, e.g. '[data-tutorial-target="play-grid"]'
  highlightPage:        String,           // route the selector targets, e.g. '/play'
  advanceOnTargetClick: { type: Boolean, default: true },
  showToGuests:         { type: Boolean, default: true },
}, { _id: true });

const tutorialSchema = new mongoose.Schema({
  tutorialId:   { type: String, required: true, unique: true, index: true },
  name:         { type: String, required: true }, // display name in admin editor
  inline:       { type: Boolean, default: false }, // hidden from main editor (mini-hints, post-quiz nudge, etc.)
  // showToGuests: when false, the tutorial never starts for logged-out users.
  // Defaults to true so guests keep seeing every tutorial unless an admin opts out.
  showToGuests: { type: Boolean, default: true },
  steps:        { type: [tutorialStepSchema], default: [] },
}, { timestamps: true });

// Idempotent seed — inserts any tutorial from the defaults list that doesn't
// already exist. Existing tutorials are left untouched, so admin edits survive
// every deploy. Adding a new tutorial in code seeds it on the next boot.
tutorialSchema.statics.seedDefaults = async function () {
  const defaults = require('../seeds/tutorialDefaults');
  const existingIds = new Set(
    (await this.find({}, { tutorialId: 1 }).lean()).map(t => t.tutorialId)
  );
  const toInsert = defaults.filter(d => !existingIds.has(d.tutorialId));
  if (toInsert.length) {
    await this.insertMany(toInsert);
    console.log(`Tutorials seeded: ${toInsert.map(t => t.tutorialId).join(', ')}`);
  }
};

module.exports = mongoose.model('Tutorial', tutorialSchema);
