const mongoose = require('mongoose');

const BATTLE_CATEGORIES = ['Aircrafts', 'Ranks', 'Training', 'Missions', 'Tech', 'Treaties', 'Bases'];

const ORDER_TYPES = {
  Aircrafts: ['speed', 'year_introduced', 'year_retired'],
  Ranks:     ['rank_hierarchy'],
  Training:  ['training_week', 'training_duration'],
  Missions:  ['start_year', 'end_year'],
  Tech:      ['start_year', 'end_year'],
  Treaties:  ['start_year', 'end_year'],
  Bases:     ['start_year', 'aircraft_count_asc'],
};

// gameData field key for each orderType
const REQUIRED_FIELD = {
  speed:             'topSpeedKph',
  year_introduced:   'yearIntroduced',
  year_retired:      'yearRetired',
  rank_hierarchy:    'rankHierarchyOrder',
  training_week:     'trainingWeekStart',
  training_duration: 'weeksOfTraining',
  start_year:        'startYear',
  end_year:          'endYear',
  aircraft_count_asc: 'aircraftCount',
};

const schema = new mongoose.Schema({
  anchorBriefId: { type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief', required: true },
  category:      { type: String, enum: BATTLE_CATEGORIES, required: true },
  difficulty:    { type: String, enum: ['easy', 'medium'], required: true },
  orderType:     { type: String, enum: Object.keys(REQUIRED_FIELD), required: true },
  generatedAt:   { type: Date, default: Date.now },
  choices: [{
    briefId:      { type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief', required: true },
    correctOrder: { type: Number, required: true },
  }],
});

module.exports = mongoose.model('GameOrderOfBattle', schema);
module.exports.BATTLE_CATEGORIES = BATTLE_CATEGORIES;
module.exports.ORDER_TYPES       = ORDER_TYPES;
module.exports.REQUIRED_FIELD    = REQUIRED_FIELD;
