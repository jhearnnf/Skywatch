const mongoose = require('mongoose');

const pendingRegistrationSchema = new mongoose.Schema({
  email:     { type: String, required: true, lowercase: true, trim: true },
  password:  { type: String, required: true }, // plaintext — hashed at verify time
  code:      { type: String, required: true }, // 6-digit string
  expiresAt: { type: Date,   required: true, index: { expires: 0 } }, // TTL — Mongo auto-deletes
});

// One pending registration per email — upsert replaces on resend
pendingRegistrationSchema.index({ email: 1 }, { unique: true });

module.exports = mongoose.model('PendingRegistration', pendingRegistrationSchema);
