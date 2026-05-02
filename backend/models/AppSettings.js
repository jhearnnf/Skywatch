const mongoose = require('mongoose');

const appSettingsSchema = new mongoose.Schema({
  _singleton: { type: String, default: 'settings', unique: true },

  // Trial
  appTrialDays:       { type: Number, default: 3 }, // immediate in-app trial (no card)
  appStripeTrialDays: { type: Number, default: 2 }, // Stripe trial for app users who used free trial
  webStripeTrialDays: { type: Number, default: 5 }, // Stripe trial for fresh web users

  // Ammunition per brief (free + silver configurable; gold is always unlimited = 9999)
  ammoFree:   { type: Number, default: 3 },
  ammoSilver: { type: Number, default: 10 },

  // Quiz display options
  easyAnswerCount:   { type: Number, default: 3 },
  mediumAnswerCount: { type: Number, default: 5 },

  // Quiz pass threshold (% correct needed to "pass", must be a multiple of 20)
  passThresholdEasy:   { type: Number, default: 60 },
  passThresholdMedium: { type: Number, default: 60 },

  // Airstars
  airstarsPerWin:        { type: Number, default: 10 }, // used by non-quiz games
  airstarsPerWinEasy:    { type: Number, default: 10 },
  airstarsPerWinMedium:  { type: Number, default: 20 },
  airstarsPerBriefRead:  { type: Number, default: 5 },
  airstarsFirstLogin:    { type: Number, default: 5 },
  airstarsStreakBonus:   { type: Number, default: 2 },
  airstars100Percent:    { type: Number, default: 15 },

  // Battle of Order airstars
  airstarsOrderOfBattleEasy:   { type: Number, default: 8,   min: 0 },
  airstarsOrderOfBattleMedium: { type: Number, default: 18,  min: 0 },

  // Flashcard Recall airstars
  airstarsFlashcardPerCard:     { type: Number, default: 2,  min: 0 },
  airstarsFlashcardPerfectBonus:{ type: Number, default: 5,  min: 0 },

  // Category access per tier (gold always gets all categories)
  silverCategories: {
    type: [String],
    default: ['News', 'Aircrafts', 'Bases', 'Ranks', 'Squadrons', 'Training', 'Threats', 'Allies'],
  },
  freeCategories: {
    type: [String],
    default: ['News'],
  },
  guestCategories: {
    type: [String],
    default: ['News'],
  },

  // Sound volumes (0–100)
  volumeIntelBriefOpened: { type: Number, default: 100, min: 0, max: 100 },
  volumeTargetLocked:     { type: Number, default: 100, min: 0, max: 100 },
  volumeFire:             { type: Number, default: 100, min: 0, max: 100 },
  volumeAirstar:          { type: Number, default: 100, min: 0, max: 100 },
  volumeOutOfAmmo:        { type: Number, default: 100, min: 0, max: 100 },
  volumeLevelUp:            { type: Number, default: 100, min: 0, max: 100 },
  volumeRankPromotion:      { type: Number, default: 100, min: 0, max: 100 },
  volumeQuizCompleteWin:    { type: Number, default: 100, min: 0, max: 100 },
  volumeQuizCompleteLose:   { type: Number, default: 100, min: 0, max: 100 },
  volumeQuizAnswerCorrect:  { type: Number, default: 100, min: 0, max: 100 },
  volumeQuizAnswerIncorrect:{ type: Number, default: 100, min: 0, max: 100 },
  volumeWhereAircraftWin:             { type: Number, default: 100, min: 0, max: 100 },
  volumeWhereAircraftLose:            { type: Number, default: 100, min: 0, max: 100 },
  volumeWhereAircraftMissionDetected: { type: Number, default: 100, min: 0, max: 100 },
  volumeStandDown:            { type: Number, default: 100, min: 0, max: 100 },
  volumeTargetLockedKeyword:  { type: Number, default: 100, min: 0, max: 100 },

  // Sound enabled flags (true = on, false = off)
  soundEnabledIntelBriefOpened:    { type: Boolean, default: true },
  soundEnabledTargetLocked:        { type: Boolean, default: true },
  soundEnabledStandDown:           { type: Boolean, default: true },
  soundEnabledTargetLockedKeyword: { type: Boolean, default: true },
  soundEnabledFire:                { type: Boolean, default: true },
  soundEnabledOutOfAmmo:           { type: Boolean, default: true },
  soundEnabledAirstar:             { type: Boolean, default: true },
  soundEnabledLevelUp:             { type: Boolean, default: true },
  soundEnabledRankPromotion:       { type: Boolean, default: true },
  soundEnabledQuizCompleteWin:     { type: Boolean, default: true },
  soundEnabledQuizCompleteLose:    { type: Boolean, default: true },
  soundEnabledQuizAnswerCorrect:   { type: Boolean, default: true },
  soundEnabledQuizAnswerIncorrect: { type: Boolean, default: true },
  soundEnabledWhereAircraftWin:             { type: Boolean, default: true },
  soundEnabledWhereAircraftLose:            { type: Boolean, default: true },
  soundEnabledWhereAircraftMissionDetected: { type: Boolean, default: true },

  // Where's That Aircraft — coin awards
  airstarsWhereAircraftRound1: { type: Number, default: 5,  min: 0 },
  airstarsWhereAircraftRound2: { type: Number, default: 10, min: 0 },
  airstarsWhereAircraftBonus:  { type: Number, default: 5,  min: 0 },
  soundEnabledBattleOfOrderWon:       { type: Boolean, default: true },
  soundEnabledBattleOfOrderLost:      { type: Boolean, default: true },
  soundEnabledBattleOfOrderSelection: { type: Boolean, default: true },
  volumeBattleOfOrderWon:             { type: Number, default: 100, min: 0, max: 100 },
  volumeBattleOfOrderLost:            { type: Number, default: 100, min: 0, max: 100 },
  volumeBattleOfOrderSelection:       { type: Number, default: 100, min: 0, max: 100 },

  // Flashcard Recall sounds
  volumeFlashcardStart:     { type: Number, default: 100, min: 0, max: 100 },
  volumeFlashcardCorrect:   { type: Number, default: 100, min: 0, max: 100 },
  volumeFlashcardIncorrect: { type: Number, default: 100, min: 0, max: 100 },
  volumeFlashcardCollect:   { type: Number, default: 100, min: 0, max: 100 },
  soundEnabledFlashcardStart:     { type: Boolean, default: true },
  soundEnabledFlashcardCorrect:   { type: Boolean, default: true },
  soundEnabledFlashcardIncorrect: { type: Boolean, default: true },
  soundEnabledFlashcardCollect:   { type: Boolean, default: true },

  // Typing / terminal sounds (Aptitude Sync card + terminal)
  volumeTypingSound:       { type: Number, default: 30, min: 0, max: 100 },
  soundEnabledTypingSound: { type: Boolean, default: true },

  // Blueprint grid-reveal tones (Intel Brief image cell dissolve)
  volumeGridReveal:       { type: Number, default: 30, min: 0, max: 100 },
  soundEnabledGridReveal: { type: Boolean, default: true },
  durationGridReveal:     { type: Number, default: 12, min: 1, max: 50 },   // milliseconds

  // Synthesised sound durations
  durationTypingSound:    { type: Number, default: 3,  min: 1, max: 40 },   // milliseconds

  // AI content generation
  aiKeywordsPerBrief:       { type: Number, default: 20, min: 1 },
  aiQuestionsPerDifficulty: { type: Number, default: 7,  min: 1 },

  // AI prompt overrides — keys match AI_PROMPT_DEFAULTS in backend/routes/admin.js
  // Absent or empty string falls back to the hardcoded default.
  aiPrompts: { type: Map, of: String, default: {} },

  // Site performance stats (accumulated by apiFetch on the frontend)
  totalLoadingMs: { type: Number, default: 0 },

  // Feature flags
  useLiveLeaderboard:    { type: Boolean, default: false },
  disableLoadingBar:     { type: Boolean, default: false },
  betaTesterAutoGold:    { type: Boolean, default: false },
  cbatEnabled:           { type: Boolean, default: false },
  mnemonicsClickEnabled: { type: Boolean, default: false },
  rsvpReaderEnabled:     { type: Boolean, default: false },

  // Flashcards feature — when false, News-category briefs skip the flashcard
  // layout on section 4, are excluded from the flashcard deck and overall count,
  // and the collect animation is suppressed. Reached-flashcard records still
  // persist so re-enabling restores them immediately.
  newsFlashcardsEnabled: { type: Boolean, default: false },

  // APTITUDE_SYNC feature
  aptitudeSyncEnabled:          { type: Boolean,  default: false },
  // Which subscription tiers can access APTITUDE_SYNC (admin always unlimited regardless)
  aptitudeSyncTiers:            { type: [String], default: ['admin'] },
  aptitudeSyncMaxRounds:        { type: Number,   default: 3,  min: 1, max: 5 },
  // Daily session limits per tier (admin = unlimited, enforced in route)
  aptitudeSyncDailyLimitFree:   { type: Number,   default: 1,  min: 0 },
  aptitudeSyncDailyLimitSilver: { type: Number,   default: 3,  min: 0 },
  aptitudeSyncDailyLimitGold:   { type: Number,   default: 10, min: 0 },

  // CBAT Target — strict allowlist of aircraft (briefIds) that appear in the scan panels.
  // Empty = no aircraft enabled. New 3D models added to /public/models/ start unticked
  // until an admin explicitly enables them via the Game Options → CBAT → Target section.
  cbatTargetAircraftBriefIds: { type: [String], default: [] },

  // CBAT FLAG — strict allowlist of aircraft (briefIds) usable by the FLAG game.
  // Same shape as cbatTargetAircraftBriefIds. When cbatEnabled is true, the admin
  // PATCH route enforces a minimum of one entry per game; when CBAT is disabled,
  // the admin UI omits these keys from PATCH so the previously-saved values persist.
  cbatFlagAircraftBriefIds: { type: [String], default: [] },

  // Case Files feature
  caseFilesEnabled:           { type: Boolean,  default: false },
  // Per-case tier gating lives on each GameCaseFile.tiers (admin always bypasses).
  // Daily session limits per tier (admin = unlimited, enforced in route).
  // One use = one POST /sessions call (a fresh playthrough). Limits AI-call cost
  // from the interrogation stage; replays count as separate uses.
  caseFilesDailyLimitFree:    { type: Number,   default: 0, min: 0 },
  caseFilesDailyLimitSilver:  { type: Number,   default: 1, min: 0 },
  caseFilesDailyLimitGold:    { type: Number,   default: 5, min: 0 },

  // Pathway unlock requirements — each entry gates a category behind level + rank.
  // levelRequired: Agent Level (1–10). rankRequired: RAF Rank number (1–19).
  // Subscription tier is derived from freeCategories/silverCategories — not stored here.
  pathwayUnlocks: {
    type: [{
      category:      { type: String },
      levelRequired: { type: Number, default: 1 },
      rankRequired:  { type: Number, default: 1 },
    }],
    default: [
      { category: 'News',        levelRequired: 1, rankRequired: 1 },
      { category: 'Bases',       levelRequired: 1, rankRequired: 1 },
      { category: 'Terminology', levelRequired: 1, rankRequired: 1 },
      { category: 'Aircrafts',   levelRequired: 2, rankRequired: 1 },
      { category: 'Heritage',    levelRequired: 2, rankRequired: 1 },
      { category: 'Ranks',       levelRequired: 2, rankRequired: 1 },
      { category: 'Squadrons',   levelRequired: 3, rankRequired: 2 },
      { category: 'Allies',      levelRequired: 3, rankRequired: 2 },
      { category: 'Training',    levelRequired: 4, rankRequired: 2 },
      { category: 'AOR',         levelRequired: 4, rankRequired: 2 },
      { category: 'Roles',       levelRequired: 5, rankRequired: 3 },
      { category: 'Tech',        levelRequired: 5, rankRequired: 3 },
      { category: 'Threats',     levelRequired: 6, rankRequired: 3 },
      { category: 'Missions',    levelRequired: 7, rankRequired: 4 },
      { category: 'Treaties',    levelRequired: 8, rankRequired: 4 },
    ],
  },

  // Tutorial text overrides — keys are '<tutorialId>_<stepIndex>' (e.g. 'welcome_0')
  // Absent or empty fields fall back to the hardcoded defaults in TutorialContext.
  tutorialContent: { type: Map, of: String, default: () => ({}) },

  // Email feature flags
  emailWelcomeEnabled:        { type: Boolean, default: true },
  emailConfirmationEnabled:   { type: Boolean, default: true },
  emailPasswordResetEnabled:  { type: Boolean, default: true },

  // Signup bot-prevention (Cloudflare Turnstile)
  signupCaptchaEnabled:       { type: Boolean, default: false },

  // Welcome email — all fields optional; absent or empty falls back to hardcoded defaults in email.js
  welcomeEmailSubject: { type: String, default: '' },
  welcomeEmailHeading: { type: String, default: '' },
  welcomeEmailBody:    { type: String, default: '' },
  welcomeEmailCta:     { type: String, default: '' },
  welcomeEmailFooter:  { type: String, default: '' },

  // Combat readiness (difficulty selection) screen — all optional; absent/empty falls back to hardcoded defaults
  combatReadinessTitle:    { type: String, default: '' },
  combatReadinessSubtitle: { type: String, default: '' },
  combatReadinessEasyLabel:  { type: String, default: '' },
  combatReadinessEasyTag:    { type: String, default: '' },
  combatReadinessEasyFlavor: { type: String, default: '' },
  combatReadinessEasyStars:  { type: String, default: '' },
  combatReadinessMediumLabel:  { type: String, default: '' },
  combatReadinessMediumTag:    { type: String, default: '' },
  combatReadinessMediumFlavor: { type: String, default: '' },
  combatReadinessMediumStars:  { type: String, default: '' },
});

