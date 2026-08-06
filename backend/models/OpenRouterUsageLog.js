const mongoose = require('mongoose');
const { OPENROUTER_KEY_NAMES } = require('../constants/openRouterKeys');

// One entry per OpenRouter API call — powers the admin OpenRouter usage page
// and the "today's spend" tiles on the stats dashboard.
//
// The key enum is derived from constants/openRouterKeys rather than repeated
// here. A
// key missing from the enum fails validation on write, and logUsage() swallows
// that error by design — so the calls would still bill while their cost silently
// never appeared anywhere.
const openRouterUsageLogSchema = new mongoose.Schema({
  key:              { type: String, enum: OPENROUTER_KEY_NAMES, required: true },
  feature:          { type: String, required: true },
  briefId:          { type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief', default: null },
  model:            { type: String, default: '' },
  promptTokens:     { type: Number, default: 0 },
  completionTokens: { type: Number, default: 0 },
  totalTokens:      { type: Number, default: 0 },
  costUsd:          { type: Number, default: 0 },
}, { timestamps: true });

openRouterUsageLogSchema.index({ createdAt: -1 });
openRouterUsageLogSchema.index({ key: 1, createdAt: -1 });
openRouterUsageLogSchema.index({ feature: 1, createdAt: -1 });
openRouterUsageLogSchema.index({ briefId: 1, createdAt: -1 });

module.exports = mongoose.model('OpenRouterUsageLog', openRouterUsageLogSchema);
