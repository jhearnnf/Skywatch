const mongoose = require('mongoose');

const POST_TYPES = ['daily-recon', 'latest-intel', 'brand-transparency'];
const STATUSES   = ['draft', 'posted', 'failed'];
const PLATFORMS  = ['x'];

const socialPostSchema = new mongoose.Schema({
  platform:          { type: String, enum: PLATFORMS, default: 'x', required: true },
  postType:          { type: String, enum: POST_TYPES, required: true },
  tone:              { type: Number, min: 1, max: 10, required: true },
  briefId:           { type: mongoose.Schema.Types.ObjectId, ref: 'IntelligenceBrief', default: null },

  // Source-context snapshot for audit (in case the brief or commit changes later).
  sourceMeta:        { type: mongoose.Schema.Types.Mixed, default: {} },

  draftText:         { type: String, required: true },
  finalText:         { type: String, required: true },
  includedImageUrl:  { type: String, default: null },
  poll:              { type: mongoose.Schema.Types.Mixed, default: null },

  status:            { type: String, enum: STATUSES, default: 'draft', required: true },
  externalPostId:    { type: String, default: null },
  externalPostUrl:   { type: String, default: null },
  error:             { type: String, default: null },

  createdBy:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  postedAt:          { type: Date, default: null },

  // Set when an admin marks the post as removed from the platform itself
  // (e.g. the tweet was deleted on X). Null = still live. We keep the row +
  // status='posted' for audit and just stamp this field; nothing is hard-deleted.
  deletedAt:         { type: Date, default: null },
}, { timestamps: true });

socialPostSchema.index({ createdAt: -1 });
socialPostSchema.index({ platform: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('SocialPost', socialPostSchema);
module.exports.POST_TYPES = POST_TYPES;
module.exports.STATUSES   = STATUSES;
module.exports.PLATFORMS  = PLATFORMS;
