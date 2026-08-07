const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { DIFFICULTY_LEVELS } = require('../constants/difficulty');
const { SUBSCRIPTION_TIERS } = require('../constants/subscriptionTiers');
const { TUTORIAL_STATUS } = require('../constants/tutorialStatus');

const loginSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
}, { _id: false });

const clientBuildSchema = new mongoose.Schema({
  version:     { type: String, default: null },
  build:       { type: String, default: null },
  buildNumber: { type: Number, default: null },
  lastSeenAt:  { type: Date,   default: null },
}, { _id: false });

// One CBAT progress-award milestone this user has already been shown.
// `tier` is the improvement threshold crossed (see backend/utils/cbatProgressAward.js).
// The row existing is what stops that tier re-firing on every later run once the
// player is sitting above its threshold — the award marks *crossing* the line,
// not being over it.
const cbatProgressAwardSchema = new mongoose.Schema({
  gameKey: { type: String, required: true },
  tier:    { type: Number, required: true },
  shownAt: { type: Date,   default: Date.now },
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

    // User-chosen display name shown on profile + every public leaderboard.
    // displayNameLower mirrors displayName in lowercase to enforce
    // case-insensitive uniqueness via a partial unique index.
    // displayNameChangedAt drives the 30-day cooldown between changes.
    //
    // displayNameLower has NO default — the field is absent on docs without
    // a name. Writing `null` here collides on any legacy non-partial unique
    // index that may still exist in the database, and the partial filter
    // (`$type: 'string'`) on the current index excludes only strings, so a
    // missing field is the safest representation either way.
    displayName:          { type: String, trim: true, minlength: 3, maxlength: 20, default: null },
    displayNameLower:     { type: String },
    displayNameChangedAt: { type: Date,   default: null },

    difficultySetting: { type: String, enum: DIFFICULTY_LEVELS, default: 'easy' },

    isAdmin:  { type: Boolean, default: false },
    isBanned: { type: Boolean, default: false },

    // Chat-specific ban, separate from isBanned (which locks the whole account).
    // A chat-banned user can still read channels and DMs but cannot post in
    // them. They CAN still use the support chat — a ban that also cuts off the
    // only route to appeal it would be a trap.
    chatBannedAt:       { type: Date, default: null },
    chatBannedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    chatBanReason:      { type: String, trim: true, maxlength: 300, default: null },

    // Automated chat account. A real User row so DMs, avatars, the sender map,
    // name colours and the admin transcript all work with no special-casing —
    // but it never plays anything, so it is excluded from the leaderboard and
    // the homepage showcase, and only admins may message it.
    isBot: { type: Boolean, default: false },

    // What this bot is for, in its own words. Stored per-bot rather than
    // hardcoded in the UI: the sidebar used to label every bot "Answers from
    // the CBAT community guide", which is true of the guide bot and nonsense
    // for one that only posts medals.
    botDescription: { type: String, trim: true, maxlength: 120, default: null },

    // Whether this bot answers direct messages. A poster (the medal bot) has no
    // conversational role at all — without this it would be DM-able and would
    // reply with CBAT guide answers under a name that promises medals.
    botAnswersDms: { type: Boolean, default: false },

    // Opt-OUT of the Community unread dot. Stored as "enabled" with a default
    // of true because the dot is on for everyone unless they say otherwise, and
    // an absent field must read as on — no backfill needed. Turning it off
    // silences the badge only; the user keeps full access to Community.
    communityNotificationsEnabled: { type: Boolean, default: true },

    // Admin-set flag marking an account as a tester. Purely admin-facing (never
    // exposed on public profile/leaderboard): in the Admin › Users panel it
    // floats an offline tester to the top of the offline group and gives the row
    // a red/amber "TESTER" watermark.
    isTester: { type: Boolean, default: false },

    // Opt-OUT of the public progress wall on the landing page (see
    // utils/cbatShowcase.js). Stored as the objection rather than as consent so
    // the default — included, anonymised behind an agent number — needs no
    // backfill, and so a `false` here can never be mistaken for a recorded
    // "yes". Set from Profile › Settings; honoured immediately (the route
    // clears the showcase cache).
    hideFromShowcase: { type: Boolean, default: false },

    // Subscription
    subscriptionTier: {
      type: String,
      enum: SUBSCRIPTION_TIERS,
      default: 'free',
    },
    trialStartDate:     Date,
    trialDurationDays:  { type: Number, default: 5 }, // snapshot from settings at trial start
    trialSource:        { type: String, enum: ['app', 'web'], default: null },
    subscriptionStartDate: Date,
    stripeCustomerId:      String,
    stripeSubscriptionId:  String,

    // Progress
    rank:          { type: mongoose.Schema.Types.ObjectId, ref: 'Rank' },
    totalAirstars: { type: Number, default: 0 },
    cycleAirstars: { type: Number, default: 0 }, // airstars in current rank cycle — resets to 0 on rank promotion

    // Profile badge — optional override that replaces the rank badge on the
    // avatar. Points at an Aircrafts-category brief whose Media has a cutout.
    // Validated at PATCH time; set to null to fall back to the rank badge.
    selectedBadgeBriefId: { type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief', default: null },

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
      wheres_aircraft:              { type: String, enum: TUTORIAL_STATUS, default: 'unseen' },
      learn_priority:               { type: String, enum: TUTORIAL_STATUS, default: 'unseen' },
      pathway_swipe:                { type: String, enum: TUTORIAL_STATUS, default: 'unseen' },
      stat_mnemonic:                { type: String, enum: TUTORIAL_STATUS, default: 'unseen' },
      caseFile_coldOpen:            { type: String, enum: TUTORIAL_STATUS, default: 'unseen' },
      caseFile_evidenceWall:        { type: String, enum: TUTORIAL_STATUS, default: 'unseen' },
      caseFile_actorInterrogations: { type: String, enum: TUTORIAL_STATUS, default: 'unseen' },
      caseFile_decisionPoint:       { type: String, enum: TUTORIAL_STATUS, default: 'unseen' },
      caseFile_mapPredictive:       { type: String, enum: TUTORIAL_STATUS, default: 'unseen' },
      caseFile_phaseReveal:         { type: String, enum: TUTORIAL_STATUS, default: 'unseen' },
      caseFile_mapLive:             { type: String, enum: TUTORIAL_STATUS, default: 'unseen' },
      caseFile_debrief:             { type: String, enum: TUTORIAL_STATUS, default: 'unseen' },
    },
    tutorialsResetAt: { type: Date, default: null }, // admin-triggered; frontend clears localStorage tutorial keys when newer than last clear

    // Reading streak (incremented on first brief read each calendar day)
    loginStreak:    { type: Number, default: 0 },
    lastStreakDate: { type: Date,   default: null },

    // Login history (kept for session tracking)
    logins: [loginSchema],

    lastSeen: { type: Date, default: null },

    // Which build of the app this account was last running, kept per platform
    // so a user who plays on both keeps an answer for each — switching to the
    // phone must not erase what they were last on in the browser, and vice
    // versa. Each entry carries its own lastSeenAt because the two platforms go
    // stale independently; `lastSeen` above only records the most recent of the
    // two. Written from POST /api/users/heartbeat, surfaced in Admin › Users.
    //
    // buildNumber mirrors `build` as a number when it parses (Android's
    // versionCode always does, a web commit sha never will). Play Store rules
    // guarantee versionCode only ever increases, so the highest one any user
    // reports is by definition the newest release in the wild — which is how
    // "is this account on the latest version?" gets answered without anyone
    // having to configure what the current version is.
    lastClients: {
      web:     { type: clientBuildSchema, default: null },
      android: { type: clientBuildSchema, default: null },
      ios:     { type: clientBuildSchema, default: null },
    },

    // Every operating system this account has ever been seen on, for Admin ›
    // Users. Unlike lastClients (the last *build* per app platform), this
    // accumulates: each value is the last time that OS was seen, and an OS is
    // never cleared once lit. Web is inferred from the heartbeat's User-Agent;
    // native reports its platform (ios/android) directly. See POST
    // /api/users/heartbeat.
    osSeen: {
      windows: { type: Date, default: null },
      mac:     { type: Date, default: null },
      linux:   { type: Date, default: null },
      ios:     { type: Date, default: null },
      android: { type: Date, default: null },
    },

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

    // CBAT progress awards already shown to this user, one row per (gameKey, tier).
    // Persisted rather than kept in localStorage so a player who trains on their
    // phone and their laptop isn't congratulated twice for the same milestone.
    cbatProgressAwards: { type: [cbatProgressAwardSchema], default: [] },

    // Frequency state for the donation footnote attached to those awards.
    //
    // GLOBAL, not per game — that's the whole point of it being separate state.
    // Milestones are per-game and can legitimately fire many times across the
    // ~18 games; the ask riding on them must not. A cap that reset per device
    // (or per game) would not be a cap.
    //
    // `lastShownAt` and `dismissCount` drive the caps: when we last offered the
    // note, and how many times it has been waved away. There is no "already
    // donated" flag — we cannot observe an external payment, and the dismissal
    // cap already stops asking someone who has answered twice.
    //
    // `impressionCount` and `clickCount` are the funnel behind the admin stat,
    // and are deliberately NOT derived from the two above. `lastShownAt` is set
    // when the SERVER decides the note is due, which happens while the award
    // overlay is still up — a player who closes the tab there was offered it but
    // never saw it. The impression is reported by the note itself on render, so
    // the denominator counts people who actually laid eyes on the card.
    donationPrompt: {
      lastShownAt:     { type: Date,   default: null },
      dismissCount:    { type: Number, default: 0 },
      impressionCount: { type: Number, default: 0 },
      clickCount:      { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

// Unique index on displayNameLower that only applies when the field is a
// string — null/missing values are ignored, so unset users don't collide.
userSchema.index(
  { displayNameLower: 1 },
  { unique: true, partialFilterExpression: { displayNameLower: { $type: 'string' } } }
);

// ── Hooks ────────────────────────────────────────────────────────────────────

userSchema.pre('save', async function () {
  // Hash password only when modified
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 12);
  }

  // Keep displayNameLower in step with displayName.
  //
  // It used to be written only by the display-name endpoint, which was fine
  // while its only job was backing the uniqueness index — every route that set
  // a name set both. @mentions changed that: resolving "@Falcon" is a lookup on
  // displayNameLower, so a row that has a name but no lowercase mirror is a
  // person who can never be mentioned. Silently. The invariant belongs here
  // rather than in each caller.
  //
  // Clearing a name goes through $unset in routes/users.js rather than save(),
  // so this deliberately does not handle the null case — writing null here
  // would collide on the partial unique index.
  if (this.isModified('displayName') && typeof this.displayName === 'string' && this.displayName) {
    this.displayNameLower = this.displayName.toLowerCase();
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
