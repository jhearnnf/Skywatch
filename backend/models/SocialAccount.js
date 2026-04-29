const mongoose = require('mongoose');

const PLATFORMS = ['x'];

const socialAccountSchema = new mongoose.Schema({
  platform:               { type: String, enum: PLATFORMS, required: true, unique: true },
  externalUserId:         { type: String, trim: true },
  username:               { type: String, trim: true },
  accessTokenEncrypted:   { type: String, required: true },
  refreshTokenEncrypted:  { type: String, required: true },
  expiresAt:              { type: Date, required: true },
  scopes:                 { type: [String], default: [] },
  connectedAt:            { type: Date, default: Date.now },
  connectedBy:            { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('SocialAccount', socialAccountSchema);
module.exports.PLATFORMS = PLATFORMS;
