const mongoose = require('mongoose');
const crypto   = require('crypto');
const { SURVEY_CAMPAIGN } = require('../constants/survey');

// One questionnaire invitation: the row that says "this account was emailed,
// and this is the token that identifies them when they answer".
//
// The token is what makes the questionnaire work with no sign-in. A recipient
// may not have the Android app updated, may not remember their password, and
// may open the link on a device they have never signed in on — any of which
// would end the response there if the form needed an account. The token
// authenticates the *response*, not the person, which is all this needs to do.
//
// It is 32 random bytes, so it cannot be guessed or enumerated, and it grants
// exactly one capability: answer this one questionnaire. It is not a session,
// it cannot read anything about the account beyond a display name, and it can
// never be exchanged for a login.
const surveyInviteSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  campaign: { type: String, required: true, default: SURVEY_CAMPAIGN },

  token: { type: String, required: true, unique: true },

  // Address the invite actually went to, captured at send time. A user can
  // change their email afterwards; the log has to say where it was sent.
  sentToEmail: { type: String, lowercase: true, trim: true, default: null },

  // Null until the batch send succeeds for this row. Rows are created *before*
  // the send (the token has to exist to be embedded in the email), so an
  // unsent row means the send failed — and because the row still exists, the
  // unique index below keeps that person out of the next batch until an admin
  // clears it rather than silently mailing them twice.
  sentAt:    { type: Date,   default: null },
  sendError: { type: String, default: null },

  // How many times this invitation has actually gone out. The token and the row
  // are reused on a follow-up rather than replaced, so a deferred respondent's
  // original answers stay attached to the same questionnaire and their old link
  // keeps working. EmailLog holds the per-send audit trail.
  sendCount: { type: Number, default: 0 },

  // Set when they answer "not yet". Until this date passes they are held out of
  // every batch; after it they return to the pool as an ordinary candidate.
  // Null means no deferral is in force — which, on an invite that has already
  // been sent and not deferred, is what makes it un-mailable for good.
  deferredUntil: { type: Date, default: null },

  // A dry run sent to an admin to walk the flow end to end. The questionnaire
  // behaves identically except that it writes nothing to the account behind it
  // — answering "yes I passed" on a test must not award a real PASSED badge.
  isTest: { type: Boolean, default: false },

  openedAt:    { type: Date, default: null },
  completedAt: { type: Date, default: null },
  optedOutAt:  { type: Date, default: null },

  responseId: { type: mongoose.Schema.Types.ObjectId, ref: 'SurveyResponse', default: null },
}, { timestamps: true });

// The idempotency guard for bulk sending, and the reason a double-clicked
// "Send" button cannot mail anyone twice. One invite per account per campaign,
// enforced by the database rather than by a check-then-write race.
surveyInviteSchema.index({ userId: 1, campaign: 1 }, { unique: true });

// "Who have I already emailed for this campaign?" — the query behind the
// ticked-off state in the admin list.
surveyInviteSchema.index({ campaign: 1, sentAt: -1 });

// Whether this invitation may be sent (again) right now.
//
// One place for the rule, because it is read by the cohort builder (to show the
// admin who is available) and by the send route (to decide what actually goes
// out), and those two disagreeing would mean a list that offers people the
// sender then refuses.
surveyInviteSchema.statics.isMailable = function isMailable(invite, now = new Date()) {
  if (!invite) return true;                       // never invited
  if (invite.optedOutAt) return false;            // asked us to stop
  if (invite.completedAt) return false;           // already answered
  if (!invite.sentAt) return true;                // send failed — retry is fine
  if (!invite.deferredUntil) return false;        // sent, answered nothing, leave them be
  return invite.deferredUntil <= now;             // deferred, and the wait is over
};

surveyInviteSchema.statics.newToken = function newToken() {
  return crypto.randomBytes(32).toString('hex');
};

module.exports = mongoose.model('SurveyInvite', surveyInviteSchema);
