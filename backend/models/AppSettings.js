const mongoose = require('mongoose');

const appSettingsSchema = new mongoose.Schema({
  _singleton: { type: String, default: 'settings', unique: true },

  // Trial
  trialDurationDays: { type: Number, default: 5 },

  // Ammunition per brief (free + silver configurable; gold is always unlimited = 9999)
  ammoFree:   { type: Number, default: 3 },
  ammoSilver: { type: Number, default: 10 },

  // Quiz display options
  easyAnswerCount:   { type: Number, default: 3 },
  mediumAnswerCount: { type: Number, default: 5 },

  // Quiz pass threshold (% correct needed to "pass", must be a multiple of 20)
  passThresholdEasy:   { type: Number, default: 60 },
  passThresholdMedium: { type: Number, default: 60 },

  // Aircoins
  aircoinsPerWin:        { type: Number, default: 10 }, // used by non-quiz games
  aircoinsPerWinEasy:    { type: Number, default: 10 },
  aircoinsPerWinMedium:  { type: Number, default: 20 },
  aircoinsPerBriefRead:  { type: Number, default: 5 },
  aircoinsFirstLogin:    { type: Number, default: 5 },
  aircoinsStreakBonus:   { type: Number, default: 2 },
  aircoins100Percent:    { type: Number, default: 15 },

  // Battle of Order aircoins
  aircoinsOrderOfBattleEasy:   { type: Number, default: 8,   min: 0 },
  aircoinsOrderOfBattleMedium: { type: Number, default: 18,  min: 0 },

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
  volumeAircoin:          { type: Number, default: 100, min: 0, max: 100 },
  volumeOutOfAmmo:        { type: Number, default: 100, min: 0, max: 100 },
  volumeLevelUp:            { type: Number, default: 100, min: 0, max: 100 },
  volumeRankPromotion:      { type: Number, default: 100, min: 0, max: 100 },
  volumeQuizCompleteWin:    { type: Number, default: 100, min: 0, max: 100 },
  volumeQuizCompleteLose:   { type: Number, default: 100, min: 0, max: 100 },
  volumeQuizAnswerCorrect:  { type: Number, default: 100, min: 0, max: 100 },
  volumeQuizAnswerIncorrect:{ type: Number, default: 100, min: 0, max: 100 },
  volumeStandDown:            { type: Number, default: 100, min: 0, max: 100 },
  volumeTargetLockedKeyword:  { type: Number, default: 100, min: 0, max: 100 },

  // Sound enabled flags (true = on, false = off)
  soundEnabledIntelBriefOpened:    { type: Boolean, default: true },
  soundEnabledTargetLocked:        { type: Boolean, default: true },
  soundEnabledStandDown:           { type: Boolean, default: true },
  soundEnabledTargetLockedKeyword: { type: Boolean, default: true },
  soundEnabledFire:                { type: Boolean, default: true },
  soundEnabledOutOfAmmo:           { type: Boolean, default: true },
  soundEnabledAircoin:             { type: Boolean, default: true },
  soundEnabledLevelUp:             { type: Boolean, default: true },
  soundEnabledRankPromotion:       { type: Boolean, default: true },
  soundEnabledQuizCompleteWin:     { type: Boolean, default: true },
  soundEnabledQuizCompleteLose:    { type: Boolean, default: true },
  soundEnabledQuizAnswerCorrect:   { type: Boolean, default: true },
  soundEnabledQuizAnswerIncorrect: { type: Boolean, default: true },
  soundEnabledBattleOfOrderWon:       { type: Boolean, default: true },
  soundEnabledBattleOfOrderLost:      { type: Boolean, default: true },
  soundEnabledBattleOfOrderSelection: { type: Boolean, default: true },
  volumeBattleOfOrderWon:             { type: Number, default: 100, min: 0, max: 100 },
  volumeBattleOfOrderLost:            { type: Number, default: 100, min: 0, max: 100 },
  volumeBattleOfOrderSelection:       { type: Number, default: 100, min: 0, max: 100 },

  // Feature flags
  useLiveLeaderboard:   { type: Boolean, default: false },
  disableLoadingBar:    { type: Boolean, default: false },

  // Tutorial text overrides — keys are '<tutorialId>_<stepIndex>' (e.g. 'welcome_0')
  // Absent or empty fields fall back to the hardcoded defaults in TutorialContext.
  tutorialContent: { type: mongoose.Schema.Types.Mixed, default: {} },

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
    if (settings.ammoFree === 0)   updates.ammoFree   = 3;   // old default was 0
    if (settings.ammoSilver <= 3)  updates.ammoSilver = 10;  // old default was 3
    if (!settings.freeCategories || settings.freeCategories.length === 0)
      updates.freeCategories = ['News'];
    if (!settings.silverCategories || settings.silverCategories.length === 0)
      updates.silverCategories = ['News', 'Aircrafts', 'Bases', 'Ranks', 'Squadrons', 'Training', 'Threats', 'Allies'];
    if (Object.keys(updates).length)
      settings = await this.findByIdAndUpdate(settings._id, updates, { new: true });
  }
  return settings;
};

module.exports = mongoose.model('AppSettings', appSettingsSchema);
