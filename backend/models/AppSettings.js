const mongoose = require('mongoose');

const appSettingsSchema = new mongoose.Schema({
  _singleton: { type: String, default: 'settings', unique: true },

  // Trial
  trialDurationDays: { type: Number, default: 5 },

  // Ammunition per subscription tier (admin-configurable)
  ammoFree:   { type: Number, default: 0 },
  ammoSilver: { type: Number, default: 3 },
  ammoGold:   { type: Number, default: 10 },

  // Quiz display options
  easyAnswerCount:   { type: Number, default: 3 },
  mediumAnswerCount: { type: Number, default: 5 },

  // Aircoins
  aircoinsPerWin:        { type: Number, default: 10 },
  aircoinsFirstLogin:    { type: Number, default: 5 },
  aircoinsStreakBonus:   { type: Number, default: 2 },
  aircoins100Percent:    { type: Number, default: 15 },

  // Silver tier accessible categories
  silverCategories: {
    type: [String],
    default: ['News', 'Aircrafts', 'Bases', 'Ranks', 'Squadrons', 'Training', 'Threats', 'Allies'],
  },
});

// Static helper — always returns (or creates) the single settings document
appSettingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne();
  if (!settings) settings = await this.create({});
  return settings;
};

module.exports = mongoose.model('AppSettings', appSettingsSchema);
