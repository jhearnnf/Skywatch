const mongoose = require('mongoose');

const gameCaseFileSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    affairLabel: {
      type: String,
      required: true,
      trim: true,
    },
    summary: {
      type: String,
      required: true,
    },
    coverImageUrl: {
      type: String,
    },
    status: {
      type: String,
      enum: ['draft', 'published', 'locked'],
      required: true,
      default: 'draft',
    },
    tags: [String],
    // Ordered list of chapterSlugs belonging to this case file
    chapterSlugs: [String],
  },
  { timestamps: true }
);

module.exports = mongoose.model('GameCaseFile', gameCaseFileSchema);
