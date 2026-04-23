const mongoose = require('mongoose');
const { CATEGORIES, SUBCATEGORIES } = require('../constants/categories');
const { BRIEF_STATUS } = require('../constants/briefStatus');

const sourceSchema = new mongoose.Schema({
  url:         { type: String, required: true },
  articleDate: Date,
  siteName:    { type: String, trim: true },
}, { _id: false });

const keywordSchema = new mongoose.Schema({
  keyword:              { type: String, required: true, trim: true },
  generatedDescription: { type: String, trim: true },
  linkedBriefId:        { type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief', default: null },
});

const intelligenceBriefSchema = new mongoose.Schema(
  {
    dateAdded:   { type: Date, default: Date.now },
    category:    { type: String, enum: CATEGORIES, required: true },
    subcategory: {
      type: String,
      trim: true,
      validate: {
        // Document-context only: on a full save (IntelligenceBrief.create /
        // doc.save) we can see the sibling category via `this.category` and
        // enforce the category/subcategory pairing. In query context
        // (findOneAndUpdate + runValidators) `this` is a Query, not a Document
        // — `this.category` is undefined unless the update touches category,
        // so we skip the pairing check there and rely on the route-level
        // validators in routes/admin.js (POST + PATCH) to catch required /
        // must-not-have / not-valid cases.
        validator: function (val) {
          if (typeof this.getUpdate === 'function') return true; // query context
          const valid = SUBCATEGORIES[this.category] ?? [];
          if (valid.length === 0) return !val;
          return !!val && valid.includes(val);
        },
        message: function (props) {
          const valid = SUBCATEGORIES[this.category] ?? [];
          if (valid.length === 0) return `"${this.category}" briefs must not have a subcategory`;
          if (!props.value)        return `Subcategory is required for ${this.category} briefs`;
          return `"${props.value}" is not a valid subcategory for ${this.category}`;
        },
      },
    },

    historic:  { type: Boolean, default: false },
    eventDate: { type: Date, default: null },   // date of the news event (News briefs only)

    media: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Media' }],

    title:       { type: String, required: true, trim: true },
    nickname:    { type: String, trim: true },   // informal/popular name (e.g. "Typhoon" for Eurofighter)
    subtitle:    { type: String, trim: true },
    // Exactly 4 sections. Canonical shape: [{ heading: String, body: String }].
    // Section 4 is a name-free 1–2 sentence summary (used for flashcard recall)
    // and by convention has an empty heading. Stored as Mixed during the
    // legacy-string → object migration window; readers MUST normalize via
    // backend/utils/descriptionSections.js.
    descriptionSections: { type: [mongoose.Schema.Types.Mixed], default: [] },

    sources:  [sourceSchema],
    keywords: [keywordSchema],

    // Game data — populated per-category for Battle of Order game
    gameData: {
      // Aircrafts
      topSpeedKph:        { type: Number },
      yearIntroduced:     { type: Number },
      yearRetired:        { type: Number },   // null = still in service

      // Ranks
      rankHierarchyOrder: { type: Number },   // 1 = most senior

      // Training
      trainingWeekStart:  { type: Number },
      trainingWeekEnd:    { type: Number },
      weeksOfTraining:    { type: Number },   // total duration of this training phase in weeks

      // Bases / Squadrons / Missions / Tech / Treaties / Threats
      startYear:          { type: Number },
      endYear:            { type: Number },   // null = still active / ongoing

      // Bases
      aircraftCount:      { type: Number },   // number of aircraft currently assigned to base
    },

    // Relationship arrays — typed links between brief categories
    // Aircraft/Squadron briefs → home Bases
    associatedBaseBriefIds:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief' }],
    // Bases/Aircraft briefs → Squadrons
    associatedSquadronBriefIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief' }],
    // Bases/Squadron/Tech briefs → Aircraft
    associatedAircraftBriefIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief' }],
    // Aircrafts/Squadrons briefs → Missions/Operations
    associatedMissionBriefIds:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief' }],
    // Roles briefs → Training programmes
    associatedTrainingBriefIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief' }],
    // Aircraft briefs → Tech (weapons, sensors, EW, C2 carried/used by the airframe)
    associatedTechBriefIds:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief' }],
    // Generic catch-all for any cross-category link (Terminology, Roles, etc.)
    relatedBriefIds:            [{ type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief' }],
    // Back-links from historic briefs — populated automatically when a historic brief is saved
    relatedHistoric:            [{ type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief' }],
    // Text-scan discovered mentions — computed at generation/save time, populated on read
    mentionedBriefIds:          [{ type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief' }],

    // Mnemonics — short memory-aid sentences keyed by stat field, one per stat row
    mnemonics: {
      topSpeedKph:        { type: String },   // Aircrafts: top speed stat
      yearIntroduced:     { type: String },   // Aircrafts: introduced year stat
      status:             { type: String },   // Aircrafts/Bases/Squadrons/Threats: status stat
      rankHierarchyOrder: { type: String },   // Ranks: seniority stat
      pipelinePosition:   { type: String },   // Training: pipeline position stat
      trainingDuration:   { type: String },   // Training: duration stat
      period:             { type: String },   // Missions/Tech/Treaties: period stat
      startYear:          { type: String },   // Bases/Squadrons/Threats: opened/formed/introduced stat
    },

    // Priority order within category for the Learn Pathway page (null = not in pathway)
    priorityNumber: { type: Number, default: null },

    // 'stub' = title/category only, no content yet. 'published' = full brief.
    status: { type: String, enum: BRIEF_STATUS, default: 'stub' },

    // Set the first time a brief transitions to status='published'. Used to
    // sort the admin brief list so newly-published briefs appear first.
    publishedAt: { type: Date, default: null },

    // Admin triage flag — raised by admins in the editor or automatically when
    // a user submits a problem report attached to this brief.
    flaggedForEdit: { type: Boolean, default: false },
    flaggedAt:      { type: Date, default: null },

    // 10 questions per difficulty — references to GameQuizQuestion
    quizQuestionsEasy: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'GameQuizQuestion' }],
      validate: { validator: (arr) => arr.length <= 10, message: 'Max 10 easy questions' },
    },
    quizQuestionsMedium: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'GameQuizQuestion' }],
      validate: { validator: (arr) => arr.length <= 10, message: 'Max 10 medium questions' },
    },
  },
  { timestamps: true }
);

intelligenceBriefSchema.index({ publishedAt: -1 });
intelligenceBriefSchema.index({ category: 1, subcategory: 1, dateAdded: -1 });
intelligenceBriefSchema.index({ historic: 1 });
intelligenceBriefSchema.index({ title: 'text', nickname: 'text', subtitle: 'text' });
intelligenceBriefSchema.index({ category: 1, priorityNumber: 1 });
intelligenceBriefSchema.index({ flaggedForEdit: 1, flaggedAt: -1 });

module.exports = mongoose.model('IntelligenceBrief', intelligenceBriefSchema);
