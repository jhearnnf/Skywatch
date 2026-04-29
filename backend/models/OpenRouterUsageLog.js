const mongoose = require('mongoose');

// One entry per OpenRouter API call — powers the admin OpenRouter usage page
// and the "today's spend" tiles on the stats dashboard.
const openRouterUsageLogSchema = new mongoose.Schema({
  key:              { type: String, enum: ['main', 'aptitude', 'socials'], required: true },
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
