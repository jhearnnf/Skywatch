const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { DIFFICULTY_LEVELS } = require('../constants/difficulty');
const { SUBSCRIPTION_TIERS } = require('../constants/subscriptionTiers');
const { TUTORIAL_STATUS } = require('../constants/tutorialStatus');

const loginSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
}, { _id: false });

const gameTutorialSchema = new mongoose.Schema({
  gameTypeId:        { type: mongoose.Schema.Types.ObjectId, ref: 'GameType', required: true },
  completed:         { type: Boolean, default: false },
  skipped:           { type: Boolean, default: false },
  timeSpentSeconds:  { type: Number, default: 0 },
}, { _id: false });

const userSchema = new mongoose.Schema(
  {
    email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, select: false }, // optional — not set for Google OAuth users
    googleId: { type: String, unique: true, sparse: true },

    agentNumber: { type: String, unique: true, sparse: true }, // 7-digit, auto-generated

    difficultySetting: { type: String, enum: DIFFICULTY_LEVELS, default: 'easy' },

    isAdmin:  { type: Boolean, default: false },
    isBanned: { type: Boolean, default: false },

    // Subscription
    subscriptionTier: {
      type: String,
      enum: SUBSCRIPTION_TIERS,
      default: 'free',
    },
    trialStartDate:     Date,
    trialDurationDays:  { type: Number, default: 5 }, // snapshot from settings at trial start
    subscriptionStartDate: Date,
    stripeCustomerId:      String,
    stripeSubscriptionId:  String,

    // Progress
    rank:          { type: mongoose.Schema.Types.ObjectId, ref: 'Rank' },
    totalAirstars: { type: Number, default: 0 },
    cycleAirstars: { type: Number, default: 0 }, // airstars in current rank cycle — resets to 0 on rank promotion

    // Tutorial progress
    // ⚠ When adding a new tutorial, add it here AND in TUTORIAL_STEPS in src/context/AppTutorialContext.jsx
    tutorials: {
      welcome:         { type: String, enum: TUTORIAL_STATUS, default: 'unseen' },
      intel_brief:     { type: String, enum: TUTORIAL_STATUS, default: 'unseen' },
      user:            { type: String, enum: TUTORIAL_STATUS, default: 'unseen' },
      load_up:         { type: String, enum: TUTORIAL_STATUS, default: 'unseen' },
      home:            { type: String, enum: TUTORIAL_STATUS, default: 'unseen' },
      briefReader:     { type: String, enum: TUTORIAL_STATUS, default: 'unseen' },
      quiz:            { type: String, enum: TUTORIAL_STATUS, default: 'unseen' },
      play:            { type: String, enum: TUTORIAL_STATUS, default: 'unseen' },
      profile:         { type: String, enum: TUTORIAL_STATUS, default: 'unseen' },
      rankings:        { type: String, enum: TUTORIAL_STATUS, default: 'unseen' },
      wheres_aircraft: { type: String, enum: TUTORIAL_STATUS, default: 'unseen' },
      learn_priority:  { type: String, enum: TUTORIAL_STATUS, default: 'unseen' },
      pathway_swipe:   { type: String, enum: TUTORIAL_STATUS, default: 'unseen' },
      stat_mnemonic:   { type: String, enum: TUTORIAL_STATUS, default: 'unseen' },
    },
    tutorialsResetAt: { type: Date, default: null }, // admin-triggered; frontend clears localStorage tutorial keys when newer than last clear

    // Reading streak (incremented on first brief read each calendar day)
    loginStreak:    { type: Number, default: 0 },
    lastStreakDate: { type: Date,   default: null },

    // Login history (kept for session tracking)
    logins: [loginSchema],

    // Game tutorial tracking
    gameTypesSeen: [gameTutorialSchema],

    // Where's That Aircraft — spawn tracking
    whereAircraftReadsSinceLastGame: { type: Number, default: 0 },
    whereAircraftSpawnThreshold:     { type: Number, default: 3 }, // randomly set 2–5 on each spawn

    // Game unlock tracking — cross-device "NEW" badge state
    gameUnlocks: {
      quiz:      { unlockedAt: { type: Date, default: null }, badgeSeen: { type: Boolean, default: false } },
      flashcard: { unlockedAt: { type: Date, default: null }, badgeSeen: { type: Boolean, default: false } },
      boo:       { unlockedAt: { type: Date, default: null }, badgeSeen: { type: Boolean, default: false } },
      wta:       { unlockedAt: { type: Date, default: null }, badgeSeen: { type: Boolean, default: false } },
    },

    // Pathway category unlock tracking — cross-device "NEW" badge state on Learn nav.
    // Map keyed by category name (admin-configurable, so not a fixed object). Entry is
    // written/refreshed each time a user crosses the pathway threshold for that category.
    categoryUnlocks: {
      type: Map,
      of: new mongoose.Schema({
        unlockedAt: { type: Date,    default: null },
        badgeSeen:  { type: Boolean, default: false },
      }, { _id: false }),
      default: () => new Map(),
    },
  },
  { timestamps: true }
);

// ── Hooks ────────────────────────────────────────────────────────────────────

userSchema.pre('save', async function () {
  // Hash password only when modified
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 12);
  }

  // Generate unique 7-digit agent number on first save
  if (!this.agentNumber) {
    let agentNumber;
    let exists = true;
    while (exists) {
      agentNumber = String(Math.floor(1_000_000 + Math.random() * 9_000_000));
      exists = await mongoose.model('User').exists({ agentNumber }); // eslint-disable-line no-await-in-loop
    }
    this.agentNumber = agentNumber;
  }
});

// ── Methods ──────────────────────────────────────────────────────────────────

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

// ── Virtuals ─────────────────────────────────────────────────────────────────

userSchema.virtual('isTrialActive').get(function () {
  if (this.subscriptionTier !== 'trial' || !this.trialStartDate) return false;
  const trialEnd = new Date(this.trialStartDate);
  trialEnd.setDate(trialEnd.getDate() + (this.trialDurationDays || 5));
  return new Date() < trialEnd;
});


userSchema.set('toJSON', { virtuals: true });
userSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('User', userSchema);
