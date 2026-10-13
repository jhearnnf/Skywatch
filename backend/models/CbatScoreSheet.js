const mongoose = require('mongoose');

// One photographed page of a real "Aptitude Scores" sheet, read into numbers.
//
// The source is one entry in User.cbatResultImages (a questionnaire upload or an admin one); this
// is that photo turned into data we can query: which roles the sheet printed, under what names,
// with what weights, cutoffs, stanines and verdicts. It is how a format change (a role dropping
// off, a rename, a reweighting) shows up as a query rather than as someone happening to notice,
// and how the Aptitude Report can be checked against real outcomes.
//
// ONLY THE NUMBERS ARE KEPT. The sheet also prints a name, date of birth and candidate numbers;
// none of that is ever extracted or stored. The test date is kept because it dates the format.
//
// A sheet is read by a model and then checked by an admin against the photo. Only `confirmed`
// sheets count as evidence; `extracted` is a draft and `rejected` is not a score sheet at all.

const testSchema = new mongoose.Schema({
  code: { type: String, required: true, trim: true },
  mult: { type: Number, default: 1 },
}, { _id: false });

const domainSchema = new mongoose.Schema({
  key:          { type: String, required: true, trim: true },   // as printed: StrgcTM, Prcpt-STM, ...
  weight:       { type: Number, default: null },
  tests:        { type: [testSchema], default: [] },
  stanine:      { type: Number, default: null },                // the green bar, 1-9
  minStanine:   { type: Number, default: null },                // the red mark's column
  belowMinimum: { type: Boolean, default: null },               // drawn as a solid red bar
}, { _id: false });

const batterySchema = new mongoose.Schema({
  label:      { type: String, required: true, trim: true },     // exactly as printed
  batteryKey: { type: String, default: null },                  // our battery, when the label maps to one
  // Which PASS/FAIL side bar the role sits under on this page, counted from the top. Roles sharing
  // a number share one verdict (a family, e.g. the two Control Officer roles).
  sideBar:    { type: Number, default: null },
  verdict:    { type: String, enum: ['pass', 'fail', null], default: null },
  cutoff:     { type: Number, default: null },
  score:      { type: Number, default: null },
  domains:    { type: [domainSchema], default: [] },
}, { _id: false });

const cbatScoreSheetSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  imageId:  { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  status:   { type: String, enum: ['extracted', 'confirmed', 'rejected'], default: 'extracted', index: true },

  testDate: { type: Date, default: null },
  // "Board: RAF" in the candidate box.
  board:    { type: String, default: null },
  batteries: { type: [batterySchema], default: [] },

  model:       { type: String, default: null },
  extractedAt: { type: Date, default: null },
  confirmedAt: { type: Date, default: null },
  confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  notes:       { type: String, trim: true, maxlength: 2000, default: null },
}, { timestamps: true });

module.exports = mongoose.model('CbatScoreSheet', cbatScoreSheetSchema);