// Static helper — always returns (or creates) the single settings document
appSettingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne();
  if (!settings) {
    try {
      settings = await this.create({});
    } catch (err) {
      if (err.code === 11000) {
        // Concurrent call already created it — just fetch
        settings = await this.findOne();
      } else {
        throw err;
      }
    }
  } else {
    const updates = {};
    if (!settings.freeCategories || settings.freeCategories.length === 0)
      updates.freeCategories = ['News'];
    if (!settings.silverCategories || settings.silverCategories.length === 0)
      updates.silverCategories = ['News', 'Aircrafts', 'Bases', 'Ranks', 'Squadrons', 'Training', 'Threats', 'Allies'];

    // Cascade heal — tier arrays are inclusive, but legacy data (and older
    // admin UI saves) could leave them exclusive. Anything in guestCategories
    // must also be in freeCategories + silverCategories; anything in
    // freeCategories must also be in silverCategories.
    {
      const guest  = updates.guestCategories  ?? settings.guestCategories  ?? [];
      const free   = updates.freeCategories   ?? settings.freeCategories   ?? [];
      const silver = updates.silverCategories ?? settings.silverCategories ?? [];
      const dedupe = arr => Array.from(new Set(arr));
      const healedFree   = dedupe([...free,   ...guest]);
      const healedSilver = dedupe([...silver, ...free, ...guest]);
      if (healedFree.length !== free.length)       updates.freeCategories   = healedFree;
      if (healedSilver.length !== silver.length)   updates.silverCategories = healedSilver;
    }
    // Migration: add any pathway categories that are missing from an older document
    const REQUIRED_PATHWAYS = [
      { category: 'News',        levelRequired: 1, rankRequired: 1 },
      { category: 'Bases',       levelRequired: 1, rankRequired: 1 },
      { category: 'Terminology', levelRequired: 1, rankRequired: 1 },
      { category: 'Aircrafts',   levelRequired: 2, rankRequired: 1 },
      { category: 'Heritage',    levelRequired: 2, rankRequired: 1 },
      { category: 'Ranks',       levelRequired: 2, rankRequired: 1 },
      { category: 'Squadrons',   levelRequired: 3, rankRequired: 2 },
      { category: 'Allies',      levelRequired: 3, rankRequired: 2 },
      { category: 'Training',    levelRequired: 4, rankRequired: 2 },
      { category: 'AOR',         levelRequired: 4, rankRequired: 2 },
      { category: 'Roles',       levelRequired: 5, rankRequired: 3 },
      { category: 'Tech',        levelRequired: 5, rankRequired: 3 },
      { category: 'Threats',     levelRequired: 6, rankRequired: 3 },
      { category: 'Missions',    levelRequired: 7, rankRequired: 4 },
      { category: 'Treaties',    levelRequired: 8, rankRequired: 4 },
    ];
    const existingCats = (settings.pathwayUnlocks || []).map(u => u.category);
    const missingPathways = REQUIRED_PATHWAYS.filter(p => !existingCats.includes(p.category));
    if (missingPathways.length) {
      // News must be prepended (appears first in the pathway UI); all others appended
      const [missingFront, missingRest] = missingPathways.reduce(
        ([front, rest], p) => p.category === 'News' ? [[p, ...front], rest] : [front, [...rest, p]],
        [[], []]
      );
      updates.pathwayUnlocks = [...missingFront, ...(settings.pathwayUnlocks || []), ...missingRest];
    }

    if (Object.keys(updates).length)
      settings = await this.findByIdAndUpdate(settings._id, updates, { returnDocument: 'after' });
  }
  return settings;
};

module.exports = mongoose.model('AppSettings', appSettingsSchema);
