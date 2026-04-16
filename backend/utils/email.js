const { Resend }      = require('resend');
const AppSettings     = require('../models/AppSettings');
const EmailLog        = require('../models/EmailLog');
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
  body:    'Your intelligence briefings are ready. Study RAF aircraft, ranks, bases, squadrons, and doctrine. Test your recall through gamified knowledge checks and earn Aircoins to climb the Intelligence Corps rank ladder.',
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

module.exports = { sendWelcomeEmail, sendConfirmationEmail, sendPasswordResetEmail, sendReportReplyEmail };
