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

  // Aircoins
  aircoinsPerWin:        { type: Number, default: 10 },
  aircoinsFirstLogin:    { type: Number, default: 5 },
  aircoinsStreakBonus:   { type: Number, default: 2 },
  aircoins100Percent:    { type: Number, default: 15 },

  // Category access per tier (gold always gets all categories)
  silverCategories: {
    type: [String],
    default: ['News', 'Aircrafts', 'Bases', 'Ranks', 'Squadrons', 'Training', 'Threats', 'Allies'],
  },
  freeCategories: {
    type: [String],
    default: ['News'],
  },

  // Sound volumes (0–100)
  volumeIntelBriefOpened: { type: Number, default: 100, min: 0, max: 100 },
  volumeTargetLocked:     { type: Number, default: 100, min: 0, max: 100 },
  volumeOutOfAmmo:        { type: Number, default: 100, min: 0, max: 100 },

  // Feature flags
  useLiveLeaderboard: { type: Boolean, default: false },
});

// Static helper — always returns (or creates) the single settings document
appSettingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  } else {
    const updates = {};
    if (settings.ammoFree === 0)   updates.ammoFree   = 3;   // old default was 0
    if (settings.ammoSilver <= 3)  updates.ammoSilver = 10;  // old default was 3
    if (!settings.freeCategories || settings.freeCategories.length === 0)
      updates.freeCategories = ['News'];
    if (Object.keys(updates).length)
      settings = await this.findByIdAndUpdate(settings._id, updates, { new: true });
  }
  return settings;
};

module.exports = mongoose.model('AppSettings', appSettingsSchema);
