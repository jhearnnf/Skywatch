const mongoose = require('mongoose');

// The corpus a chat bot answers from, stored in Mongo rather than read off disk.
//
// This is not a stylistic choice. The guide lives in APPLICATION_INFO/, which is
// gitignored AND outside backend/ — and Railway ships only backend/. A bot that
// read the file at runtime would work locally and silently answer nothing in
// production, exactly like the DPT 3D-model bug. Uploading it into the database
// is what makes it exist in prod at all, and it means updating the guide does
// not need a deploy.
//
// `corpus` is the flattened text the model is actually grounded in, rendered
// once at upload. `sections` keeps the structured parse so a future feature
// (per-test lookup, a UI, better retrieval) does not need a re-upload.
const botKnowledgeSchema = new mongoose.Schema({
  slug:  { type: String, required: true, unique: true, trim: true, lowercase: true },
  title: { type: String, trim: true, default: null },

  corpus:   { type: String, required: true },
  sections: { type: mongoose.Schema.Types.Mixed, default: {} },

  // Provenance, so an admin can tell at a glance which file is live.
  sourceFilename:  { type: String, trim: true, default: null },
  sourceBytes:     { type: Number, default: 0 },
  uploadedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  stats: {
    tests:       { type: Number, default: 0 },
    facts:       { type: Number, default: 0 },
    corpusChars: { type: Number, default: 0 },
    sectionsFound:   { type: [String], default: [] },
    sectionsMissing: { type: [String], default: [] },
  },
}, { timestamps: true });

module.exports = mongoose.model('BotKnowledge', botKnowledgeSchema);
