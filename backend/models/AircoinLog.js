const mongoose = require('mongoose');

// One entry per aircoin award event — used to power the aircoin history page.
const aircoinLogSchema = new mongoose.Schema({
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

aircoinLogSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('AircoinLog', aircoinLogSchema);
