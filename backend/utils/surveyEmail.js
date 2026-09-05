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

// The copy a send goes out with, keyed by variant.
//
// There is one. An 'apology' variant lived here too, for the people whose first
// invitation carried a link they could not open (see scripts/
// flagBrokenSurveyLinks.js); it was written for that single September 2026
// batch, everyone owed one has since been re-sent, and it was removed rather
// than left lying next to the live invitation where a mis-click could send it
// to people who never saw the mistake.
//
// Kept as a map because `resolveVariant` below is what makes an unknown or
// stale variant fall back to the invitation instead of erroring — including
// 'apology' itself, which an old bookmarked preview URL may still ask for.
const EMAIL_VARIANTS = {
  standard: {
    label:    'Normal invitation',
    defaults: SURVEY_DEFAULTS,
    prefix:   'cbatSurveyEmail',
  },
};

const DEFAULT_VARIANT = 'standard';

function resolveVariant(variant) {
  return EMAIL_VARIANTS[variant] ? variant : DEFAULT_VARIANT;
}

async function surveyEmailFields(variant = DEFAULT_VARIANT) {
  const { defaults, prefix } = EMAIL_VARIANTS[resolveVariant(variant)];
  const s = await AppSettings.getSettings();
  const set = (key) => s[`${prefix}${key}`]?.trim();

  return {
    subject:  set('Subject')  || defaults.subject,
    heading:  set('Heading')  || defaults.heading,
    subtitle: set('Subtitle') || defaults.subtitle,
    body:     set('Body')     || defaults.body,
    ctaText:  set('Cta')      || defaults.cta,
    footer:   set('Footer')   || defaults.footer,
  };
}

function clientUrl() {
  return process.env.CLIENT_URL || 'http://localhost:5173';
}

// On 2026-09-03 a batch of 50 questionnaire emails went out from a backend whose
// CLIENT_URL was still the dev default, so fifty real people received a link to
// http://localhost:5173 — dead on every machine but the one that sent it, and
// unrecoverable because the invite rows had been stamped as delivered.
//
// The links are the entire point of this campaign, so a base URL that cannot
// work outside this machine is not a warning, it is a refusal. Checked before
// anything is rendered, and again inside sendSurveyBatch, so no caller can
// reach Resend by a route that skipped it.
//
// Set ALLOW_LOCAL_EMAIL_LINKS=true to send localhost links on purpose (a dev
// mailing themselves through a real Resend key). It has to be typed out, which
// is the difference between a decision and an accident.
const LOCAL_HOST_RE = /^(localhost|127\.|0\.0\.0\.0|\[::1\]|.*\.local)/i;

function clientUrlProblem() {
  if (process.env.ALLOW_LOCAL_EMAIL_LINKS === 'true') return null;

  const raw = clientUrl();
  let url;
  try {
    url = new URL(raw);
  } catch {
    return `CLIENT_URL is not a valid URL ("${raw}")`;
  }
  if (LOCAL_HOST_RE.test(url.hostname)) {
    return `CLIENT_URL points at this machine ("${raw}")`;
  }
  if (url.protocol !== 'https:') {
    return `CLIENT_URL is not https ("${raw}")`;
  }
  return null;
}

function assertMailableClientUrl() {
  const problem = clientUrlProblem();
  if (!problem) return;
  throw new Error(
    `${problem}, so every link in this email would be dead in the recipient's inbox. ` +
    'Send from the deployed admin at https://skywatch.academy/admin, or set CLIENT_URL ' +
    'on this backend to the public site.',
  );
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
async function sendSurveyBatch(recipients, { variant = DEFAULT_VARIANT } = {}) {
  if (!recipients.length) return { sent: [], failed: [] };

  assertMailableClientUrl();

  const chosenVariant = resolveVariant(variant);
  const fields = await surveyEmailFields(chosenVariant);

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
      metadata: { campaign: SURVEY_CAMPAIGN, batchSize: recipients.length, variant: chosenVariant },
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
  EMAIL_VARIANTS,
  DEFAULT_VARIANT,
  resolveVariant,
  clientUrl,
  clientUrlProblem,
  assertMailableClientUrl,
  surveyEmailFields,
  renderSurveyEmail,
  sendSurveyBatch,
  surveyUrl,
  optOutUrl,
  displayNameFor,
};
