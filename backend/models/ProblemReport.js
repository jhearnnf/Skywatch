const mongoose = require('mongoose');

const problemReportUpdateSchema = new mongoose.Schema({
  adminUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  time:        { type: Date, default: Date.now },
  description: { type: String, required: true, trim: true },
});

const problemReportSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  time:         { type: Date, default: Date.now },
  pageReported: { type: String, required: true, trim: true },
  description:  { type: String, required: true, trim: true },
  solved:       { type: Boolean, default: false },
  updates:      [problemReportUpdateSchema],
});

problemReportSchema.index({ solved: 1, time: -1 });

module.exports = mongoose.model('ProblemReport', problemReportSchema);
