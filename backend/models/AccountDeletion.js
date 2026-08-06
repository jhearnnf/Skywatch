const mongoose = require('mongoose');
const crypto = require('crypto');

// ─────────────────────────────────────────────────────────────────────────────
// Erasure register — the record that an account was deleted.
//
// GDPR pulls in two directions here. Art. 17 says erase the personal data;
// Art. 5(2) says be able to demonstrate you did. This collection is the second
// half of that, written so it does not quietly undo the first.
//
// Nothing in a row identifies anyone. There is no email, no agent number, no
// display name, no IP. What there IS is `userRef`: an HMAC-SHA256 of the
// lowercased email. It is one-way — the register cannot be read backwards into
// a list of who left — but it is *recomputable*, so when someone writes in
// asking "did you actually delete my data?", an admin pastes their email into
// the lookup and gets a yes/no plus a date. That is the only question this
// register exists to answer, and it answers it without retaining the email.
//
// Retention is deliberately indefinite (no TTL index): the accountability
// obligation has no natural expiry, and the row holds no personal data to age
// out. Revisit that only if the row ever gains an identifying field.
// ─────────────────────────────────────────────────────────────────────────────

// Keyed hash, not a bare digest. An unsalted SHA-256 of an email is trivially
// reversible by anyone who guesses the address — the space of real emails is
// small enough to enumerate — which would make this register a covert list of
// former users. The pepper is what stops that.
//
// ACCOUNT_DELETION_PEPPER is the intended key; JWT_SECRET is a fallback so a
// missing env var can never be the reason an erasure fails to be recorded.
// Rotating whichever key is in use does not corrupt anything, but lookups
// against rows written under the old key stop matching — the rows stay valid
// as proof that *an* erasure happened, they just can't be tied to an email
// any more.
function pepper() {
  return process.env.ACCOUNT_DELETION_PEPPER || process.env.JWT_SECRET || '';
}

const accountDeletionSchema = new mongoose.Schema({
  deletedAt: { type: Date, default: Date.now },

  // HMAC-SHA256(lowercased email). See refFor() below.
  userRef: { type: String, required: true, index: true },

  // Who asked for it. 'self' is the in-app "delete my account" path (and the
  // public /delete-account page Play requires); 'admin' is a moderator removing
  // someone.
  initiatedBy: { type: String, enum: ['self', 'admin'], required: true },

  // Admin-initiated only. The acting admin is staff acting in role, so this is
  // an ordinary audit field rather than something to minimise away — and the
  // erasure cascade nulls it if that admin's own account is later deleted.
  adminUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  // The reason string the admin had to supply. Free text, so it can in
  // principle name the person it was written about — same exposure the existing
  // AdminAction row already carries, and kept for the same reason: a deletion
  // with no stated cause is worse than one with.
  reason: { type: String, default: '' },

  // How old the account was, in whole days. Coarse enough not to pin down a
  // signup, useful enough to tell a spam account from a long-standing member.
  accountAgeDays: { type: Number, default: null },

  // What the cascade actually erased: total rows, and the per-collection
  // breakdown behind it. This is the substance of the accountability claim —
  // "deleted" is an assertion, "412 rows across 38 collections" is evidence.
  recordsErased: { type: Number, default: 0 },
  breakdown: { type: Map, of: Number, default: undefined },
});

accountDeletionSchema.index({ deletedAt: -1 });

/**
 * The pseudonymous reference stored for an email address.
 *
 * Same input always yields the same output, which is the whole point: an admin
 * can recompute it from an address supplied later and match it against the
 * register.
 *
 * @param {string} email
 * @returns {string|null} hex digest, or null for a blank/absent email
 */
accountDeletionSchema.statics.refFor = function refFor(email) {
  const normalised = String(email || '').trim().toLowerCase();
  if (!normalised) return null;
  return crypto.createHmac('sha256', pepper()).update(normalised).digest('hex');
};

module.exports = mongoose.model('AccountDeletion', accountDeletionSchema);
