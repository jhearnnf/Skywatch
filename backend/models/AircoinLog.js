const mongoose = require('mongoose');

// One entry per aircoin award event — used to power the aircoin history page.
const aircoinLogSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount:   { type: Number, required: true },
  reason:   { type: String, required: true }, // 'brief_read' | 'quiz' | 'order_of_battle' | 'whos_at_aircraft' | 'flashcard' | 'admin' | 'login'
  label:    { type: String, default: '' },    // human-readable description
  briefId:  { type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief', default: null },
}, { timestamps: true });

aircoinLogSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('AircoinLog', aircoinLogSchema);
