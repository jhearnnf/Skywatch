const mongoose = require('mongoose');

const STAGE_TYPES = [
  'cold_open',
  'evidence_wall',
  'map_predictive',
  'actor_interrogations',
  'decision_point',
  'phase_reveal',
  'map_live',
  'debrief',
];

const stageSchema = new mongoose.Schema(
  {
    // Stable identifier, e.g. 'stage_co_1'
    id: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      required: true,
      enum: STAGE_TYPES,
    },
    // Type-specific payload — validated/shaped at application layer
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    // Type-specific scoring config — server-only, not exposed to clients
    scoring: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  { _id: false }
);

const gameCaseFileChapterSchema = new mongoose.Schema(
  {
    caseSlug: {
      type: String,
      required: true,
      index: true,
    },
    chapterSlug: {
      type: String,
      required: true,
    },
    chapterNumber: {
      type: Number,
      required: true,
      min: 1,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    // Human-readable date span, e.g. 'Sept 2021 – Feb 24 2022'
    dateRangeLabel: {
      type: String,
      required: true,
    },
    summary: {
      type: String,
      required: true,
    },
    estimatedMinutes: {
      type: Number,
      default: 35,
    },
    status: {
      type: String,
      enum: ['draft', 'published'],
      default: 'draft',
    },
    // Relative path to JSON file containing source citations for this chapter
    sourcesJsonPath: {
      type: String,
    },
    // Ordered array of stages (embedded sub-documents, no _id per entry)
    stages: [stageSchema],
  },
  { timestamps: true }
);

// Compound unique index — one chapter slug per case
gameCaseFileChapterSchema.index({ caseSlug: 1, chapterSlug: 1 }, { unique: true });

module.exports = mongoose.model('GameCaseFileChapter', gameCaseFileChapterSchema);
