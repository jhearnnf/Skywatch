const mongoose = require('mongoose');

// One document = one daily session slot consumed by a user for a specific brief.
// Trying to play the same brief again today re-uses the existing record (upsert),
// so it doesn't cost an extra slot. A different brief counts as a new slot.
const aptitudeSyncUsageSchema = new mongoose.Schema({
  userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User',              required: true },
  briefId: { type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief', required: true },
  date:    { type: String, required: true }, // 'YYYY-MM-DD' UTC
  // Populated on session completion (final round response)
  finalSummary:  { type: String, default: null }, // 2–3 sentence closing debrief
  knowledgeGaps: { type: String, default: null }, // missed/incorrect facts with correct answers
  aircoinsEarned: { type: Number, default: null }, // total awarded at end of session
  completedAt:   { type: Date,   default: null },
  abandoned:     { type: Boolean, default: false },
}, { timestamps: false });

// Enforce uniqueness: one slot per user per brief per day
aptitudeSyncUsageSchema.index({ userId: 1, briefId: 1, date: 1 }, { unique: true });
// Fast daily count lookup
aptitudeSyncUsageSchema.index({ userId: 1, date: 1 });

module.exports = mongoose.model('AptitudeSyncUsage', aptitudeSyncUsageSchema);
