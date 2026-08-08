const mongoose = require('mongoose');

// Clipper reference source — one document per ingested reference guide.
//
// Why this exists rather than reading the guide off disk on demand: Railway
// ships only `backend/`, so public/cbat-guide.html
// does not exist in production (see project_railway_backend_only). Ingest is
// therefore a one-off that accepts the guide's source text — pasted or uploaded
// by an admin, or read from disk in local dev as a convenience — and everything
// derived from it is persisted here and in ClipperFact.
//
// `nameBlocklist` in particular MUST live in the database: script validation
// runs on every generation, in production, and cannot re-derive the blocklist
// from a file that isn't deployed.

const clipperSourceSchema = new mongoose.Schema({
  slug:      { type: String, required: true, unique: true, default: 'cbat-guide' },
  title:     { type: String, default: 'CBAT Complete Guide' },

  // Real people named anywhere in the source. Generated scripts are scrubbed
  // against this list — the source is a Discord export, so a model summarising
  // it will happily attribute a tip to whoever posted it.
  nameBlocklist: { type: [String], default: [] },

  sourceHash:  { type: String, default: '' },   // sha256 of the ingested text
  factCount:   { type: Number, default: 0 },
  gradeCounts: {
    green: { type: Number, default: 0 },
    amber: { type: Number, default: 0 },
    red:   { type: Number, default: 0 },
  },

  ingestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  ingestedAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('ClipperSource', clipperSourceSchema);
