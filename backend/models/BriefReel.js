const mongoose = require('mongoose');

// Brief Reel — short AI-generated stickman animation that visualises a single
// `descriptionSections[sectionIndex]` of an IntelligenceBrief.
//
// One reel is cached per (briefId, sectionIndex, bodyHash) — when the section's
// body text is edited, its hash changes and the next play triggers a fresh
// generation. The old reel becomes orphaned and is reclaimable by GC if needed
// (we keep it for audit until then).
//
// `timeline` is the structured script returned by briefReelAi — the renderer
// (frontend) consumes it to draw stickmen/props/speech bubbles on a fixed
// 16:9 SVG viewBox. Schema is intentionally loose (Mixed) — validation lives
// in the service so the model never blocks experimentation with new beat
// shapes during early iteration.

const briefReelSchema = new mongoose.Schema({
  briefId:      { type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief', required: true, index: true },
  sectionIndex: { type: Number, required: true, min: 0 },
  bodyHash:     { type: String, required: true },

  status:       { type: String, enum: ['pending', 'published'], default: 'pending', index: true },

  timeline:     { type: mongoose.Schema.Types.Mixed, required: true },

  generatedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  generatedAt:  { type: Date, default: Date.now },
  publishedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  publishedAt:  { type: Date, default: null },

  // Captured at generation time so the admin review UI can diff the cached
  // body against the current brief without rehydrating the brief doc.
  bodySnapshot: { type: String, default: '' },
}, { timestamps: true });

// One reel per (brief, section, body content). Editing the section body
// changes bodyHash and a new doc is created on next generate.
briefReelSchema.index({ briefId: 1, sectionIndex: 1, bodyHash: 1 }, { unique: true });

module.exports = mongoose.model('BriefReel', briefReelSchema);
