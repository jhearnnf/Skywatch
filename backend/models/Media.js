const mongoose = require('mongoose');

const mediaSchema = new mongoose.Schema({
  mediaType: { type: String, enum: ['picture', 'video'], required: true },
  mediaUrl:  { type: String, required: true, trim: true },
}, { timestamps: true });

const PLACEHOLDER_URL = '/placeholder-brief.svg';

mediaSchema.statics.ensurePlaceholderForBriefs = async function () {
  const IntelligenceBrief = require('./IntelligenceBrief');

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
