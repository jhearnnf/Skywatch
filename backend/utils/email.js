const { Resend }      = require('resend');
const AppSettings     = require('../models/AppSettings');
const EmailLog        = require('../models/EmailLog');
const { EMAIL_TYPES } = require('../constants/emailLog');
const { buildEmailHTML } = require('./emailTemplate');

const resend = new Resend(process.env.RESEND_API_KEY);

function logEmail({ type, recipientEmail, recipientUserId = null, subject = null, status, error = null, metadata = {} }) {
  EmailLog.create({ type, recipientEmail, recipientUserId, subject, status, error, metadata }).catch(() => {});
}

// Sender — must be a Resend-verified domain in production. onboarding@resend.dev works in dev.
const FROM = 'SkyWatch <noreply@skywatch.academy>';

const DEFAULT_FOOTER = 'SkyWatch — Intelligence Study Platform for RAF Knowledge &amp; Aptitude.<br>If you didn&apos;t create this account, you can safely ignore this email.';

const WELCOME_DEFAULTS = {
  subject: 'Welcome to SkyWatch — Mission Briefing',
  heading: 'Welcome to SkyWatch',
  body:    'Your intelligence briefings are ready. Study RAF aircraft, ranks, bases, squadrons, and doctrine. Test your recall through gamified knowledge checks and earn Airstars to climb the Intelligence Corps rank ladder.',
  cta:     'Begin Mission',
  footer:  DEFAULT_FOOTER,
};

async function sendWelcomeEmail({ email, agentNumber, userId = null }) {
  try {
    const appUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    const s      = await AppSettings.getSettings();
    if (s.emailWelcomeEnabled === false) return;

    const subject = s.welcomeEmailSubject?.trim() || WELCOME_DEFAULTS.subject;
    const heading = s.welcomeEmailHeading?.trim() || WELCOME_DEFAULTS.heading;
    const body    = s.welcomeEmailBody?.trim()    || WELCOME_DEFAULTS.body;
    const cta     = s.welcomeEmailCta?.trim()     || WELCOME_DEFAULTS.cta;
    const footer  = s.welcomeEmailFooter?.trim()  || WELCOME_DEFAULTS.footer;

    const { error } = await resend.emails.send({
      from: FROM,
      to: email,
      subject,
      html: buildEmailHTML({
        heading,
        subtitle: `Agent ${agentNumber} — clearance granted.`,
        body,
        ctaText: cta,
        ctaUrl:  appUrl,
        footer,
      }),
    });
    if (error) throw new Error(error.message);
    logEmail({ type: 'welcome', recipientEmail: email, recipientUserId: userId, subject, status: 'sent', metadata: { agentNumber } });
  } catch (err) {
    console.error('[email] Welcome email failed for', email, '—', err.message);
    logEmail({ type: 'welcome', recipientEmail: email, recipientUserId: userId, subject: WELCOME_DEFAULTS.subject, status: 'failed', error: err.message, metadata: { agentNumber } });
  }
}

// Confirmation errors are re-thrown so the caller can return a meaningful HTTP response.
async function sendConfirmationEmail({ email, code, userId = null }) {
  const appUrl  = process.env.CLIENT_URL || 'http://localhost:5173';
  const s       = await AppSettings.getSettings();
  if (s.emailConfirmationEnabled === false) return;

  const subject = 'SkyWatch — Confirm Your Email';
  const codeBlock = `<div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:24px;text-align:center;margin:0 0 28px;">
            <p style="font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#64748b;margin:0 0 12px;">
              Confirmation Code
            </p>
            <p style="font-size:40px;font-weight:800;letter-spacing:0.25em;color:#1d4ed8;margin:0;font-family:'Courier New',Courier,monospace;">
              ${code}
            </p>
          </div>`;

  const { error } = await resend.emails.send({
    from: FROM,
    to: email,
    subject,
    html: buildEmailHTML({
      heading: 'Confirm Your Email',
      body:    'Enter the code below to complete your SkyWatch registration. This code expires in <strong>15 minutes</strong>.',
      middle:  codeBlock,
      ctaText: 'Open SkyWatch',
      ctaUrl:  `${appUrl}/login?tab=verify&email=${encodeURIComponent(email)}`,
      footer:  `SkyWatch — Intelligence Study Platform for RAF Knowledge &amp; Aptitude.<br>If you didn&apos;t request this code, you can safely ignore this email.`,
    }),
  });
  if (error) {
    logEmail({ type: 'confirmation', recipientEmail: email, recipientUserId: userId, subject, status: 'failed', error: error.message });
    throw new Error(error.message);
  }
  logEmail({ type: 'confirmation', recipientEmail: email, recipientUserId: userId, subject, status: 'sent' });
}

