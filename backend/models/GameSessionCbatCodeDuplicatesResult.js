const mongoose = require('mongoose');
const { UI_THEMES } = require('../constants/cbatUiThemes');

const schema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  correctCount: { type: Number, required: true },
  easyCorrect:  { type: Number },
  mediumCorrect:{ type: Number },
  hardCorrect:  { type: Number },
  totalTime:    { type: Number, required: true },
  grade:        { type: String, enum: ['Outstanding', 'Good', 'Needs Work', 'Failed', null], default: null },
  // Which site theme the run was played under (constants/cbatUiThemes.js):
  // the Real CBAT variant is a different task (five numbered counts to pick
  // from, and a 5-to-15 digit ramp). Null for scores that predate the field.
  uiTheme:      { type: String, enum: [...UI_THEMES, null], default: null },
  createdAt:    { type: Date, default: Date.now },
});

schema.index({ userId: 1, createdAt: -1 });
schema.index({ correctCount: -1, totalTime: 1 });

module.exports = mongoose.model('GameSessionCbatCodeDuplicatesResult', schema);
