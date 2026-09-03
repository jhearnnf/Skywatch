'use strict';

/**
 * The CBAT outcome questionnaire email.
 *
 * SENDS ONLY WHEN AN ADMIN PRESSES SEND. There is no scheduler, no queue and no
 * trigger anywhere else in the codebase that reaches this file — routes/adminSurvey.js
 * is its only caller, behind an explicit button and a confirmation listing every
 * recipient by name. That is a deliberate product constraint, not an oversight:
 * the admin wants to see who has been contacted, come back a fortnight later,
 * and choose the next batch by hand.
 *
 * Delivery uses Resend's BATCH endpoint. Not an optimisation — a correctness
 * choice. Resend rate-limits normal sends to a couple per second, so 50
 * individual calls means either 25+ seconds of sequential HTTP inside one admin
 * request or a fistful of 429s. One batch call carries up to 100 fully
 * personalised messages (each has its own `to` and its own `html`, so the
 * per-recipient token link survives) and is a single round trip.
 */

const { Resend }         = require('resend');
const AppSettings        = require('../models/AppSettings');
const EmailLog           = require('../models/EmailLog');
const { buildEmailHTML, buildCtaButton, formatComposedBody } = require('./emailTemplate');
const { SURVEY_CAMPAIGN } = require('../constants/survey');

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = 'SkyWatch <noreply@skywatch.academy>';

// A research email sent from a no-reply address with no way to answer it is
// hostile, and some people WILL reply rather than click. Set RESEND_REPLY_TO to
// a real mailbox and replies land there; leave it unset and we simply omit the
// header rather than inventing an address that bounces.
const REPLY_TO = process.env.RESEND_REPLY_TO || null;

// Fallback copy, shared with the admin editor via constants/surveyEmailDefaults.json
// so the placeholders shown in the form are the strings that actually send. An
// empty setting means "use the default" — same convention as the welcome email.
const SURVEY_DEFAULTS = require('../constants/surveyEmailDefaults.json');

async function surveyEmailFields() {
  const s = await AppSettings.getSettings();
  return {
    subject:  s.cbatSurveyEmailSubject?.trim()  || SURVEY_DEFAULTS.subject,
    heading:  s.cbatSurveyEmailHeading?.trim()  || SURVEY_DEFAULTS.heading,
    subtitle: s.cbatSurveyEmailSubtitle?.trim() || SURVEY_DEFAULTS.subtitle,
    body:     s.cbatSurveyEmailBody?.trim()     || SURVEY_DEFAULTS.body,
    ctaText:  s.cbatSurveyEmailCta?.trim()      || SURVEY_DEFAULTS.cta,
    footer:   s.cbatSurveyEmailFooter?.trim()   || SURVEY_DEFAULTS.footer,
  };
}

function clientUrl() {
  return process.env.CLIENT_URL || 'http://localhost:5173';
}

// ALWAYS an absolute https URL on the web domain, never a deep link and never a
// relative path. The Android app registers no App Links for skywatch.academy
// (see android/app/src/main/AndroidManifest.xml — MAIN/LAUNCHER only), so the
// OS has no way to intercept these and they open in the browser every time.
// That is what makes the campaign independent of whether anyone has installed
// or updated the app.
function surveyUrl(token)  { return `${clientUrl()}/survey/${token}`; }
function optOutUrl(token)  { return `${clientUrl()}/survey/${token}/opt-out`; }

function displayNameFor(user) {
  return user.displayName?.trim() || `Agent ${user.agentNumber}`;
}

/**
 * Render one recipient's email. Exported so the admin preview renders the real
 * article for a real recipient rather than an approximation.
 */
