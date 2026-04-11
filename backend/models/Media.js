const mongoose = require('mongoose');

function normalizeTerm(str) {
  return (str ?? '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
}

const mediaSchema = new mongoose.Schema({
  mediaType:          { type: String, enum: ['picture', 'video'], required: true },
  mediaUrl:           { type: String, required: true, trim: true },
  cloudinaryPublicId: { type: String, trim: true },
  name:               { type: String, trim: true },
  searchTerm: {
    type: String,
    trim: true,
    set: function (v) {
      this.searchTermNormalized = normalizeTerm(v);
      return v;
    },
  },
  searchTermNormalized: { type: String, trim: true, index: true },
  wikiPageTitle: {
    type: String,
    trim: true,
    set: function (v) {
      this.wikiPageTitleNormalized = normalizeTerm(v);
      return v;
    },
  },
  wikiPageTitleNormalized: { type: String, trim: true, index: true },
  showOnSummary:      { type: Boolean, default: true },
}, { timestamps: true });

mediaSchema.statics.normalizeTerm = normalizeTerm;

const PLACEHOLDER_URL     = '/images/placeholder-brief.svg';
const OLD_PLACEHOLDER_URL = '/placeholder-brief.svg';

mediaSchema.statics.ensurePlaceholderForBriefs = async function () {
  const IntelligenceBrief = require('./IntelligenceBrief');

  // Migrate any existing Media docs that still have the old path
  await this.updateMany({ mediaUrl: OLD_PLACEHOLDER_URL }, { mediaUrl: PLACEHOLDER_URL });

  // Find or create the single placeholder Media doc
  let placeholder = await this.findOne({ mediaUrl: PLACEHOLDER_URL });
  if (!placeholder) {
    placeholder = await this.create({ mediaType: 'picture', mediaUrl: PLACEHOLDER_URL });
    console.log('Created placeholder media document');
  }

  // Backfill any brief that has an empty media array
  const result = await IntelligenceBrief.updateMany(
    { media: { $size: 0 } },
    { $push: { media: placeholder._id } }
  );

  if (result.modifiedCount > 0) {
    console.log(`Assigned placeholder image to ${result.modifiedCount} intel brief(s)`);
  }
};

module.exports = mongoose.model('Media', mediaSchema);
module.exports.PLACEHOLDER_URL = PLACEHOLDER_URL;
