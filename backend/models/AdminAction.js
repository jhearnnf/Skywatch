const mongoose = require('mongoose');

const ACTION_TYPES = [
  'ban_user',
  'unban_user',
  'delete_user',
  'remove_admin',
  'reset_user_stats',
  'make_admin',
  'change_quiz_questions',
  'change_airstars',
  'change_trial_duration',
  'change_silver_categories',
  'change_ammo_defaults',
  'create_brief',
  'edit_brief',
  'delete_brief',
  'regenerate_brief_cascade',
  'regenerate_description_cascade',
  'award_test_coins',
  'change_subscription',
  'reset_leads',
  'change_beta_settings',
  'update_economy_levels',
  'update_economy_apply',
  'reset_category_badges',
  // The settings route derives its action type from which keys changed (see
  // the chain in routes/admin.js PATCH /settings). Every branch of that chain
  // must appear here: the settings write happens BEFORE the audit row, so a
  // missing value saved the change, threw on the audit, and returned a 500 —
  // telling the admin it failed when it had not, and leaving no audit trail.
  // __tests__/unit/adminActionTypes.test.js guards against this drifting again.
  'change_app_settings',
  'change_sound_settings',
  'change_economy_settings',
  'change_quiz_settings',
  'change_pathway_settings',
  'change_content_settings',
  'change_ai_settings',
  'award_coins_to_user',
  'reset_game_badges',
  'edit_tutorial_content',
  'chat_close',
  'chat_reopen',
  'chat_start',
  'chat_channel_create',
  'chat_channel_edit',
  'chat_channel_archive',
  'chat_channel_unarchive',
  'chat_channel_delete',
  'chat_message_delete',
  'chat_message_edit',
  'chat_ban',
  'chat_unban',
  'chat_bot_knowledge_upload',
  'create_update_notification',
  'edit_update_notification',
  'delete_update_notification',
  'reset_update_notification',
  'reset_update_notification_for_user',
];

const adminActionSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  time:         { type: Date, default: Date.now },
  actionType:   { type: String, enum: ACTION_TYPES, required: true },
  reason:       { type: String, required: true, trim: true },
  targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // populated for user-targeted actions
});

module.exports = mongoose.model('AdminAction', adminActionSchema);
// Exposed so a guard test can check every actionType the code writes is listed
// here — see __tests__/unit/adminActionTypes.test.js.
module.exports.ACTION_TYPES = ACTION_TYPES;
