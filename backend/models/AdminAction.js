const mongoose = require('mongoose');

const ACTION_TYPES = [
  'ban_user',
  'reset_user_stats',
  'make_admin',
  'change_quiz_questions',
  'change_aircoins',
  'change_trial_duration',
  'change_silver_categories',
  'change_ammo_defaults',
];

const adminActionSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  time:         { type: Date, default: Date.now },
  actionType:   { type: String, enum: ACTION_TYPES, required: true },
  reason:       { type: String, required: true, trim: true },
  targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // populated for user-targeted actions
});

module.exports = mongoose.model('AdminAction', adminActionSchema);
