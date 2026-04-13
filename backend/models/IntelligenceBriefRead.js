const mongoose = require('mongoose');

const intelligenceBriefReadSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  intelBriefId: { type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief', required: true },

  timeSpentSeconds:    { type: Number, default: 0 },
  ammunitionRemaining: { type: Number, default: 0, min: 0 },
  ammoDepletedAt:      { type: Date,   default: null },

  coinsAwarded:     { type: Boolean, default: false }, // true once POST /complete has awarded coins
  completed:        { type: Boolean, default: false }, // true once user clicks "Complete Brief"
  reachedFlashcard: { type: Boolean, default: false }, // true once user reaches section 4 (flashcard)
  currentSection:   { type: Number,  default: 0 },    // last section the user was reading (for cross-device resume)

  briefDeletedNote: { type: String, default: null }, // set when the linked brief is deleted or re-created

  firstReadAt:  { type: Date, default: Date.now },
  lastReadAt:   { type: Date, default: Date.now },
  completedAt:  { type: Date, default: null },

  // Stat keys where this user has opened the mnemonic sheet for this brief
  mnemonicsViewed: { type: [String], default: [] },
});

// One record per user per brief
intelligenceBriefReadSchema.index({ userId: 1, intelBriefId: 1 }, { unique: true });

module.exports = mongoose.model('IntelligenceBriefRead', intelligenceBriefReadSchema);
