const mongoose = require('mongoose');

// CBAT Cognitive Updating Test (CUT) — a real-time multitasking sim. Score is an
// accumulating total (higher better), like Target/FLAG/DPT. The breakdown fields
// are optional and feed the results screen / admin drill-down only.
const schema = new mongoose.Schema({
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  totalScore:    { type: Number },
  totalTime:     { type: Number, required: true },
  // Per-system breakdown (optional)
  tasksCompleted:  { type: Number },
  tasksMissed:     { type: Number },
  warningSeconds:  { type: Number },
  createdAt:       { type: Date, default: Date.now },
});

schema.index({ userId: 1, createdAt: -1 });
schema.index({ totalScore: -1, totalTime: 1 });

module.exports = mongoose.model('GameSessionCbatCutResult', schema);
