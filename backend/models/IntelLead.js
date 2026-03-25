const mongoose = require('mongoose');
const { CATEGORIES, SUBCATEGORIES } = require('./IntelligenceBrief');

const intelLeadSchema = new mongoose.Schema({
  title:       { type: String, required: true, unique: true, trim: true },
  nickname:    { type: String, trim: true, default: '' },
  subtitle:    { type: String, trim: true, default: '' },
  category:    { type: String, enum: CATEGORIES },
  subcategory: { type: String, trim: true, default: '' },
  section:     { type: String, default: '' },
  subsection:  { type: String, default: '' },
  isPublished: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('IntelLead', intelLeadSchema);
