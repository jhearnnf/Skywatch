const mongoose = require('mongoose');
const { SURVEY_CAMPAIGN, PASS_ANSWERS, RATING_MIN, RATING_MAX, OPT_OUT_REASONS } = require('../constants/survey');

// One person's answers to the CBAT outcome questionnaire.
//
// WRITTEN PROGRESSIVELY, not on submit. The page PATCHes this row after every
// single answer, so someone who taps "yes I passed" and then closes the tab has
// still told us the thing we most wanted to know. Waiting for a final submit
// would throw away every partial run, and partial runs are the majority of any
// survey. `completedAt` is what marks a finished one; everything before that is
// a real, usable answer set that simply stops early.
//
// That is also why almost every field is optional. A half-answered response is
// the normal case, not an error state.
const surveyResponseSchema = new mongoose.Schema({
  inviteId: { type: mongoose.Schema.Types.ObjectId, ref: 'SurveyInvite', required: true, unique: true },
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  campaign: { type: String, required: true, default: SURVEY_CAMPAIGN },

  // Q1. False routes straight to a graceful exit — no role questions, no
  // donation ask. A "not yet" is not a failed send: it means the dormancy
  // threshold was early for this person, and they stay re-contactable.
  satTest: { type: Boolean, default: null },

  // Follow-up to a "not yet": when is it booked for?
  //
  // Worth asking because it converts a wasted send into a scheduled one. We tell
  // them plainly that we will not ask again until after this date, which is both
  // the reason they are willing to answer and a promise the deferral on their
  // invite actually keeps.
  //
  // `testBookedUnknown` is a real answer, not a missing one: "I have not booked
  // it yet" defers them on a default interval, where a null date alone would be
  // indistinguishable from having skipped the question.
  testBookedFor:     { type: Date,    default: null },
  testBookedUnknown: { type: Boolean, default: false },

  // Q2. A `key` from constants/surveyRoles.json. RAF keys match cbatBatteries.json
  // so an answer joins onto the battery the Aptitude Report scores that role against.
  role:      { type: String, default: null },
  roleOther: { type: String, trim: true, maxlength: 120, default: null },

  // Q3, and Q3b when Q3 was 'no'.
  passedForRole:      { type: String, enum: [...PASS_ANSWERS, null], default: null },
  passedAnyRole:      { type: String, enum: [...PASS_ANSWERS, null], default: null },
  passedAnyRoleWhich: { type: String, trim: true, maxlength: 120, default: null },

  // Q4. How close our practice tests were to the real battery, 1–5.
  //
  // The most operationally useful number here. Every other answer is about one
  // person's outcome; this one is about whether OASC has changed under us. A
  // drift downward across a few respondents is the earliest warning we can get
  // that a game needs rebuilding.
  realismRating: { type: Number, min: RATING_MIN, max: RATING_MAX, default: null },

  // Q5. Free text: anything in the real CBAT we did not prepare them for.
  // Optional and skippable — it is the highest-value answer and the one most
  // likely to stall a form, so it never blocks the finish.
  gaps: { type: String, trim: true, maxlength: 2000, default: null },

  // Q6.
  helpedRating: { type: Number, min: RATING_MIN, max: RATING_MAX, default: null },

  // Anything else they wanted to say, asked on the closing screen once the
  // questionnaire is already finished and saved.
  //
  // Deliberately NOT one of the six questions. Put in the flow it would be a
  // seventh thing to get past, and an open box is the slowest kind; asked after
  // the last answer is in, it cannot cost a single completion. What it catches
  // is the thing no fixed question asks for — the detail that does not fit
  // "what did we miss", and the occasional note about what the training did for
  // them, which is worth having and worth reading.
  comment: { type: String, trim: true, maxlength: 2000, default: null },

  // Set when they reach the donation screen and press through to Stripe. Not
  // proof of a completed payment — the webhook owns that, on User.donationPrompt
  // — only that the ask converted as far as Checkout.
  donationClicked: { type: Boolean, default: false },

  // Present only on the opt-out path, which is a different flow: the opt-out is
  // applied first and unconditionally, and these are answered afterwards by
  // someone who has already left. See routes/survey.js.
  optOutReason: { type: String, enum: [...OPT_OUT_REASONS, null], default: null },

  startedAt:   { type: Date, default: Date.now },
  completedAt: { type: Date, default: null },
}, { timestamps: true });

surveyResponseSchema.index({ campaign: 1, completedAt: -1 });

module.exports = mongoose.model('SurveyResponse', surveyResponseSchema);
