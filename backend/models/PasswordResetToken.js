const mongoose = require('mongoose');

const passwordResetTokenSchema = new mongoose.Schema({
  email:     { type: String, required: true, lowercase: true, trim: true },
  tokenHash: { type: String, required: true }, // SHA-256 hex of the raw token sent in the email link
  expiresAt: { type: Date,   required: true, index: { expires: 0 } }, // TTL — Mongo auto-deletes after 1 hour
  usedAt:    { type: Date,   default: null },
});

// Indexed for fast lookup by tokenHash (reset-password route)
passwordResetTokenSchema.index({ tokenHash: 1 });
// One active token per email — upsert replaces on each forgot-password request
passwordResetTokenSchema.index({ email: 1 });

module.exports = mongoose.model('PasswordResetToken', passwordResetTokenSchema);
