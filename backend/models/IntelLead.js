const mongoose = require('mongoose');

const intelLeadSchema = new mongoose.Schema({
  text:        { type: String, required: true, unique: true },
  section:     { type: String, default: '' },
  subsection:  { type: String, default: '' },
  isPublished: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('IntelLead', intelLeadSchema);
