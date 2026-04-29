const mongoose = require('mongoose');

// Transcript entry for a single live interrogation question/answer.
// Stored as a flat array on the session for easy querying by (stageIndex, actorId).
// Chosen over a Map-keyed shape because:
//   - Simple countDocuments/filter queries by stageIndex + actorId.
//   - No need to convert Map keys to strings when querying.
//   - Works cleanly with multiple actor_interrogations stages in one chapter.
const interrogationTranscriptEntrySchema = new mongoose.Schema(
  {
    stageIndex: { type: Number, required: true },
    actorId:    { type: String, required: true },
    q:          { type: String, required: true },
    a:          { type: String, required: true },
    askedAt:    { type: Date, default: Date.now },
  },
  { _id: false }
);

const stageResultSchema = new mongoose.Schema(
  {
    stageIndex: { type: Number },
    stageType:  { type: String },
    submittedAt: { type: Date },
    // Client-submitted result payload — shape varies by stage type
    payload: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false }
);

const breakdownItemSchema = new mongoose.Schema(
  {
    stageIndex: { type: Number },
    stageType:  { type: String },
    score:      { type: Number },
    maxScore:   { type: Number },
    notes:      { type: String },
  },
  { _id: false }
);

const scoringSchema = new mongoose.Schema(
  {
    totalScore: { type: Number },
    breakdown:  [breakdownItemSchema],
    // airstarsAwarded / levelXpAwarded retained for back-compat reads of legacy
    // sessions written before Case Files stopped awarding airstars. Not written
    // for new sessions and not surfaced in any API response.
    airstarsAwarded: { type: Number },
    levelXpAwarded:  { type: Number },
    // Set by the one-shot reversal migration once the legacy airstars from this
    // session have been deducted from the user's totals.
    airstarsReversed: { type: Boolean, default: false },
  },
  { _id: false }
);

const gameSessionCaseFileResultSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    caseSlug:    { type: String, required: true },
    chapterSlug: { type: String, required: true },

    startedAt: {
      type: Date,
      default: Date.now,
    },
    // null until the user finishes the chapter
    completedAt: {
      type: Date,
      default: null,
    },

    currentStageIndex: {
      type: Number,
      default: 0,
      min: 0,
    },

    stageResults: [stageResultSchema],

    // null until completedAt is set
    scoring: {
      type: scoringSchema,
      default: null,
    },

    abandoned: {
      type: Boolean,
      default: false,
    },

    // Live interrogation Q&A entries — persisted as each question is asked,
    // before the stage is formally submitted. Flat array for easy per-actor counting.
    interrogationTranscripts: {
      type:    [interrogationTranscriptEntrySchema],
      default: () => [],
    },
  },
  { timestamps: true }
);

// Composite index used for "best score" lookup per user × chapter
gameSessionCaseFileResultSchema.index(
  { userId: 1, caseSlug: 1, chapterSlug: 1, completedAt: -1 }
);

module.exports = mongoose.model('GameSessionCaseFileResult', gameSessionCaseFileResultSchema);
