const mongoose = require('mongoose');
const { CATEGORIES } = require('../constants/categories');

const intelLeadSchema = new mongoose.Schema({
  title:          { type: String, required: true, unique: true, trim: true },
  nickname:       { type: String, trim: true, default: '' },
  subtitle:       { type: String, trim: true, default: '' },
  category:       { type: String, enum: CATEGORIES },
  subcategory:    { type: String, trim: true, default: '' },
  section:        { type: String, default: '' },
  subsection:     { type: String, default: '' },
  isPublished:    { type: Boolean, default: false },
  isHistoric:     { type: Boolean, default: false }, // true = retired/concluded/no current RAF relevance
  priorityNumber: { type: Number, default: null }, // advised learning order within category
  // RAF seniority order — Ranks category only. 1 = most senior. Compacted to a
  // contiguous 1..N sequence by backend/utils/rankOrdering.js whenever a Ranks
  // lead is added, removed, or reslotted.
  rankOrder:      { type: Number, default: null },
  // Date of the news event this lead represents (News category only). Mirrors
  // IntelligenceBrief.eventDate so the AI can reference the event date when
  // generating full content from the lead later.
  eventDate:      { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('IntelLead', intelLeadSchema);
