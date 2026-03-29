const mongoose = require('mongoose');

const CATEGORIES = [
  'News', 'Aircrafts', 'Bases', 'Ranks', 'Squadrons', 'Training', 'Roles',
  'Threats', 'Allies', 'Missions', 'AOR', 'Tech', 'Terminology', 'Treaties',
  'Heritage',
];

// Valid subcategories per category. Empty array = subcategory not applicable.
const SUBCATEGORIES = {
  News: [],
  Aircrafts: [
    'Fast Jet',
    'ISR & Surveillance',
    'Maritime Patrol',
    'Transport & Tanker',
    'Rotary Wing',
    'Training Aircraft',
    'Ground-Based Air Defence',
    'Historic — WWII',
    'Historic — Cold War',
    'Historic — Post-Cold War',
  ],
  Bases: [
    'UK Active',
    'UK Former',
    'Overseas Permanent',
    'Overseas Deployed / FOL',
  ],
  Ranks: [
    'Commissioned Officer',
    'Non-Commissioned',
    'Specialist Role',
  ],
  Squadrons: [
    'Active Front-Line',
    'Training',
    'Royal Auxiliary Air Force',
    'Historic',
  ],
  Training: [
    'Initial Training',
    'Flying Training',
    'Ground Training & PME',
    'Tactical & Combat Training',
  ],
  Roles: [
    'Fast Jet Pilot',
    'Multi-Engine Pilot',
    'Rotary Wing Pilot',
    'Weapons Systems Operator',
    'Intelligence Officer',
    'Engineer Officer',
    'Air Traffic Control Officer',
    'RAF Regiment',
    'Logistics & Supply',
    'Medical & Nursing',
    'Cyber & Information',
    'Fighter Controller',
    'Support & Administration',
    'Space Operations',
  ],
  Threats: [
    'State Actor Air',
    'Surface-to-Air Missiles',
    'Asymmetric & Non-State',
    'Missiles & Stand-Off',
    'Electronic & Cyber',
  ],
  Allies: [
    'NATO',
    'Five Eyes',
    'AUKUS',
    'Bilateral & Framework Partners',
  ],
  Missions: [
    'World War I',
    'World War II',
    'Post-War & Cold War',
    'Post-Cold War',
    'War on Terror',
    'NATO Standing Operations',
    'Humanitarian & NEO',
  ],
  AOR: [
    'UK Home Air Defence',
    'NATO AOR',
    'Middle East & CENTCOM',
    'Atlantic & GIUK Gap',
    'Africa',
    'Indo-Pacific',
    'South Atlantic & Falklands',
  ],
  Tech: [
    'Weapons Systems',
    'Sensors & Avionics',
    'Electronic Warfare',
    'Future Programmes',
    'Command, Control & Comms',
  ],
  Terminology: [
    'Operational Concepts',
    'Flying & Tactical',
    'Air Traffic & Navigation',
    'Intelligence & Planning',
    'Maintenance & Support',
  ],
  Treaties: [
    'Founding & Core Alliances',
    'Bilateral Defence Agreements',
    'Arms Control & Non-Proliferation',
    'Operational & Status Agreements',
    'Defence Policy & Strategy',
  ],
  Heritage: [
    'Famous Personnel',
    'Traditions & Culture',
    'Memorials & Museums',
  ],
};

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
        validator: function (val) {
          if (!val) return true; // optional
          const valid = SUBCATEGORIES[this.category];
          return valid && valid.includes(val);
        },
        message: (props) => `"${props.value}" is not a valid subcategory for the chosen category`,
      },
    },

    historic: { type: Boolean, default: false },

    media: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Media' }],

    title:       { type: String, required: true, trim: true },
    nickname:    { type: String, trim: true },   // informal/popular name (e.g. "Typhoon" for Eurofighter)
    subtitle:    { type: String, trim: true },
    descriptionSections: [{ type: String, trim: true }], // exactly 4 sections; section 4 is a name-free 1–2 sentence summary (used for flashcard recall)

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
    // Generic catch-all for any cross-category link (Terminology, Roles, etc.)
    relatedBriefIds:            [{ type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief' }],
    // Back-links from historic briefs — populated automatically when a historic brief is saved
    relatedHistoric:            [{ type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief' }],

    // 'stub' = title/category only, no content yet. 'published' = full brief.
    status: { type: String, enum: ['stub', 'published'], default: 'published' },

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

intelligenceBriefSchema.index({ category: 1, subcategory: 1, dateAdded: -1 });
intelligenceBriefSchema.index({ historic: 1 });
intelligenceBriefSchema.index({ title: 'text', nickname: 'text', subtitle: 'text' });

module.exports = mongoose.model('IntelligenceBrief', intelligenceBriefSchema);
module.exports.CATEGORIES = CATEGORIES;
module.exports.SUBCATEGORIES = SUBCATEGORIES;