async function sendPasswordResetEmail({ email, resetUrl, userId = null }) {
  try {
    const s = await AppSettings.getSettings();
    if (s.emailPasswordResetEnabled === false) return;

    const subject = 'SkyWatch — Password Reset Request';
    const { error } = await resend.emails.send({
      from: FROM,
      to: email,
      subject,
      html: buildEmailHTML({
        heading: 'Reset Your Password',
        body:    'A password reset was requested for this SkyWatch account. Click the button below to set a new password. This link expires in <strong>1 hour</strong>.<br><br>If you did not request a password reset, you can safely ignore this transmission.',
        ctaText: 'Reset Password',
        ctaUrl:  resetUrl,
        footer:  `SkyWatch — Intelligence Study Platform for RAF Knowledge &amp; Aptitude.<br>If you didn&apos;t request this reset, you can safely ignore this email.`,
      }),
    });
    if (error) throw new Error(error.message);
    logEmail({ type: 'password_reset', recipientEmail: email, recipientUserId: userId, subject, status: 'sent' });
  } catch (err) {
    console.error('[email] Password reset email failed for', email, '—', err.message);
    logEmail({ type: 'password_reset', recipientEmail: email, recipientUserId: userId, subject: 'SkyWatch — Password Reset Request', status: 'failed', error: err.message });
  }
}

async function sendReportReplyEmail({ email, agentNumber, pageReported, replyMessage, userId = null }) {
  try {
    const appUrl  = process.env.CLIENT_URL || 'http://localhost:5173';
    const subject = 'SkyWatch — Update on Your Report';
    const replyBlock = `<div style="background:#f1f5f9;border-left:3px solid #1d4ed8;border-radius:0 8px 8px 0;padding:20px 20px;margin:0 0 28px;">
            <p style="font-size:15px;line-height:1.75;color:#334155;margin:0;white-space:pre-wrap;">${replyMessage.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
          </div>`;

    const { error } = await resend.emails.send({
      from: FROM,
      to: email,
      subject,
      html: buildEmailHTML({
        heading:  'Update on Your Report',
        subtitle: `Agent ${agentNumber} — re: ${pageReported}`,
        middle:   replyBlock,
        ctaText:  'Open SkyWatch',
        ctaUrl:   appUrl,
        footer:   `SkyWatch — Intelligence Study Platform for RAF Knowledge &amp; Aptitude.<br>This is an update to a problem report you submitted.`,
      }),
    });
    if (error) throw new Error(error.message);
    logEmail({ type: 'report_reply', recipientEmail: email, recipientUserId: userId, subject, status: 'sent', metadata: { agentNumber, pageReported } });
  } catch (err) {
    console.error('[email] Report reply email failed for', email, '—', err.message);
    logEmail({ type: 'report_reply', recipientEmail: email, recipientUserId: userId, subject: 'SkyWatch — Update on Your Report', status: 'failed', error: err.message, metadata: { agentNumber, pageReported } });
  }
}

// Admin-composed email — sent from the Admin ▸ Users panel. The admin picks a
// draft (e.g. the Android testing invite), tweaks the fields, and confirms.
// Content is arbitrary admin-authored text, so the body is HTML-escaped and its
// line breaks preserved before it goes into the shared "Classified Transmission"
// shell. Errors are re-thrown so the route can surface a real failure to the admin.
async function sendAdminComposedEmail({ email, subject, heading, subtitle = '', body, ctaText, ctaUrl, footer, type = 'app_invite', userId = null }) {
  const appUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  const safeType = EMAIL_TYPES.includes(type) ? type : 'app_invite';

  // The CTA button renders inline at a {{button}} marker in the body, so the
  // admin can place it right where it belongs (e.g. just below step 1) rather
  // than always at the foot of the email. Built single-line so the newline pass
  // below can't split it. Kept in sync with buildEmailPreviewHTML on the client.
  const ctaLabel   = ctaText?.trim();
  const ctaHref    = ctaUrl?.trim() || appUrl;
  const buttonHtml = ctaLabel
    ? `<a href="${ctaHref}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;padding:13px 30px;border-radius:6px;">${ctaLabel}</a>`
    : '';

  // Escape, auto-link any http(s) URLs the admin pasted (trailing sentence
  // punctuation is left outside the link), drop in the CTA button, then turn
  // blank lines into paragraphs and single newlines into <br> so the plain-text
  // composition renders the way it was typed. Button placement and linking both
  // happen before the newline pass so neither runs past a line break.
  let bodyHtml = String(body ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/(https?:\/\/[^\s]+?)([.,!?;:]*)(?=\s|$)/g,
      '<a href="$1" style="color:#1d4ed8;text-decoration:underline;">$1</a>$2');
  if (buttonHtml && !bodyHtml.includes('{{button}}')) bodyHtml += '\n\n{{button}}';
  bodyHtml = bodyHtml
    .replace(/\{\{button\}\}/g, buttonHtml)
    .replace(/\n{2,}/g, '</p><p style="font-size:15px;line-height:1.75;color:#334155;margin:0 0 20px;">')
    .replace(/\n/g, '<br>');

  try {
    const { error } = await resend.emails.send({
      from: FROM,
      to: email,
      subject,
      html: buildEmailHTML({
        heading,
        subtitle,
        body: bodyHtml,
        // CTA lives inline via the {{button}} marker above; no bottom button.
        ctaText: '',
        footer:  footer?.trim()  || DEFAULT_FOOTER,
      }),
    });
    if (error) throw new Error(error.message);
    logEmail({ type: safeType, recipientEmail: email, recipientUserId: userId, subject, status: 'sent', metadata: { adminComposed: true } });
  } catch (err) {
    logEmail({ type: safeType, recipientEmail: email, recipientUserId: userId, subject, status: 'failed', error: err.message, metadata: { adminComposed: true } });
    throw err;
  }
}

module.exports = { sendWelcomeEmail, sendConfirmationEmail, sendPasswordResetEmail, sendReportReplyEmail, sendAdminComposedEmail };
