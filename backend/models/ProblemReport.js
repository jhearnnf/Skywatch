const mongoose = require('mongoose');

const problemReportUpdateSchema = new mongoose.Schema({
  adminUserId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  time:          { type: Date, default: Date.now },
  description:   { type: String, required: true, trim: true },
  isUserVisible: { type: Boolean, default: false },
  emailSent:     { type: Boolean, default: false },
});

const problemReportSchema = new mongoose.Schema({
  userId:            { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  time:              { type: Date, default: Date.now },
  pageReported:      { type: String, required: true, trim: true },
  description:       { type: String, required: true, trim: true },
  solved:            { type: Boolean, default: false },
  intelligenceBrief: { type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief', default: null },
  updates:           [problemReportUpdateSchema],
});

problemReportSchema.index({ solved: 1, time: -1 });
problemReportSchema.index({ intelligenceBrief: 1 });

module.exports = mongoose.model('ProblemReport', problemReportSchema);
