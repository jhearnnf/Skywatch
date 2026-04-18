const mongoose = require('mongoose');

// One entry per airstar award event — used to power the airstar history page.
const airstarLogSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount:   { type: Number, required: true },
  reason:   {
    type: String,
    enum: ['brief_read', 'daily_brief', 'quiz', 'battle_of_order', 'wheres_that_aircraft', 'wheres_aircraft', 'flashcard', 'admin', 'aptitude_sync', 'test'],
    required: true,
  },
  label:    { type: String, default: '' },    // human-readable description
  briefId:  { type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief', default: null },
}, { timestamps: true });

airstarLogSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('AirstarLog', airstarLogSchema);
