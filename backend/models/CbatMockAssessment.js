const mongoose = require('mongoose');

// One Mock Assessment sitting: the shuffled list of tests, where the player is in it, and the
// score each test came back with. The score sheet is worked out from `steps` on read (see
// utils/cbatMockSheet.js), never stored, so a correction to a battery's weights or minimums
// reprints every old sheet correctly.
//
// A mock's runs are ordinary Hard runs in their own game collections. They count on every board
// and on the Aptitude Report like any other run; `results[].resultId` is only the link back.

const resultSchema = new mongoose.Schema({
  gameKey:  { type: String, required: true },
  resultId: { type: mongoose.Schema.Types.ObjectId, required: true },
  // The game's primary score field, copied at claim time so the sheet never has to look the
  // run up in its own collection.
  score:    { type: Number, default: null },
  playedAt: { type: Date, default: Date.now },
}, { _id: false });

const stepSchema = new mongoose.Schema({
  // The test codes this step sits (VIG1 and VGIL_SPEED share one Vigilance run).
  codes:    { type: [String], default: [] },
  // The Hard boards played for it, in order. Two only for VISS (Visualisation 2D then 3D).
  gameKeys: { type: [String], required: true },
  minutes:  { type: Number, default: 0 },
  results:  { type: [resultSchema], default: [] },
  done:     { type: Boolean, default: false },
}, { _id: false });

const schema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  region:     { type: String, required: true },
  // 'role': one battery (batteryKey). 'all': every battery in the region.
  scope:      { type: String, enum: ['role', 'all'], required: true },
  batteryKey: { type: String, default: null },
  steps:      { type: [stepSchema], default: [] },
  // Indices of the steps a break follows, fixed when the mock is created.
  breakAfter: { type: [Number], default: [] },
  currentStep: { type: Number, default: 0 },
  // Set when a step before a break is finished; cleared when the next test is started.
  breakStartedAt: { type: Date, default: null },
  status:     { type: String, enum: ['active', 'completed', 'abandoned', 'expired'], default: 'active', index: true },
  startedAt:  { type: Date, default: Date.now },
  // Starting the mock, starting a test and finishing a test all move this. The idle limit is
  // measured from it.
  lastActivityAt: { type: Date, default: Date.now },
  endedAt:    { type: Date, default: null },
  // Set once the player has seen the "your assessment closed" notice for an expired mock, so it
  // is shown once and not on every visit.
  noticeSeenAt: { type: Date, default: null },
  // Where a leave came from ('link' = the leave dialog after clicking away, 'button' = Leave
  // assessment on the assessment screen), the page it was on, and the browser, so an unexpected
  // leave can be traced rather than guessed at.
  abandonInfo: {
    source:    { type: String, default: null },
    from:      { type: String, default: null },
    to:        { type: String, default: null },
    userAgent: { type: String, default: null },
  },
});

schema.index({ userId: 1, status: 1, startedAt: -1 });

module.exports = mongoose.model('CbatMockAssessment', schema);