function renderSurveyEmail({ fields, user, token }) {
  const name = displayNameFor(user);
  const link = surveyUrl(token);

  // {{name}} and {{link}} are substituted BEFORE formatComposedBody escapes the
  // text, so a display name containing & or < is escaped along with everything
  // else, and a bare {{link}} in the body becomes a clickable auto-link.
  const fill = (s) => String(s ?? '').replace(/\{\{name\}\}/g, name).replace(/\{\{link\}\}/g, link);

  const buttonHtml = buildCtaButton(fields.ctaText, link);
  const bodyHtml   = formatComposedBody(fill(fields.body), buttonHtml);

  // The opt-out is appended to the footer rather than left to the admin copy,
  // so it cannot be edited away by accident. It is a plain link that works
  // without JavaScript and honours the opt-out on arrival.
  const footer = `${fill(fields.footer)}<br><a href="${optOutUrl(token)}" style="color:#94a3b8;text-decoration:underline;">Do not email me about this again</a>`;

  return {
    subject: fill(fields.subject),
    html: buildEmailHTML({
      heading:  fill(fields.heading),
      subtitle: fill(fields.subtitle),
      body:     bodyHtml,
      ctaText:  '', // the button is placed inline by {{button}}
      footer,
    }),
  };
}

/**
 * Send one batch. `recipients` is [{ user, token }].
 *
 * Returns { sent: [{userId,email}], failed: [{userId,email,error}] }. Never
 * throws for a partial failure: the caller has already written invite rows and
 * needs to know precisely which ones went out so it can stamp them.
 */
async function sendSurveyBatch(recipients) {
  if (!recipients.length) return { sent: [], failed: [] };

  const fields = await surveyEmailFields();

  const messages = recipients.map(({ user, token }) => {
    const { subject, html } = renderSurveyEmail({ fields, user, token });
    return {
      from: FROM,
      to: user.email,
      subject,
      html,
      ...(REPLY_TO ? { replyTo: REPLY_TO } : {}),
    };
  });

  let outcome;
  try {
    outcome = await sendViaBatch(messages);
  } catch (err) {
    // Batch unavailable or rejected wholesale (an older SDK, a transport
    // failure). Fall back to one-at-a-time so a send still completes, slowly,
    // rather than failing the admin's click outright.
    console.error('[surveyEmail] batch send failed, falling back to sequential —', err.message);
    outcome = await sendSequentially(messages);
  }

  const sent = [];
  const failed = [];
  recipients.forEach((r, i) => {
    const err = outcome[i];
    const row = { userId: r.user._id, email: r.user.email };
    if (err) failed.push({ ...row, error: err });
    else sent.push(row);

    EmailLog.create({
      type: 'cbat_survey',
      recipientEmail: r.user.email,
      recipientUserId: r.user._id,
      subject: messages[i].subject,
      status: err ? 'failed' : 'sent',
      error: err ?? null,
      metadata: { campaign: SURVEY_CAMPAIGN, batchSize: recipients.length },
    }).catch(() => {});
  });

  return { sent, failed };
}

// Returns an array parallel to `messages`: null for success, an error string
// for failure.
async function sendViaBatch(messages) {
  if (typeof resend.batch?.send !== 'function') {
    throw new Error('resend.batch.send unavailable');
  }
  const { data, error } = await resend.batch.send(messages);
  if (error) throw new Error(error.message || 'batch rejected');

  // Resend returns { data: [{ id }, …] } in creation order. If the shape is not
  // what we expect, treat the whole batch as unverified rather than silently
  // claiming success for messages we cannot account for.
  const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : null;
  if (!rows) throw new Error('unrecognised batch response');

  return messages.map((_, i) => (rows[i]?.id ? null : 'no id returned for this message'));
}

async function sendSequentially(messages) {
  const results = [];
  for (const msg of messages) {
    try {
      const { error } = await resend.emails.send(msg); // eslint-disable-line no-await-in-loop
      results.push(error ? (error.message || 'send failed') : null);
    } catch (err) {
      results.push(err.message || 'send failed');
    }
    // Stay under Resend's default 2 requests/second.
    await new Promise(r => setTimeout(r, 600)); // eslint-disable-line no-await-in-loop
  }
  return results;
}

module.exports = {
  SURVEY_DEFAULTS,
  surveyEmailFields,
  renderSurveyEmail,
  sendSurveyBatch,
  surveyUrl,
  optOutUrl,
  displayNameFor,
};
