const mongoose = require('mongoose');

// One row per MATF reference sheet a player sent to the printer. Only fresh
// prints land here: replaying a sheet printed earlier is not a new printout.
// Read by the "Game-specific Stats" card on the admin Reports page.
const schema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  // The board the sheet was built for; the seed alone cannot rebuild a run.
  gameKey:   { type: String, required: true, enum: ['matf', 'matf-easier'] },
  seed:      { type: Number, default: null },
  printedAt: { type: Date, default: Date.now },
});

schema.index({ printedAt: -1 });

module.exports = mongoose.model('CbatMatfPrint', schema);
