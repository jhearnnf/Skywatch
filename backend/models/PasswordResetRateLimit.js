const mongoose = require('mongoose');

const passwordResetRateLimitSchema = new mongoose.Schema({
  email:              { type: String, required: true, lowercase: true, trim: true, unique: true },
  requestTimestamps:  { type: [Date], default: [] },
});

module.exports = mongoose.model('PasswordResetRateLimit', passwordResetRateLimitSchema);
